import { z } from "zod";
import {
	type AggregationConfig,
	AggregationConfigSchema,
	DEFAULT_AGGREGATION_CONFIG,
} from "./aggregation-config.js";

export const ChunkCandidateSchema = z
	.object({
		chunkId: z.string().min(1),
		parentMemoryId: z.string().min(1),
		chunkIndex: z.number().int().nonnegative(),
		rerankedScore: z.number().finite().min(0).max(1),
	})
	.strict();
export type ChunkCandidate = z.infer<typeof ChunkCandidateSchema>;

export interface MemoryAggregate {
	parentMemoryId: string;
	memoryScore: number;
	bestChunkScore: number;
	bestChunkId: string;
	bestChunkIndex: number;
	matchingChunkIds: string[];
	multiHitBonus: number;
	adjacencyBonus: number;
}

const FP_SLACK = 1e-9;

function resolveConfig(config: Partial<AggregationConfig> | undefined): AggregationConfig {
	const merged = { ...DEFAULT_AGGREGATION_CONFIG, ...(config ?? {}) };
	return AggregationConfigSchema.parse(merged);
}

function pickBestCandidate(group: ChunkCandidate[]): ChunkCandidate {
	let best = group[0];
	if (best === undefined) {
		throw new Error("pickBestCandidate called on empty group");
	}
	for (let i = 1; i < group.length; i += 1) {
		const c = group[i];
		if (c === undefined) continue;
		if (c.rerankedScore > best.rerankedScore) {
			best = c;
		} else if (c.rerankedScore === best.rerankedScore && c.chunkIndex < best.chunkIndex) {
			best = c;
		}
	}
	return best;
}

function countAdjacentPairs(indices: number[]): number {
	const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
	let pairs = 0;
	for (let i = 1; i < unique.length; i += 1) {
		const prev = unique[i - 1];
		const cur = unique[i];
		if (prev === undefined || cur === undefined) continue;
		if (cur - prev === 1) pairs += 1;
	}
	return pairs;
}

function compareAggregates(a: MemoryAggregate, b: MemoryAggregate): number {
	if (b.memoryScore !== a.memoryScore) return b.memoryScore - a.memoryScore;
	if (b.bestChunkScore !== a.bestChunkScore) return b.bestChunkScore - a.bestChunkScore;
	if (a.bestChunkIndex !== b.bestChunkIndex) return a.bestChunkIndex - b.bestChunkIndex;
	return a.parentMemoryId < b.parentMemoryId ? -1 : a.parentMemoryId > b.parentMemoryId ? 1 : 0;
}

/**
 * Group chunk candidates by `parentMemoryId`, apply §10.5 scoring formula.
 * Returns aggregates sorted descending by `memoryScore`, with ties broken
 * per PRD §10.5: bestChunkScore desc, then lower bestChunkIndex, then
 * parentMemoryId asc.
 */
export function aggregateChunksToMemories(
	candidates: ChunkCandidate[],
	config?: Partial<AggregationConfig>,
): MemoryAggregate[] {
	const validated = z.array(ChunkCandidateSchema).parse(candidates);
	const cfg = resolveConfig(config);
	if (validated.length === 0) return [];

	const groups = new Map<string, ChunkCandidate[]>();
	for (const c of validated) {
		const list = groups.get(c.parentMemoryId);
		if (list === undefined) groups.set(c.parentMemoryId, [c]);
		else list.push(c);
	}

	const aggregates: MemoryAggregate[] = [];
	for (const [parentMemoryId, rawGroup] of groups) {
		// Dedup per parent by chunkId BEFORE scoring. Hybrid fusion can produce the
		// same chunkId twice; keeping both would falsely inflate multiHitBonus and
		// duplicate matchingChunkIds. Keep the highest rerankedScore (lower
		// chunkIndex on score tie — though chunkIndex per chunkId is stable).
		const byChunkId = new Map<string, ChunkCandidate>();
		for (const c of rawGroup) {
			const prev = byChunkId.get(c.chunkId);
			if (
				prev === undefined ||
				c.rerankedScore > prev.rerankedScore ||
				(c.rerankedScore === prev.rerankedScore && c.chunkIndex < prev.chunkIndex)
			) {
				byChunkId.set(c.chunkId, c);
			}
		}
		const group = Array.from(byChunkId.values());
		const best = pickBestCandidate(group);
		const matchingChunkIds = group.map((c) => c.chunkId);
		const indices = group.map((c) => c.chunkIndex);
		const multiHitBonus = Math.min(
			cfg.multiHitBonusCap,
			cfg.multiHitBonusPerHit * Math.max(0, group.length - 1),
		);
		const adjacencyBonus = Math.min(
			cfg.adjacencyBonusCap,
			cfg.adjacencyBonusPerPair * countAdjacentPairs(indices),
		);
		// Guards against caller misconfiguring caps such that bonuses can flip
		// a stronger single hit (PRD §10.5 invariant).
		if (multiHitBonus + adjacencyBonus > cfg.bonusTotalInvariant + FP_SLACK) {
			throw new Error(
				`bonus invariant violated: multiHitBonus=${multiHitBonus} + adjacencyBonus=${adjacencyBonus} > ${cfg.bonusTotalInvariant}`,
			);
		}
		const memoryScore = best.rerankedScore + multiHitBonus + adjacencyBonus;
		aggregates.push({
			parentMemoryId,
			memoryScore,
			bestChunkScore: best.rerankedScore,
			bestChunkId: best.chunkId,
			bestChunkIndex: best.chunkIndex,
			matchingChunkIds,
			multiHitBonus,
			adjacencyBonus,
		});
	}

	aggregates.sort(compareAggregates);
	return aggregates;
}
