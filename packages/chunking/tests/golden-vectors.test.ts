import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildAttachmentRoute,
	chunk,
	type ChunkConfig,
	type ChunkMetadataDraft,
	chunkStructured,
	classifyContentRoute,
	countTokens,
	type StructuredChunkInput,
} from "../src/index";

interface TokenizerVector {
	name: string;
	input: string;
	expectedTokens: number;
}

interface ChunkVector {
	name: string;
	input: string;
	memoryId: string;
	config: Partial<ChunkConfig>;
	expectedChunks: ChunkMetadataDraft[];
}

interface StructuredVector {
	name: string;
	input: StructuredChunkInput;
	memoryId: string;
	config: Partial<ChunkConfig>;
	expectedChunks: ChunkMetadataDraft[];
}

interface AttachmentVector {
	name: string;
	input: Parameters<typeof buildAttachmentRoute>[0];
	expected: ReturnType<typeof buildAttachmentRoute>;
}

interface RouteVector {
	name: string;
	input: Parameters<typeof classifyContentRoute>[0];
	expected: ReturnType<typeof classifyContentRoute>;
}

interface GoldenVectors {
	version: 1;
	tokenizerMode: "char-approximation";
	tokenizer: TokenizerVector[];
	chunk: ChunkVector[];
	structured: StructuredVector[];
	attachment: AttachmentVector[];
	route: RouteVector[];
}

const vectors = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures", "golden-vectors.json"), "utf8"),
) as GoldenVectors;

describe("machine-readable golden vectors", () => {
	it("pins tokenizer cases", () => {
		expect(vectors.tokenizerMode).toBe("char-approximation");
		for (const vector of vectors.tokenizer) {
			expect(countTokens(vector.input)).toBe(vector.expectedTokens);
		}
	});

	it("pins embedded chunk cases", () => {
		for (const vector of vectors.chunk) {
			expect(JSON.stringify(chunk(vector.input, vector.config, vector.memoryId))).toBe(
				JSON.stringify(vector.expectedChunks),
			);
		}
	});

	it("pins structured chunk cases", () => {
		for (const vector of vectors.structured) {
			expect(JSON.stringify(chunkStructured(vector.input, vector.config, vector.memoryId))).toBe(
				JSON.stringify(vector.expectedChunks),
			);
		}
	});

	it("pins attachment handle cases", () => {
		for (const vector of vectors.attachment) {
			expect(JSON.stringify(buildAttachmentRoute(vector.input))).toBe(
				JSON.stringify(vector.expected),
			);
		}
	});

	it("pins route heuristic cases", () => {
		for (const vector of vectors.route) {
			expect(JSON.stringify(classifyContentRoute(vector.input))).toBe(
				JSON.stringify(vector.expected),
			);
		}
	});
});
