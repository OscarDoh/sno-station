/**
 * Local ONNX embedding provider — Qwen3-Embedding-0.6B-ONNX, 1024-d vectors.
 *
 * Extracted from apps/storix-core/src/utils/local-embedding.ts.
 * Decoupled from storix-core config — accepts params via constructor.
 */

import { resolve } from "node:path";
import {
	env,
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";
import { createLogger } from "@snoai/utils/logger";
import {
	EMBEDDING_DIMENSION,
	EMBEDDING_QUERY_PREFIX,
	LOCAL_EMBEDDING_CACHE_DIR_DEFAULT,
	LOCAL_EMBEDDING_DTYPE_DEFAULT,
	LOCAL_EMBEDDING_MODEL,
	LOCAL_EMBEDDING_MODEL_REVISION,
} from "./constants";
import type {
	DisposableProvider,
	LocalEmbedConfig,
	LocalEmbedPooling,
} from "./types";

const log = createLogger("embedder:local");

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ModelNotFoundError extends Error {
	constructor(modelId: string) {
		super(
			`Local embedding model "${modelId}" not found in cacheDir. ` +
				`Download it via Hugging Face CLI or 'npm run model:pull'.`,
		);
		this.name = "ModelNotFoundError";
	}
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class LocalEmbedProvider implements DisposableProvider {
	private _extractor: FeatureExtractionPipeline | undefined;
	private _loading: Promise<FeatureExtractionPipeline> | undefined;
	private _disposed = false;
	private readonly cacheDir: string;
	private readonly dtype: "q4" | "q8" | "fp16" | "fp32";
	private readonly queryPrefix: string;
	private readonly modelId: string;
	private readonly revision: string;
	private readonly nativeDim: number;
	private readonly outputDim: number;
	private readonly pooling: LocalEmbedPooling;

	/**
	 * Guard: transformers `env` is process-global — only one cacheDir is allowed per process.
	 * Intentionally never reset during normal operation; use `resetStaticState()` only in tests.
	 */
	private static configuredCacheDir: string | undefined;

	/** Reset static state — FOR TESTS ONLY. Not safe in production. */
	static resetStaticState(): void {
		LocalEmbedProvider.configuredCacheDir = undefined;
	}

	/** Output dimension exposed to consumers (after Matryoshka truncation, if any). */
	get dimension(): number {
		return this.outputDim;
	}

	constructor(config?: LocalEmbedConfig) {
		// Resolve to absolute path — @huggingface/transformers pathJoin
		// crashes on relative paths when multiple workers load concurrently.
		this.cacheDir = resolve(
			config?.cacheDir ?? LOCAL_EMBEDDING_CACHE_DIR_DEFAULT,
		);
		this.dtype = config?.dtype ?? LOCAL_EMBEDDING_DTYPE_DEFAULT;
		this.queryPrefix = config?.queryPrefix ?? EMBEDDING_QUERY_PREFIX;
		this.modelId = config?.model ?? LOCAL_EMBEDDING_MODEL;
		this.revision = config?.revision ?? LOCAL_EMBEDDING_MODEL_REVISION;
		// Default native dim assumes the bundled Qwen3-0.6B (1024). Callers using
		// other models must pass nativeDim explicitly so Matryoshka math is correct.
		this.nativeDim = config?.nativeDim ?? EMBEDDING_DIMENSION;
		this.outputDim = config?.outputDim ?? this.nativeDim;
		if (this.outputDim > this.nativeDim) {
			throw new Error(
				`outputDim (${this.outputDim}) cannot exceed nativeDim (${this.nativeDim}) — ` +
					`Matryoshka truncation only shrinks dimensions.`,
			);
		}
		this.pooling = config?.pooling ?? "last_token";
	}

	// ── Pipeline lifecycle ─────────────────────────────────────────────────

	// Single-threaded safety — after `await this._loading` resolves, the assignment
	// to `_extractor` and the `finally` block run synchronously in the same microtask.
	// No concurrent caller can slip between them. If worker threads are introduced,
	// this must be replaced with a proper mutex.
	private async getExtractor(): Promise<FeatureExtractionPipeline> {
		if (this._disposed) throw new Error("LocalEmbedProvider has been disposed");
		if (this._extractor) return this._extractor;
		if (this._loading) {
			const extractor = await this._loading;
			if (this._disposed) {
				throw new Error("LocalEmbedProvider has been disposed");
			}
			this._extractor = extractor;
			return extractor;
		}

		this._loading = this.initPipeline();
		try {
			const extractor = await this._loading;
			if (this._disposed) {
				throw new Error("LocalEmbedProvider has been disposed");
			}
			this._extractor = extractor;
			return this._extractor;
		} finally {
			this._loading = undefined;
		}
	}

	private async initPipeline(): Promise<FeatureExtractionPipeline> {
		// Guard: transformers `env` is process-global — reject conflicting cacheDirs.
		if (
			LocalEmbedProvider.configuredCacheDir !== undefined &&
			LocalEmbedProvider.configuredCacheDir !== this.cacheDir
		) {
			throw new Error(
				`transformers env is global; LocalEmbedProvider cacheDir must be consistent ` +
					`(existing: ${LocalEmbedProvider.configuredCacheDir}, requested: ${this.cacheDir})`,
			);
		}
		LocalEmbedProvider.configuredCacheDir = this.cacheDir;

		// Environment hardening -- set BEFORE pipeline creation
		env.cacheDir = this.cacheDir;
		env.allowRemoteModels = false; // fail-fast, no surprise downloads
		env.localModelPath = this.cacheDir;

		log.info("loading ONNX model", {
			model: this.modelId,
			cacheDir: this.cacheDir,
			dtype: this.dtype,
			nativeDim: this.nativeDim,
			outputDim: this.outputDim,
		});
		const t0 = performance.now();

		try {
			const extractor = await pipeline("feature-extraction", this.modelId, {
				revision: this.revision,
				dtype: this.dtype,
				device: "cpu",
				session_options: {
					graphOptimizationLevel: "extended",
					enableMemPattern: true,
					enableCpuMemArena: true,
					freeDimensionOverrides: { batch_size: 1 },
				},
			});

			const durationMs = Math.round(performance.now() - t0);
			log.info("ONNX model loaded", { durationMs, model: this.modelId });
			return extractor;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (
				msg.includes("no such file") ||
				msg.includes("ENOENT") ||
				msg.includes("not found") ||
				msg.includes("Could not locate file")
			) {
				log.error("ONNX model not found", {
					cacheDir: this.cacheDir,
					model: this.modelId,
				});
				throw new ModelNotFoundError(this.modelId);
			}
			log.error("ONNX model init failed", { error: String(error) });
			throw error;
		}
	}

	// ── EmbeddingProvider interface ────────────────────────────────────────

	async embed(text: string): Promise<number[]> {
		const extractor = await this.getExtractor();
		// We pass `normalize: true` so the model returns a unit-length native vector.
		// If we then truncate, the truncated head is no longer unit-length and we
		// re-normalize manually below — Matryoshka requires the truncated prefix
		// to be re-normalized so cosine similarity remains comparable across dims.
		// Pooling is configurable: Qwen3 family uses last_token, pplx-embed uses
		// mean, BERT-style models use cls. Read from `1_Pooling/config.json`.
		const output = await extractor(text, {
			pooling: this.pooling,
			normalize: true,
		});
		const lastDimIndex = output.dims.length - 1;
		if (lastDimIndex < 0) {
			throw new Error("Local embedding returned empty tensor dims");
		}
		const dim = output.dims[lastDimIndex];
		if (dim === undefined) {
			throw new Error("Local embedding returned undefined dimension");
		}
		if (dim !== this.nativeDim) {
			throw new Error(
				`Model "${this.modelId}" produced ${dim}-d native vectors, ` +
					`but provider was configured with nativeDim=${this.nativeDim}.`,
			);
		}
		const outputData = output.data as ArrayLike<number> & {
			subarray?: (start: number, end?: number) => ArrayLike<number>;
		};
		const native =
			typeof outputData.subarray === "function"
				? Array.from(outputData.subarray(0, dim))
				: Array.from(outputData).slice(0, dim);
		if (native.length !== this.nativeDim) {
			throw new Error(
				`Expected ${this.nativeDim}-d native embedding, got ${native.length}-d`,
			);
		}
		// Fast path: no truncation requested.
		if (this.outputDim === this.nativeDim) {
			return native;
		}
		return truncateAndRenormalize(native, this.outputDim);
	}

	async embedQuery(text: string): Promise<number[]> {
		return this.embed(`${this.queryPrefix}${text}`);
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		log.debug("batch local embedding", { count: texts.length });
		// Sequential loop — ONNX session with batch_size=1 forces CPU-bound serial
		// inference anyway. A loop is explicit and avoids allocating N promise objects.
		const results: number[][] = new Array(texts.length);
		for (let i = 0; i < texts.length; i++) {
			results[i] = await this.embed(texts[i] as string);
		}
		return results;
	}

	// ── Lifecycle helpers ──────────────────────────────────────────────────

	async dispose(): Promise<void> {
		log.debug("disposing local embedding provider");
		this._disposed = true;

		// If initialization is in flight, wait for it so we can dispose the result.
		const pending = this._loading;
		if (pending) {
			const extractor = await pending.catch(() => undefined);
			// After await, _extractor may have been set by getExtractor().
			// Dispose via _extractor below to avoid double-dispose.
			if (extractor && extractor !== this._extractor) {
				await extractor.dispose();
			}
		}

		if (this._extractor) {
			await this._extractor.dispose();
			this._extractor = undefined;
		}
	}

	async warmup(): Promise<void> {
		await this.embed("warmup");
	}
}

// ─── Matryoshka truncation ───────────────────────────────────────────────────

/**
 * Slice the leading `outputDim` floats and re-L2-normalize.
 *
 * Qwen3 embedding models are trained with Matryoshka representation learning,
 * so the head of a unit-length native vector remains a meaningful (but no
 * longer unit-length) embedding. Re-normalizing keeps cosine similarity
 * comparable across stored vectors of the same truncated dim.
 */
export function truncateAndRenormalize(
	native: number[],
	outputDim: number,
): number[] {
	if (outputDim <= 0 || outputDim > native.length) {
		throw new Error(
			`truncateAndRenormalize: outputDim=${outputDim} out of range for native length ${native.length}`,
		);
	}
	const head = native.slice(0, outputDim);
	let normSq = 0;
	for (let i = 0; i < outputDim; i++) {
		const v = head[i] ?? 0;
		normSq += v * v;
	}
	const norm = Math.sqrt(normSq);
	if (norm === 0) return head;
	for (let i = 0; i < outputDim; i++) {
		head[i] = (head[i] ?? 0) / norm;
	}
	return head;
}
