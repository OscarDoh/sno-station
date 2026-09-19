// @snoai/chunking — shared chunking and chunk-level retrieval surface.

export {
	aggregateChunksToMemories,
	type ChunkCandidate,
	ChunkCandidateSchema,
	type MemoryAggregate,
} from "./aggregation.js";
export {
	ATTACHMENT_SUMMARY_CAP_TOKENS,
	ATTACHMENT_SUMMARY_HEAD_TOKENS,
	ATTACHMENT_SUMMARY_TAIL_TOKENS,
	type AttachmentHandle,
	type AttachmentHandleVector,
	type AttachmentRawPayload,
	type AttachmentRouteInput,
	AttachmentRouteInputSchema,
	type AttachmentRouteResult,
	type AttachmentSummaryInput,
	buildAttachmentRoute,
} from "./attachment.js";
export {
	type AggregationConfig,
	AggregationConfigSchema,
	DEFAULT_AGGREGATION_CONFIG,
} from "./aggregation-config.js";
export {
	type ChunkConfig,
	ChunkConfigSchema,
	type ChunkSizeProfile,
	DEFAULT_CHUNK_CONFIG,
	GRAPH_EXTRACTION_CHUNK_PROFILE,
	RETRIEVAL_CHUNK_PROFILE,
	TOKENIZER_MODES,
	type TokenizerMode,
} from "./chunk-config.js";
export { buildChunkId, type ChunkIdInput, ChunkIdInputSchema } from "./chunk-id.js";
export {
	type ChunkMetadata,
	type ChunkMetadataDraft,
	ChunkMetadataDraftSchema,
	type ChunkMetadataPersisted,
	ChunkMetadataPersistedSchema,
	ChunkMetadataSchema,
} from "./chunk-metadata.js";
export { type ChunkPayload, ChunkPayloadSchema } from "./chunk-payload.js";
export { chunk } from "./chunker.js";
export { CHUNKING_VERSION } from "./chunking-version.js";
export { CONTENT_ROUTES, type ContentRoute, ContentRouteSchema } from "./content-route.js";
export { CONTENT_TYPES, type ContentType, ContentTypeSchema } from "./content-type.js";
export {
	type BuildDensePayloadInput,
	type BuildDensePayloadOutput,
	buildDensePayload,
} from "./dense-payload.js";
export {
	type BuildFtsPayloadInput,
	buildFtsPayload,
	FTS_PAYLOAD_MODES,
	type FtsPayloadMode,
} from "./fts-payload.js";
export {
	classifyContentRoute,
	type AttachmentRouteDecision,
	type ContentRouteDecision,
	type ContentRouteInput,
	ContentRouteInputSchema,
	type EmbedRouteDecision,
} from "./route-heuristic.js";
export {
	DEFAULT_HEAD_EXTRACT_CONFIG,
	extractMetadataHeader,
	HEAD_EXTRACT_MIN_CONTENT_TOKENS,
	HEAD_EXTRACT_OVERLAP_DROP_RATIO,
	HEAD_EXTRACT_TOKEN_BUDGET,
	type HeadExtractConfig,
	HeadExtractConfigSchema,
	headExtract,
	shouldDropSummary,
} from "./head-extract.js";
export {
	type ChunkRef,
	DEFAULT_SNIPPET_CONFIG,
	DEFAULT_SNIPPET_NEIGHBOR_AFTER,
	DEFAULT_SNIPPET_NEIGHBOR_BEFORE,
	expandSnippetWindow,
	type SnippetConfig,
	SnippetConfigSchema,
	type SnippetWindow,
} from "./snippet.js";
export {
	chunkStructured,
	type StructuredChunkInput,
	StructuredChunkInputSchema,
	type StructuredJsonValue,
	StructuredJsonValueSchema,
	type StructuredMixedPart,
	StructuredMixedPartSchema,
} from "./structured.js";
export { countTokens, getCjkRatio, isCjkHeavy } from "./tokenize.js";
