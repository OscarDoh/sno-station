import { describe, expect, it } from "vitest";
import { chunk } from "../src/chunker";
import { buildDensePayload } from "../src/dense-payload";

describe("buildDensePayload()", () => {
	it("composes summary + blank line + chunk when summary is non-empty", () => {
		const out = buildDensePayload({
			chunkText: "Body of the chunk.",
			summary: "Parent summary line.",
		});
		expect(out.densePayload).toBe("Parent summary line.\n\nBody of the chunk.");
		expect(out.summary).toBe("Parent summary line.");
	});

	it("returns chunk-only output when summary is undefined", () => {
		const out = buildDensePayload({ chunkText: "Body only." });
		expect(out.densePayload).toBe("Body only.");
		expect(out.summary).toBeUndefined();
	});

	it("treats whitespace-only summary as undefined", () => {
		const out = buildDensePayload({ chunkText: "Body only.", summary: "   \n\t" });
		expect(out.densePayload).toBe("Body only.");
		expect(out.summary).toBeUndefined();
	});

	it("trims summary whitespace before composition", () => {
		const out = buildDensePayload({
			chunkText: "chunk",
			summary: "  padded summary  ",
		});
		expect(out.summary).toBe("padded summary");
		expect(out.densePayload).toBe("padded summary\n\nchunk");
	});

	it("does not trim chunkText", () => {
		const out = buildDensePayload({
			chunkText: "  leading and trailing spaces preserved  ",
			summary: "s",
		});
		expect(out.densePayload).toBe("s\n\n  leading and trailing spaces preserved  ");
	});

	it("composes dense payload from emitted package chunk text", () => {
		const [draft] = chunk("Front fact.\n\nTail fact.", { contentType: "prose" });
		expect(draft).toBeDefined();
		if (!draft) return;

		const out = buildDensePayload({
			chunkText: draft.chunkText,
			summary: "Session summary.",
		});

		expect(out.densePayload).toContain("Session summary.");
		expect(out.densePayload).toContain("Front fact.");
		expect(out.densePayload).toContain("Tail fact.");
	});
});
