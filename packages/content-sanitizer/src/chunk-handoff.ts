import { chunk, type ChunkConfig, type ChunkMetadataDraft } from "@snoai/chunking";
import { sanitizeContentIngress } from "./projection.js";
import { boundedWarnings, warning, type SanitizedContent, type SanitizerInput } from "./types.js";

export interface SanitizeAndChunkOptions {
	memoryId?: string;
	chunkConfig?: Partial<ChunkConfig>;
}

export interface SanitizeAndChunkResult {
	sanitized: SanitizedContent;
	chunks: ChunkMetadataDraft[];
}

function atomicSpanFitsChunk(
	span: SanitizedContent["chunkingHandoff"]["atomicSpans"][number],
	chunkDraft: ChunkMetadataDraft,
): boolean {
	return span.startOffset >= chunkDraft.startOffset && span.endOffset <= chunkDraft.endOffset;
}

function atomicSpansSplitByChunks(
	sanitized: SanitizedContent,
	chunks: ChunkMetadataDraft[],
): number {
	return sanitized.chunkingHandoff.atomicSpans.filter(
		(span) => !chunks.some((chunkDraft) => atomicSpanFitsChunk(span, chunkDraft)),
	).length;
}

function withAtomicSpanSplitWarning(
	sanitized: SanitizedContent,
	chunks: ChunkMetadataDraft[],
): SanitizedContent {
	const splitCount = atomicSpansSplitByChunks(sanitized, chunks);
	if (splitCount === 0) return sanitized;
	return {
		...sanitized,
		warnings: boundedWarnings([
			...sanitized.warnings,
			warning(
				"atomic_span_split",
				"Atomic transcript spans exceeded chunk boundaries and were chunked with a bounded warning",
				undefined,
				splitCount,
			),
		]),
		provenance: {
			...sanitized.provenance,
			decisions: [...sanitized.provenance.decisions, "atomic-span-soft-split"].slice(0, 16),
		},
	};
}

export function sanitizeAndChunkContent(
	input: SanitizerInput,
	options: SanitizeAndChunkOptions = {},
): SanitizeAndChunkResult {
	const sanitized = sanitizeContentIngress(input);
	const conversationConfig =
		sanitized.chunkingHandoff.contentType === "conversation"
			? { targetTokens: 4096, maxTokens: 4096 }
			: {};
	const chunks = chunk(
		sanitized.chunkingHandoff.text,
		{
			...options.chunkConfig,
			...conversationConfig,
			contentType: sanitized.chunkingHandoff.contentType,
		},
		options.memoryId,
	);
	return { sanitized: withAtomicSpanSplitWarning(sanitized, chunks), chunks };
}
