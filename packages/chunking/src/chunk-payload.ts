import { z } from "zod";

/**
 * Per PRD §8.1. Output of the dense-payload builder (implemented in a later task).
 *
 * `densePayload` is `summary + "\n\n" + chunk` by default, or chunk-only when the
 * overlap-drop rule fires (§8.1 bounds). `ftsPayload` is the single-column FTS
 * payload for Phase 1 (§8.2 — multi-field FTS is Phase 2).
 */
export const ChunkPayloadSchema = z
	.object({
		// `densePayload` and `ftsPayload` are tightened to non-empty strings: this
		// schema represents a *built* payload (chunker output passed through
		// `buildDensePayload` + `buildFtsPayload`), not a placeholder. An empty
		// payload reaching this point would silently embed/index nothing.
		densePayload: z.string().min(1),
		chunkText: z.string().min(1),
		summary: z.string().optional(),
		ftsPayload: z.string().min(1),
	})
	.strict();

/** Per PRD §8.1. Inferred type from schema. */
export type ChunkPayload = z.infer<typeof ChunkPayloadSchema>;
