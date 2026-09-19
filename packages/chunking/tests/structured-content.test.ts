import { describe, expect, it } from "vitest";
import { chunkStructured, StructuredChunkInputSchema } from "../src/index";

const tinyConfig = {
	minTokens: 1,
	targetTokens: 10,
	maxTokens: 20,
	overlapTokens: 0,
} as const;

function paths(chunks: ReturnType<typeof chunkStructured>): string[] {
	return chunks.flatMap((chunk) => chunk.structuredPaths ?? []);
}

describe("chunkStructured()", () => {
	it("accepts structured input at the trust boundary", () => {
		expect(StructuredChunkInputSchema.safeParse({ name: "Ada", count: 2 }).success).toBe(
			true,
		);
		expect(
			StructuredChunkInputSchema.safeParse([
				{ kind: "text", text: "context" },
				{ kind: "json", value: { ok: true } },
				{ kind: "raw", text: "raw block" },
			]).success,
		).toBe(true);
	});

	it("chunks JSON strings in deterministic key order with path metadata", () => {
		const chunks = chunkStructured('{"b":2,"a":1}', tinyConfig, "json-string");
		expect(paths(chunks)).toEqual(["$.a", "$.b"]);
		expect(chunks.map((chunk) => chunk.contentType)).toEqual(["structured"]);
		expect(JSON.stringify(chunks)).toBe(
			JSON.stringify(chunkStructured('{"b":2,"a":1}', tinyConfig, "json-string")),
		);
	});

	it("cuts objects and arrays at nested paths", () => {
		const input = {
			profile: {
				name: "Ada",
				bio: "你好世界 keeps mixed-script values intact.",
			},
			items: [
				{ id: 2, text: "second item text with enough words to stand alone" },
				{ id: 1, text: "first item text with enough words to stand alone" },
			],
		};

		const chunks = chunkStructured(input, tinyConfig, "structured-object");
		expect(chunks.length).toBeGreaterThan(1);
		expect(paths(chunks)).toEqual([
			"$.items[0].id",
			"$.items[0].text",
			"$.items[1].id",
			"$.items[1].text",
			"$.profile.bio",
			"$.profile.name",
		]);
		expect(chunks.at(-1)?.endOffset).toBeGreaterThan(chunks[0]?.startOffset ?? -1);
	});

	it("preserves mixed part order without merging unrelated paths", () => {
		const chunks = chunkStructured(
			[
				{ kind: "text", text: "Context before the object." },
				{ kind: "json", value: { event: "login", user: "Ada" } },
				{ kind: "raw", text: "RAW\nTRACE\nLINES", label: "trace" },
			],
			tinyConfig,
			"mixed",
		);

		expect(paths(chunks)).toEqual([
			"$parts[0].text",
			"$parts[1].json.event",
			"$parts[1].json.user",
			"$parts[2].raw",
		]);
		expect(chunks.map((chunk) => chunk.chunkText).join("\n")).toContain(
			"$parts[2].raw [trace]: RAW",
		);
	});

	it("emits an oversized scalar without corrupting the value", () => {
		const scalar = "x".repeat(200);
		const chunks = chunkStructured(
			{ body: scalar },
			{ minTokens: 1, targetTokens: 5, maxTokens: 10, overlapTokens: 0 },
			"oversized-structured",
		);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.structuredPaths).toEqual(["$.body"]);
		expect(chunks[0]?.flags).toEqual(["oversized"]);
		expect(chunks[0]?.chunkText).toContain(JSON.stringify(scalar));
		expect(chunks[0]?.tokenCount).toBeGreaterThan(10);
	});
});
