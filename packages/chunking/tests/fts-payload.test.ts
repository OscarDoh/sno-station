import { describe, expect, it } from "vitest";
import { chunk } from "../src/chunker";
import { buildFtsPayload } from "../src/fts-payload";

describe("buildFtsPayload()", () => {
	it("defaults to densePayload mode", () => {
		const out = buildFtsPayload({
			chunkText: "raw chunk body",
			densePayload: "summary\n\nraw chunk body",
		});
		expect(out).toBe("summary\n\nraw chunk body");
	});

	it("uses chunkText when mode is chunkText", () => {
		const out = buildFtsPayload({
			chunkText: "raw chunk body",
			densePayload: "summary\n\nraw chunk body",
			mode: "chunkText",
		});
		expect(out).toBe("raw chunk body");
	});

	it("trims surrounding whitespace from the output", () => {
		const out = buildFtsPayload({
			chunkText: "ignored",
			densePayload: "  body with surrounding whitespace  \n",
		});
		expect(out).toBe("body with surrounding whitespace");
	});

	it("returns empty string when densePayload is whitespace-only", () => {
		const out = buildFtsPayload({ chunkText: "ignored", densePayload: "   \n\t  " });
		expect(out).toBe("");
	});

	it("can index emitted package chunk text directly", () => {
		const [draft] = chunk("Front searchable fact.\n\nTail searchable fact.", {
			contentType: "prose",
		});
		expect(draft).toBeDefined();
		if (!draft) return;

		const out = buildFtsPayload({
			chunkText: draft.chunkText,
			densePayload: "summary should not be used here",
			mode: "chunkText",
		});

		expect(out).toContain("Front searchable fact.");
		expect(out).toContain("Tail searchable fact.");
		expect(out).not.toContain("summary should not be used here");
	});
});
