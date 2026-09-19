import { z } from "zod";

export const DEFAULT_SNIPPET_NEIGHBOR_BEFORE = 1 as const;
export const DEFAULT_SNIPPET_NEIGHBOR_AFTER = 1 as const;

export const SnippetConfigSchema = z
	.object({
		neighborBefore: z.number().int().nonnegative().default(DEFAULT_SNIPPET_NEIGHBOR_BEFORE),
		neighborAfter: z.number().int().nonnegative().default(DEFAULT_SNIPPET_NEIGHBOR_AFTER),
	})
	.strict()
	.prefault({
		neighborBefore: DEFAULT_SNIPPET_NEIGHBOR_BEFORE,
		neighborAfter: DEFAULT_SNIPPET_NEIGHBOR_AFTER,
	});

export type SnippetConfig = z.infer<typeof SnippetConfigSchema>;

export const DEFAULT_SNIPPET_CONFIG: SnippetConfig = SnippetConfigSchema.parse(undefined);

export interface ChunkRef {
	chunkId: string;
	chunkIndex: number;
}

export interface SnippetWindow {
	winningChunkIndex: number;
	chunkIndices: number[];
}

function resolveConfig(config: Partial<SnippetConfig> | undefined): SnippetConfig {
	if (config === undefined) return DEFAULT_SNIPPET_CONFIG;
	return SnippetConfigSchema.parse(config);
}

/**
 * Given a parent's full chunk index range and a winning chunk index, return
 * the (clamped) inclusive index list `[winning - before, winning + after]`.
 * Indices outside `[0, totalChunks - 1]` are dropped. The winning index is
 * always included if in range.
 */
export function expandSnippetWindow(
	winningChunkIndex: number,
	totalChunks: number,
	config?: Partial<SnippetConfig>,
): SnippetWindow {
	if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
		throw new Error(`totalChunks must be a positive integer, got ${totalChunks}`);
	}
	if (
		!Number.isInteger(winningChunkIndex) ||
		winningChunkIndex < 0 ||
		winningChunkIndex >= totalChunks
	) {
		throw new Error(`winningChunkIndex ${winningChunkIndex} out of range [0, ${totalChunks - 1}]`);
	}
	const resolved = resolveConfig(config);
	const start = Math.max(0, winningChunkIndex - resolved.neighborBefore);
	const end = Math.min(totalChunks - 1, winningChunkIndex + resolved.neighborAfter);
	const chunkIndices: number[] = [];
	for (let i = start; i <= end; i += 1) chunkIndices.push(i);
	return { winningChunkIndex, chunkIndices };
}
