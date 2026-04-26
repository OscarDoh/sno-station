/**
 * Shared embedding provider interface — implemented by local (ONNX) and cloud (Voyage) providers.
 */

export interface EmbeddingProvider {
	/** Embed a single text for storage (passage encoding) */
	embed(text: string): Promise<number[]>;
	/** Embed a single text for retrieval (query encoding with prefix) */
	embedQuery(text: string): Promise<number[]>;
	/** Embed multiple texts for storage (passage encoding, batch) */
	embedDocuments(texts: string[]): Promise<number[][]>;
	/** Vector dimension (always 1024) */
	readonly dimension: number;
}

/** Disposable extension — providers that hold resources (ONNX sessions, HTTP clients) */
export interface DisposableProvider extends EmbeddingProvider {
	dispose(): Promise<void>;
}

/** Embedding tier selection */
export const EMBEDDING_TIERS = {
	local: "local",
	cloud: "cloud",
} as const;

export type EmbeddingTier =
	(typeof EMBEDDING_TIERS)[keyof typeof EMBEDDING_TIERS];

export interface EmbeddingOptions {
	tier?: EmbeddingTier;
}

/** Pooling strategy for the local ONNX feature-extraction pipeline. */
export type LocalEmbedPooling = "last_token" | "mean" | "cls";

/** Config for the local ONNX provider */
export interface LocalEmbedConfig {
	cacheDir?: string;
	dtype?: "q4" | "q8" | "fp16" | "fp32";
	queryPrefix?: string;
	/**
	 * Hugging Face model id. Defaults to the bundled Qwen3-0.6B 1024-d model.
	 * Override to use other ONNX feature-extraction models.
	 */
	model?: string;
	/** Pinned HF revision (commit SHA). Defaults to the 0.6B model's pinned revision. */
	revision?: string;
	/**
	 * Native embedding dimension produced by the model (model's `hidden_size`).
	 * For Qwen3-0.6B = 1024, Qwen3-4B = 2560. When `outputDim` is smaller, the
	 * provider Matryoshka-truncates the head and re-L2-normalizes.
	 */
	nativeDim?: number;
	/**
	 * Output dimension exposed to callers and stored in the vec table. Defaults
	 * to `nativeDim`. Set < `nativeDim` to enable Matryoshka truncation.
	 */
	outputDim?: number;
	/**
	 * Pooling strategy. Read from the model's `1_Pooling/config.json` when
	 * porting a SentenceTransformers model:
	 *   - Qwen3-Embedding family → `last_token`
	 *   - pplx-embed (Qwen3-derived w/ mean pooling) → `mean`
	 *   - BERT-style encoders → `cls`
	 * Defaults to `last_token` to preserve the bundled Qwen3-0.6B behavior.
	 */
	pooling?: LocalEmbedPooling;
}

/** Config for the cloud (Voyage / OpenAI-compatible) provider */
export interface CloudEmbedConfig {
	apiKey: string;
	model?: string;
	baseUrl?: string;
	queryPrefix?: string;
	headers?: Record<string, string>;
	maxConcurrency?: number;
	/**
	 * Output dimension for the embedding. When set, the provider sends this
	 * value in the OpenAI `dimensions` parameter (Matryoshka truncation) and
	 * validates the returned vector against it. Defaults to `EMBEDDING_DIMENSION`
	 * (1024) when omitted so existing Voyage callers keep their shape.
	 */
	dimensions?: number;
}

/** Config for the LRU cache wrapper */
export interface CacheConfig {
	maxSize?: number;
	ttlMs?: number;
}
