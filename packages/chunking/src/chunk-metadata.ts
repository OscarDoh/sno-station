import { z } from "zod";
import { CHUNKING_VERSION } from "./chunking-version.js";
import { ContentTypeSchema } from "./content-type.js";

/** Cross-field invariant shared by both metadata variants. */
const endOffsetRefine = {
	check: (m: { startOffset: number; endOffset: number }) => m.endOffset >= m.startOffset,
	message: "endOffset must be >= startOffset",
};

/**
 * Per PRD §9.2. Shared field shape between draft and final variants.
 *
 * `densePayload` and `chunkingVersion` are deliberately loose here — the chunker
 * emits a `Draft` before the dense payload is composed and before IDs are
 * assigned, so it must accept `densePayload: ""`. Final/persisted shapes
 * tighten both fields below.
 */
const chunkMetadataCommonFields = {
	chunkIndex: z.number().int().nonnegative(),
	chunkText: z.string(),
	densePayload: z.string(),
	summary: z.string().optional(),
	entities: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	source: z.string().optional(),
	flags: z.array(z.literal("oversized")).optional(),
	structuredPaths: z.array(z.string().min(1)).optional(),
	startOffset: z.number().int().nonnegative(),
	endOffset: z.number().int().nonnegative(),
	tokenCount: z.number().int().nonnegative(),
	contentType: ContentTypeSchema,
	chunkingVersion: z.string().min(1),
};

/**
 * Per PRD §9.2. Base shape for post-ID, dense-payload-built chunks.
 *
 * Tightens `densePayload` (must be non-empty — placeholder rows must not
 * survive promotion past the chunker) and `chunkingVersion` (must equal the
 * current `CHUNKING_VERSION` literal — stale rows from a prior chunker output
 * shape are rejected at validation time, not silently mixed into retrieval).
 */
const chunkMetadataBase = z.object({
	/** Per PRD §9.2 (the PRD spells this `id`; we use `chunkId` for clarity alongside `memoryId`). */
	chunkId: z.string().min(1),
	memoryId: z.string().min(1),
	...chunkMetadataCommonFields,
	densePayload: z.string().min(1),
	chunkingVersion: z.literal(CHUNKING_VERSION),
});

/**
 * Per PRD §9.2.
 *
 * Chunker output shape — emitted before the embedder runs, so embedder
 * provenance and DB-write timestamps are not present here. Optional fields use
 * `T | undefined` (project rule: never `null`).
 */
export const ChunkMetadataSchema = chunkMetadataBase
	.strict()
	.refine(endOffsetRefine.check, { message: endOffsetRefine.message });

/** Per PRD §9.2. Inferred type from schema. */
export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

/**
 * Per PRD §9.2.
 *
 * Draft chunker-output shape — emitted by the chunker before ID assignment,
 * so `chunkId` and `memoryId` may be empty placeholders. Promoted to
 * `ChunkMetadata` once IDs are assigned by the embedder/persistence layer.
 */
export const ChunkMetadataDraftSchema = z
	.object({
		chunkId: z.string(),
		memoryId: z.string(),
		...chunkMetadataCommonFields,
	})
	.strict()
	.refine(endOffsetRefine.check, { message: endOffsetRefine.message });

/** Per PRD §9.2. Inferred type from draft schema. */
export type ChunkMetadataDraft = z.infer<typeof ChunkMetadataDraftSchema>;

/**
 * Per PRD §9.2 + §15.1.2 (embedder provenance).
 *
 * Persisted row shape — what the storage layer writes/reads. Adds embedder
 * provenance (required so retrieval can validate dim/model alignment at query
 * time) and DB-write timestamps on top of the chunker's output.
 */
export const ChunkMetadataPersistedSchema = chunkMetadataBase
	.merge(
		z.object({
			embedderProvider: z.string().min(1),
			embedderModel: z.string().min(1),
			embedderDim: z.number().int().positive(),
			createdAt: z.number().int().nonnegative(),
			updatedAt: z.number().int().nonnegative(),
		}),
	)
	.strict()
	.refine(endOffsetRefine.check, { message: endOffsetRefine.message });

/** Per PRD §9.2 + §15.1.2. Inferred type from schema. */
export type ChunkMetadataPersisted = z.infer<typeof ChunkMetadataPersistedSchema>;
