import { describe, expect, it } from "vitest";
import {
	ChunkConfigSchema,
	GRAPH_EXTRACTION_CHUNK_PROFILE,
	RETRIEVAL_CHUNK_PROFILE,
} from "../src/chunk-config.js";
import { chunk } from "../src/chunker.js";

describe("chunk-size profiles", () => {
	it("RETRIEVAL profile carries the evaluated retrieval sizing", () => {
		expect(RETRIEVAL_CHUNK_PROFILE).toEqual({
			minTokens: 256,
			targetTokens: 512,
			maxTokens: 1536,
			overlapTokens: 128,
		});
	});

	it("GRAPH_EXTRACTION profile carries the graph-extraction sizing", () => {
		expect(GRAPH_EXTRACTION_CHUNK_PROFILE).toEqual({
			minTokens: 512,
			targetTokens: 1200,
			maxTokens: 1536,
			overlapTokens: 200,
		});
	});

	it("both profiles satisfy ChunkConfig invariants (min<=target<=max, overlap<min)", () => {
		for (const profile of [RETRIEVAL_CHUNK_PROFILE, GRAPH_EXTRACTION_CHUNK_PROFILE]) {
			const cfg = ChunkConfigSchema.parse({ ...profile, contentType: "prose" });
			expect(cfg.minTokens).toBeLessThanOrEqual(cfg.targetTokens);
			expect(cfg.targetTokens).toBeLessThanOrEqual(cfg.maxTokens);
			expect(cfg.overlapTokens).toBeLessThan(cfg.minTokens);
		}
	});

	it("a profile spread into chunk() with a content type produces valid chunks", () => {
		const text = "First sentence about a topic. ".repeat(60);
		const chunks = chunk(text, { ...RETRIEVAL_CHUNK_PROFILE, contentType: "prose" }, "profile-test");
		expect(chunks.length).toBeGreaterThan(0);
		for (const c of chunks) {
			expect(c.chunkText.length).toBeGreaterThan(0);
			expect(c.tokenCount).toBeLessThanOrEqual(RETRIEVAL_CHUNK_PROFILE.maxTokens);
		}
	});
});
