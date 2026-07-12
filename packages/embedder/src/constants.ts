/**
 * Shared embedding constants — single source of truth for all apps.
 * 1024-d is the ONLY supported dimension.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONSTANTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Embedding vector dimension — local PPLX and Voyage (cloud) both output 1024-d */
export const EMBEDDING_DIMENSION = 1024;

/** Local ONNX model identifier (Hugging Face hub) */
export const LOCAL_EMBEDDING_MODEL =
	"tss-deposium/pplx-embed-v1-0.6b-onnx-int8-standard";

/**
 * Pinned HuggingFace revision (commit SHA) for supply-chain integrity.
 * Update this when intentionally upgrading to a newer model version.
 */
export const LOCAL_EMBEDDING_MODEL_REVISION =
	"a18fdffe7480e6ea5643acb7757142b33838817a";

/** Default local embedding quantization dtype */
export const LOCAL_EMBEDDING_DTYPE_DEFAULT = "q8";

/** Default ONNX Runtime profile for constrained local agents. */
export const LOCAL_EMBEDDING_SESSION_OPTIONS_DEFAULT = {
	graphOptimizationLevel: "extended",
	enableMemPattern: false,
	enableCpuMemArena: false,
} as const;

/**
 * Default local embedding model cache directory.
 * Absolute path anchored to the embedder package's own `.cache/models/` so it
 * resolves identically regardless of process CWD. Apps can override via
 * constructor config.
 */
export const LOCAL_EMBEDDING_CACHE_DIR_DEFAULT: string = join(
	CONSTANTS_DIR,
	"..",
	".cache",
	"models",
);

/** Default query prefix. The bundled PPLX embedder is trained without task prefixes. */
export const EMBEDDING_QUERY_PREFIX = "";

/** Default cloud embedding model */
export const CLOUD_EMBEDDING_MODEL_DEFAULT = "voyage-3";

/** LRU cache defaults */
export const LRU_CACHE_MAX_DEFAULT = 256;
export const LRU_CACHE_TTL_MS_DEFAULT = 1_800_000; // 30 min
