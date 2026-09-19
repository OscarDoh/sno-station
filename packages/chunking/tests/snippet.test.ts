import { describe, expect, it } from "vitest";
import {
	DEFAULT_SNIPPET_CONFIG,
	DEFAULT_SNIPPET_NEIGHBOR_AFTER,
	DEFAULT_SNIPPET_NEIGHBOR_BEFORE,
	expandSnippetWindow,
} from "../src/snippet";

describe("expandSnippetWindow()", () => {
	it("returns 3-element window for middle chunk with default before=1/after=1", () => {
		const w = expandSnippetWindow(5, 10);
		expect(w).toEqual({ winningChunkIndex: 5, chunkIndices: [4, 5, 6] });
	});

	it("clamps left edge — winning at 0 with before=1 starts at 0", () => {
		const w = expandSnippetWindow(0, 10);
		expect(w.chunkIndices).toEqual([0, 1]);
	});

	it("clamps right edge — winning at last index drops over-range", () => {
		const w = expandSnippetWindow(9, 10);
		expect(w.chunkIndices).toEqual([8, 9]);
	});

	it("single-chunk parent returns just [0]", () => {
		const w = expandSnippetWindow(0, 1);
		expect(w.chunkIndices).toEqual([0]);
	});

	it("with before=0 and after=0 returns just the winning index", () => {
		const w = expandSnippetWindow(3, 10, { neighborBefore: 0, neighborAfter: 0 });
		expect(w.chunkIndices).toEqual([3]);
	});

	it("respects asymmetric before/after", () => {
		const w = expandSnippetWindow(5, 10, { neighborBefore: 2, neighborAfter: 0 });
		expect(w.chunkIndices).toEqual([3, 4, 5]);
	});

	it("throws when winningChunkIndex >= totalChunks", () => {
		expect(() => expandSnippetWindow(10, 10)).toThrow(/out of range/);
	});

	it("throws when winningChunkIndex is negative", () => {
		expect(() => expandSnippetWindow(-1, 10)).toThrow(/out of range/);
	});

	it("throws when totalChunks is 0", () => {
		expect(() => expandSnippetWindow(0, 0)).toThrow(/positive integer/);
	});

	it("throws when totalChunks is negative", () => {
		expect(() => expandSnippetWindow(0, -1)).toThrow(/positive integer/);
	});

	it("default config matches exported neighbor constants", () => {
		expect(DEFAULT_SNIPPET_CONFIG.neighborBefore).toBe(DEFAULT_SNIPPET_NEIGHBOR_BEFORE);
		expect(DEFAULT_SNIPPET_CONFIG.neighborAfter).toBe(DEFAULT_SNIPPET_NEIGHBOR_AFTER);
	});
});
