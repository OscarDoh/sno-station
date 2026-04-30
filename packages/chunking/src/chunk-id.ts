import { createHash } from "node:crypto";
import { z } from "zod";
import { CHUNKING_VERSION } from "./chunking-version";

export const ChunkIdInputSchema = z
	.object({
		parentMemoryId: z.string().min(1),
		chunkIndex: z.number().int().nonnegative(),
		startOffset: z.number().int().nonnegative(),
		endOffset: z.number().int().nonnegative(),
		chunkText: z.string(),
		chunkingVersion: z.literal(CHUNKING_VERSION).default(CHUNKING_VERSION),
	})
	.strict()
	.refine((d) => d.endOffset >= d.startOffset, {
		message: "endOffset must be >= startOffset",
	});

export type ChunkIdInput = z.infer<typeof ChunkIdInputSchema>;

const FIELD_SEP = "\x1f";

// Whitespace normalization makes the chunkText component of the ID stable
// against intra-chunk whitespace drift (CRLF↔LF, trailing spaces, collapsed
// indent) PROVIDED the chunker still emits the same chunkIndex / startOffset /
// endOffset for that chunk. Whitespace edits *outside* this chunk that shift
// upstream offsets will produce a different ID — that is intentional: the PRD
// §7.4 ID inputs include offsets, and re-ingest is the correct response when
// chunk boundaries move. Case is preserved so that `myFunc` vs `myfunc` (real
// code edits) produce different chunk IDs.
function normalizeContent(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

/**
 * Deterministic chunk ID. Reproducible from stable inputs per PRD §7.4.
 * Format: `chk_<16 hex chars>` (64 bits of SHA-256 prefix). 64 bits is enough
 * for ID uniqueness within a single memory's chunk count (max thousands) with
 * negligible collision risk and keeps row keys compact.
 */
export function buildChunkId(input: ChunkIdInput): string {
	const parsed = ChunkIdInputSchema.parse(input);
	const normalized = normalizeContent(parsed.chunkText);
	const payload = [
		parsed.parentMemoryId,
		String(parsed.chunkIndex),
		String(parsed.startOffset),
		String(parsed.endOffset),
		normalized,
		parsed.chunkingVersion,
	].join(FIELD_SEP);
	const hex = createHash("sha256").update(payload).digest("hex");
	return `chk_${hex.slice(0, 16)}`;
}
