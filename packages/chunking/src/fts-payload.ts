/** Per PRD §8.2. Phase 1 single-column FTS payload builder. */

export const FTS_PAYLOAD_MODES = ["chunkText", "densePayload"] as const;

export type FtsPayloadMode = (typeof FTS_PAYLOAD_MODES)[number];

export interface BuildFtsPayloadInput {
	chunkText: string;
	densePayload: string;
	mode?: FtsPayloadMode | undefined;
}

/**
 * Per PRD §8.2. Default mode `densePayload`: Phase 1 ships single-column FTS5
 * indexed on the chunk dense payload (chunk text prefixed by parent summary).
 * `chunkText` is the conditional fallback when validation shows that summary
 * repetition across sibling chunks inflates BM25 on summary terms. Phase 2
 * introduces multi-field weighted FTS (§8.2 promotion gate).
 */
export function buildFtsPayload(input: BuildFtsPayloadInput): string {
	const mode: FtsPayloadMode = input.mode ?? "densePayload";
	const raw = mode === "densePayload" ? input.densePayload : input.chunkText;
	return raw.trim();
}
