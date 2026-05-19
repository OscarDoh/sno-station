/**
 * Shared embedding constants — single source of truth for all apps.
 * 1024-d is the ONLY supported dimension.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONSTANTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Embedding vector dimension — Qwen3-0.6B (local) and Voyage (cloud) both output 1024-d */
export const EMBEDDING_DIMENSION = 1024;

/** Local ONNX model identifier (Hugging Face hub) */
export const LOCAL_EMBEDDING_MODEL = "onnx-community/Qwen3-Embedding-0.6B-ONNX";

/**
 * Pinned HuggingFace revision (commit SHA) for supply-chain integrity.
 * Update this when intentionally upgrading to a newer model version.
 */
export const LOCAL_EMBEDDING_MODEL_REVISION =
	"72ae6878a1ab06eac891dc58577ed1652379afb5";

/** Default local embedding quantization dtype */
export const LOCAL_EMBEDDING_DTYPE_DEFAULT = "q8";

/**
 * Default local embedding model cache directory.
 * Absolute path anchored to the embedder package's own `.cache/models/` so it
 * resolves identically regardless of process CWD. Apps can override via
 * constructor config.
 */
export const LOCAL_EMBEDDING_CACHE_DIR_DEFAULT = join(
	CONSTANTS_DIR,
	"..",
	".cache",
	"models",
);

/** Query instruction prefix for retrieval-optimized embedding (Qwen3 prompt_name="query") */
export const EMBEDDING_QUERY_PREFIX =
	"Instruct: Given a query, retrieve relevant passages\nQuery: ";

/** Default cloud embedding model */
export const CLOUD_EMBEDDING_MODEL_DEFAULT = "voyage-3";

/** LRU cache defaults */
export const LRU_CACHE_MAX_DEFAULT = 256;
export const LRU_CACHE_TTL_MS_DEFAULT = 1_800_000; // 30 min
