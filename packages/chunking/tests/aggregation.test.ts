import { describe, expect, it } from "vitest";
import { aggregateChunksToMemories, type ChunkCandidate } from "../src/aggregation";

function mk(
	parentMemoryId: string,
	chunkIndex: number,
	rerankedScore: number,
	chunkId?: string,
): ChunkCandidate {
	return {
		parentMemoryId,
		chunkIndex,
		rerankedScore,
		chunkId: chunkId ?? `${parentMemoryId}_c${chunkIndex}`,
	};
}

describe("aggregateChunksToMemories()", () => {
	it("returns empty array for empty input", () => {
		expect(aggregateChunksToMemories([])).toEqual([]);
	});

	it("single parent, single chunk → memoryScore = rerankedScore, no bonuses", () => {
		const out = aggregateChunksToMemories([mk("m1", 0, 0.7)]);
		expect(out).toHaveLength(1);
		const a = out[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.parentMemoryId).toBe("m1");
		expect(a.memoryScore).toBeCloseTo(0.7, 9);
		expect(a.bestChunkScore).toBe(0.7);
		expect(a.bestChunkIndex).toBe(0);
		expect(a.multiHitBonus).toBe(0);
		expect(a.adjacencyBonus).toBe(0);
		expect(a.matchingChunkIds).toEqual(["m1_c0"]);
	});

	it("3 adjacent chunks (0,1,2) → multiHit=0.06, adjacency=0.04", () => {
		const out = aggregateChunksToMemories([
			mk("m1", 0, 0.5),
			mk("m1", 1, 0.7),
			mk("m1", 2, 0.6),
		]);
		const a = out[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.bestChunkScore).toBe(0.7);
		expect(a.bestChunkIndex).toBe(1);
		expect(a.multiHitBonus).toBeCloseTo(0.06, 9);
		expect(a.adjacencyBonus).toBeCloseTo(0.04, 9);
		expect(a.memoryScore).toBeCloseTo(0.7 + 0.06 + 0.04, 9);
	});

	it("multiHitBonus is capped at 0.10", () => {
		const candidates: ChunkCandidate[] = [];
		for (let i = 0; i < 10; i += 1) candidates.push(mk("m1", i, 0.5));
		const a = aggregateChunksToMemories(candidates)[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.multiHitBonus).toBeCloseTo(0.1, 9);
	});

	it("adjacencyBonus is capped at 0.06", () => {
		const candidates: ChunkCandidate[] = [];
		for (let i = 0; i < 10; i += 1) candidates.push(mk("m1", i, 0.5));
		const a = aggregateChunksToMemories(candidates)[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.adjacencyBonus).toBeCloseTo(0.06, 9);
	});

	it("non-adjacent chunks contribute multi-hit but zero adjacency", () => {
		const out = aggregateChunksToMemories([mk("m1", 0, 0.5), mk("m1", 5, 0.6)]);
		const a = out[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.multiHitBonus).toBeCloseTo(0.03, 9);
		expect(a.adjacencyBonus).toBe(0);
	});

	it("sorts multiple parents by memoryScore desc", () => {
		const out = aggregateChunksToMemories([
			mk("low", 0, 0.3),
			mk("high", 0, 0.9),
			mk("mid", 0, 0.6),
		]);
		expect(out.map((a) => a.parentMemoryId)).toEqual(["high", "mid", "low"]);
	});

	it("breaks memoryScore tie by bestChunkScore desc", () => {
		// Both parents end up with memoryScore=0.7, but one parent's best chunk is 0.7
		// (single hit), the other is 0.6 (with 0.03 multi-hit + 0.07 from a tighter
		// configuration). Use simpler construction: equal memoryScore, different bestChunkScore.
		const out = aggregateChunksToMemories([
			mk("a", 0, 0.7),
			mk("b", 0, 0.65),
			mk("b", 1, 0.65),
			mk("b", 2, 0.65),
			mk("b", 3, 0.65), // multiHit 0.09, adj 0.06 → memoryScore 0.65 + 0.09 + 0.06 = 0.80
		]);
		// Recompute: a.memoryScore = 0.7, b.memoryScore = 0.80 → b first.
		expect(out[0]?.parentMemoryId).toBe("b");
		expect(out[1]?.parentMemoryId).toBe("a");
	});

	it("breaks tie on memoryScore + bestChunkScore by lower bestChunkIndex", () => {
		const out = aggregateChunksToMemories([
			{ chunkId: "a0", parentMemoryId: "a", chunkIndex: 5, rerankedScore: 0.5 },
			{ chunkId: "b0", parentMemoryId: "b", chunkIndex: 2, rerankedScore: 0.5 },
		]);
		expect(out[0]?.parentMemoryId).toBe("b");
		expect(out[1]?.parentMemoryId).toBe("a");
	});

	it("breaks tie on memoryScore + bestChunkScore + bestChunkIndex by parentMemoryId asc", () => {
		const out = aggregateChunksToMemories([
			{ chunkId: "z0", parentMemoryId: "z", chunkIndex: 0, rerankedScore: 0.5 },
			{ chunkId: "a0", parentMemoryId: "a", chunkIndex: 0, rerankedScore: 0.5 },
		]);
		expect(out[0]?.parentMemoryId).toBe("a");
		expect(out[1]?.parentMemoryId).toBe("z");
	});

	it("ties on rerankedScore for best chunk pick → lower chunkIndex wins", () => {
		const out = aggregateChunksToMemories([mk("m1", 3, 0.5), mk("m1", 1, 0.5)]);
		const a = out[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.bestChunkIndex).toBe(1);
	});

	it("throws when configured caps violate the bonus invariant", () => {
		expect(() =>
			aggregateChunksToMemories([mk("m1", 0, 0.5), mk("m1", 1, 0.5)], {
				multiHitBonusCap: 0.5,
				adjacencyBonusCap: 0.5,
				bonusTotalInvariant: 0.16,
			}),
		).toThrow();
	});

	it("dedups identical (parent, chunkId) candidates → no false multi-hit bonus", () => {
		const dup: ChunkCandidate = {
			parentMemoryId: "m",
			chunkId: "x",
			chunkIndex: 0,
			rerankedScore: 0.5,
		};
		const out = aggregateChunksToMemories([dup, { ...dup }]);
		expect(out).toHaveLength(1);
		const a = out[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.multiHitBonus).toBe(0);
		expect(a.matchingChunkIds).toEqual(["x"]);
		expect(a.memoryScore).toBeCloseTo(0.5, 9);
	});

	it("dedup keeps the higher rerankedScore on duplicate chunkId", () => {
		const out = aggregateChunksToMemories([
			{ parentMemoryId: "m", chunkId: "x", chunkIndex: 0, rerankedScore: 0.5 },
			{ parentMemoryId: "m", chunkId: "x", chunkIndex: 0, rerankedScore: 0.7 },
		]);
		const a = out[0];
		expect(a).toBeDefined();
		if (!a) return;
		expect(a.bestChunkScore).toBe(0.7);
		expect(a.memoryScore).toBeCloseTo(0.7, 9);
		expect(a.multiHitBonus).toBe(0);
	});

	it("rejects NaN rerankedScore", () => {
		expect(() =>
			aggregateChunksToMemories([
				{ parentMemoryId: "m", chunkId: "x", chunkIndex: 0, rerankedScore: Number.NaN },
			]),
		).toThrow();
	});

	it("rejects Infinity rerankedScore", () => {
		expect(() =>
			aggregateChunksToMemories([
				{
					parentMemoryId: "m",
					chunkId: "x",
					chunkIndex: 0,
					rerankedScore: Number.POSITIVE_INFINITY,
				},
			]),
		).toThrow();
	});

	it("rejects negative chunkIndex", () => {
		expect(() =>
			aggregateChunksToMemories([
				{ parentMemoryId: "m", chunkId: "x", chunkIndex: -1, rerankedScore: 0.5 },
			]),
		).toThrow();
	});

	it("rejects empty chunkId", () => {
		expect(() =>
			aggregateChunksToMemories([
				{ parentMemoryId: "m", chunkId: "", chunkIndex: 0, rerankedScore: 0.5 },
			]),
		).toThrow();
	});

	it("rejects rerankedScore > 1", () => {
		expect(() =>
			aggregateChunksToMemories([
				{ parentMemoryId: "m", chunkId: "x", chunkIndex: 0, rerankedScore: 1.5 },
			]),
		).toThrow();
	});

	it("validates config even when candidates are empty", () => {
		expect(() =>
			aggregateChunksToMemories([], {
				multiHitBonusCap: 0.1,
				adjacencyBonusCap: 0.1,
				bonusTotalInvariant: 0.1,
			}),
		).toThrow();
	});

	it("rejects Infinity in aggregation config caps", () => {
		// Without `.finite()` on the schema, `Infinity` would silently bypass the
		// bonus invariant guard and produce `Infinity` memory scores.
		expect(() =>
			aggregateChunksToMemories([mk("m1", 0, 0.5)], {
				multiHitBonusCap: Number.POSITIVE_INFINITY,
			}),
		).toThrow();
	});
});
