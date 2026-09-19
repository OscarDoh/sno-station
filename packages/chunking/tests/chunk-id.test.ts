import { describe, expect, it } from "vitest";
import { buildChunkId, ChunkIdInputSchema } from "../src/chunk-id";

const baseInput = {
	parentMemoryId: "mem_abc123",
	chunkIndex: 0,
	startOffset: 0,
	endOffset: 100,
	chunkText: "The quick brown fox jumps over the lazy dog.",
} as const;

describe("buildChunkId()", () => {
	it("is deterministic for the same input", () => {
		const a = buildChunkId({ ...baseInput });
		const b = buildChunkId({ ...baseInput });
		expect(a).toBe(b);
	});

	it("produces format chk_<32 hex chars>", () => {
		const id = buildChunkId({ ...baseInput });
		expect(id).toMatch(/^chk_[0-9a-f]{32}$/);
	});

	it("collapses whitespace-only differences in chunkText to the same ID", () => {
		const a = buildChunkId({ ...baseInput });
		const b = buildChunkId({
			...baseInput,
			chunkText: "  The   quick\tbrown\nfox jumps over the lazy dog.  ",
		});
		expect(a).toBe(b);
	});

	it("treats case-only differences as DIFFERENT content (case preserved for code edits)", () => {
		const a = buildChunkId({ ...baseInput, chunkText: "myFunc" });
		const b = buildChunkId({ ...baseInput, chunkText: "myfunc" });
		expect(a).not.toBe(b);
	});

	it("produces different IDs for different chunkIndex", () => {
		const a = buildChunkId({ ...baseInput, chunkIndex: 0 });
		const b = buildChunkId({ ...baseInput, chunkIndex: 1 });
		expect(a).not.toBe(b);
	});

	it("produces different IDs for different parentMemoryId", () => {
		const a = buildChunkId({ ...baseInput, parentMemoryId: "mem_aaa" });
		const b = buildChunkId({ ...baseInput, parentMemoryId: "mem_bbb" });
		expect(a).not.toBe(b);
	});

	it("produces different IDs for different start/end offsets", () => {
		const a = buildChunkId({ ...baseInput, startOffset: 0, endOffset: 100 });
		const b = buildChunkId({ ...baseInput, startOffset: 50, endOffset: 150 });
		expect(a).not.toBe(b);
	});

	it("produces different IDs for different content", () => {
		const a = buildChunkId({ ...baseInput, chunkText: "first body" });
		const b = buildChunkId({ ...baseInput, chunkText: "second body" });
		expect(a).not.toBe(b);
	});

	it("rejects endOffset < startOffset", () => {
		expect(() =>
			buildChunkId({
				...baseInput,
				startOffset: 100,
				endOffset: 50,
			}),
		).toThrow();
	});

	it("rejects empty parentMemoryId via schema", () => {
		expect(() => ChunkIdInputSchema.parse({ ...baseInput, parentMemoryId: "" })).toThrow();
	});

	it("rejects negative chunkIndex via schema", () => {
		expect(() => ChunkIdInputSchema.parse({ ...baseInput, chunkIndex: -1 })).toThrow();
	});

	it("produces 1000 distinct IDs across distinct inputs (32-hex collision smoke)", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			const id = buildChunkId({
				parentMemoryId: `mem_${i % 7}`,
				chunkIndex: i % 13,
				startOffset: i * 10,
				endOffset: i * 10 + 100 + (i % 5),
				chunkText: `body-${i}-${(i * 1009) & 0xffff}-content`,
			});
			expect(id).toMatch(/^chk_[0-9a-f]{32}$/);
			ids.add(id);
		}
		expect(ids.size).toBe(1000);
	});
});
