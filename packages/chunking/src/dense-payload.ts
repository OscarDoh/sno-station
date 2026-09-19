/** Per PRD §8.1. Dense-payload composition. Caller resolves summary upstream. */

export interface BuildDensePayloadInput {
	chunkText: string;
	summary?: string | undefined;
}

export interface BuildDensePayloadOutput {
	densePayload: string;
	summary: string | undefined;
}

/**
 * Per PRD §8.1. Compose `summary + "\n\n" + chunkText` when a non-empty summary
 * is supplied, else chunk-only. Caller is responsible for invoking `headExtract`
 * + `shouldDropSummary` upstream and only passing a kept summary in.
 */
export function buildDensePayload(input: BuildDensePayloadInput): BuildDensePayloadOutput {
	const trimmedSummary = input.summary?.trim();
	if (trimmedSummary === undefined || trimmedSummary.length === 0) {
		return { densePayload: input.chunkText, summary: undefined };
	}
	return {
		densePayload: `${trimmedSummary}\n\n${input.chunkText}`,
		summary: trimmedSummary,
	};
}
