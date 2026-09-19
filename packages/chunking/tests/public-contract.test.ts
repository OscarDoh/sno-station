import { describe, expect, it } from "vitest";
import {
	CHUNKING_VERSION,
	ChunkConfigSchema,
	CONTENT_ROUTES,
	CONTENT_TYPES,
	ContentRouteSchema,
	ContentTypeSchema,
	TOKENIZER_MODES,
} from "../src/index";

describe("public chunking contract", () => {
	it("exposes embedded content types without code", () => {
		expect(CONTENT_TYPES).toEqual(["conversation", "prose", "structured"]);
		expect(ContentTypeSchema.safeParse("conversation").success).toBe(true);
		expect(ContentTypeSchema.safeParse("prose").success).toBe(true);
		expect(ContentTypeSchema.safeParse("structured").success).toBe(true);
		expect(ContentTypeSchema.safeParse("code").success).toBe(false);
	});

	it("exposes content route as an independent axis", () => {
		expect(CONTENT_ROUTES).toEqual(["embed", "attachment"]);
		expect(ContentRouteSchema.safeParse("embed").success).toBe(true);
		expect(ContentRouteSchema.safeParse("attachment").success).toBe(true);
		expect(ContentRouteSchema.safeParse("code").success).toBe(false);
		expect(ContentRouteSchema.safeParse("structured").success).toBe(false);
	});

	it("validates structured config and rejects removed/unsupported modes", () => {
		expect(ChunkConfigSchema.safeParse({ contentType: "structured" }).success).toBe(true);
		expect(ChunkConfigSchema.safeParse({ contentType: "code" }).success).toBe(false);
		expect(ChunkConfigSchema.safeParse({ tokenizerMode: "tiktoken" }).success).toBe(false);
		expect(TOKENIZER_MODES).toEqual(["char-approximation"]);
	});

	it("keeps the chunk ID version frozen at the approved hard-cut value", () => {
		expect(CHUNKING_VERSION).toBe("1.1.0");
	});
});
