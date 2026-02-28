/**
 * Local ONNX embedding provider — Qwen3-Embedding-0.6B-ONNX, 1024-d vectors.
 *
 * Extracted from apps/edge-core/src/utils/local-embedding.ts.
 * Decoupled from edge-core config — accepts params via constructor.
 */

import { resolve } from "node:path";
import {
	env,
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";
import { createLogger } from "@sno-edge/utils/logger";
import {
	EMBEDDING_DIMENSION,
	EMBEDDING_QUERY_PREFIX,
	LOCAL_EMBEDDING_CACHE_DIR_DEFAULT,
	LOCAL_EMBEDDING_DTYPE_DEFAULT,
	LOCAL_EMBEDDING_MODEL,
} from "./constants";
import type { DisposableProvider, LocalEmbedConfig } from "./types";

const log = createLogger("embedder:local");

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ModelNotFoundError extends Error {
	constructor() {
		super(
			"Local embedding model not found. Run 'bun run model:pull' to download it.",
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

	/**
	 * Guard: transformers `env` is process-global — only one cacheDir is allowed per process.
	 * Intentionally never reset during normal operation; use `resetStaticState()` only in tests.
	 */
	private static configuredCacheDir: string | undefined;

	/** Reset static state — FOR TESTS ONLY. Not safe in production. */
	static resetStaticState(): void {
		LocalEmbedProvider.configuredCacheDir = undefined;
	}

	get dimension(): number {
		return EMBEDDING_DIMENSION;
	}

	constructor(config?: LocalEmbedConfig) {
		// Resolve to absolute path — @huggingface/transformers pathJoin
		// crashes on relative paths when multiple workers load concurrently.
		this.cacheDir = resolve(
			config?.cacheDir ?? LOCAL_EMBEDDING_CACHE_DIR_DEFAULT,
		);
		this.dtype = config?.dtype ?? LOCAL_EMBEDDING_DTYPE_DEFAULT;
		this.queryPrefix = config?.queryPrefix ?? EMBEDDING_QUERY_PREFIX;
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
			model: LOCAL_EMBEDDING_MODEL,
			cacheDir: this.cacheDir,
			dtype: this.dtype,
		});
		const t0 = performance.now();

		try {
			const extractor = await pipeline(
				"feature-extraction",
				LOCAL_EMBEDDING_MODEL,
				{
					dtype: this.dtype,
					device: "cpu",
					session_options: {
						graphOptimizationLevel: "extended",
						enableMemPattern: true,
						enableCpuMemArena: true,
						freeDimensionOverrides: { batch_size: 1 },
					},
				},
			);

			const durationMs = Math.round(performance.now() - t0);
			log.info("ONNX model loaded", { durationMs });
			return extractor;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (
				msg.includes("no such file") ||
				msg.includes("ENOENT") ||
				msg.includes("not found") ||
				msg.includes("Could not locate file")
			) {
				log.error("ONNX model not found", { cacheDir: this.cacheDir });
				throw new ModelNotFoundError();
			}
			log.error("ONNX model init failed", { error: String(error) });
			throw error;
		}
	}

	// ── EmbeddingProvider interface ────────────────────────────────────────

	async embed(text: string): Promise<number[]> {
		const extractor = await this.getExtractor();
		const output = await extractor(text, {
			pooling: "last_token",
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
		const outputData = output.data as ArrayLike<number> & {
			subarray?: (start: number, end?: number) => ArrayLike<number>;
		};
		const vector =
			typeof outputData.subarray === "function"
				? Array.from(outputData.subarray(0, dim))
				: Array.from(outputData).slice(0, dim);
		if (vector.length !== EMBEDDING_DIMENSION) {
			throw new Error(
				`Expected ${EMBEDDING_DIMENSION}-d embedding, got ${vector.length}-d`,
			);
		}
		return vector;
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
