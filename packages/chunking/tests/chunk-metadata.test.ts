import { describe, expect, it } from "vitest";
import {
	ChunkMetadataDraftSchema,
	ChunkMetadataPersistedSchema,
	ChunkMetadataSchema,
} from "../src/chunk-metadata";
import { CHUNKING_VERSION } from "../src/chunking-version";

const draftBase = {
	chunkId: "",
	memoryId: "",
	chunkIndex: 0,
	chunkText: "hello",
	densePayload: "",
	startOffset: 0,
	endOffset: 5,
	tokenCount: 2,
	contentType: "prose" as const,
	chunkingVersion: CHUNKING_VERSION,
};

const persistedBase = {
	...draftBase,
	chunkId: "chk_0123456789abcdef",
	memoryId: "mem-1",
	densePayload: "summary\n\nhello",
	embedderProvider: "openai",
	embedderModel: "text-embedding-3-large@1024",
	embedderDim: 1024,
	createdAt: 1714000000000,
	updatedAt: 1714000000000,
};

describe("ChunkMetadataDraftSchema", () => {
	it("accepts placeholder chunkId/densePayload (chunker output shape)", () => {
		expect(() => ChunkMetadataDraftSchema.parse(draftBase)).not.toThrow();
	});
});

describe("ChunkMetadataSchema (post-ID)", () => {
	it("rejects empty densePayload (placeholder must not survive promotion)", () => {
		expect(() =>
			ChunkMetadataSchema.parse({
				...draftBase,
				chunkId: "chk_0123456789abcdef",
				memoryId: "mem-1",
				densePayload: "",
			}),
		).toThrow();
	});

	it("rejects stale chunkingVersion (literal-locked to current CHUNKING_VERSION)", () => {
		expect(() =>
			ChunkMetadataSchema.parse({
				...draftBase,
				chunkId: "chk_0123456789abcdef",
				memoryId: "mem-1",
				densePayload: "summary\n\nhello",
				chunkingVersion: "0.9.0",
			}),
		).toThrow();
	});
});

describe("ChunkMetadataPersistedSchema", () => {
	it("accepts a fully-built persisted row", () => {
		expect(() => ChunkMetadataPersistedSchema.parse(persistedBase)).not.toThrow();
	});

	it("rejects empty densePayload", () => {
		expect(() =>
			ChunkMetadataPersistedSchema.parse({ ...persistedBase, densePayload: "" }),
		).toThrow();
	});

	it("rejects stale chunkingVersion", () => {
		expect(() =>
			ChunkMetadataPersistedSchema.parse({ ...persistedBase, chunkingVersion: "0.9.0" }),
		).toThrow();
	});
});
