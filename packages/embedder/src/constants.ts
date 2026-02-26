/**
 * Shared embedding constants — single source of truth for all apps.
 * 1024-d is the ONLY supported dimension.
 */

/** Embedding vector dimension — Qwen3-0.6B (local) and Voyage (cloud) both output 1024-d */
export const EMBEDDING_DIMENSION = 1024;

/** Local ONNX model identifier (Hugging Face hub) */
export const LOCAL_EMBEDDING_MODEL = "onnx-community/Qwen3-Embedding-0.6B-ONNX";

/** Default local embedding quantization dtype */
export const LOCAL_EMBEDDING_DTYPE_DEFAULT = "q8";

/** Default local embedding model cache directory (project-local) */
export const LOCAL_EMBEDDING_CACHE_DIR_DEFAULT = "./embedding/models";

/** Query instruction prefix for retrieval-optimized embedding (Qwen3 prompt_name="query") */
export const EMBEDDING_QUERY_PREFIX =
	"Instruct: Given a query, retrieve relevant passages\nQuery: ";

/** Default cloud embedding model */
export const CLOUD_EMBEDDING_MODEL_DEFAULT = "voyage-3";

/** LRU cache defaults */
export const LRU_CACHE_MAX_DEFAULT = 256;
export const LRU_CACHE_TTL_MS_DEFAULT = 1_800_000; // 30 min
