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

/** Config for the local ONNX provider */
export interface LocalEmbedConfig {
	cacheDir?: string;
	dtype?: "q4" | "q8" | "fp16" | "fp32";
	queryPrefix?: string;
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
