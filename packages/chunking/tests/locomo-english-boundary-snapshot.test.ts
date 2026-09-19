import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunk } from "../src/chunker";

/**
 * Per cjk-other-fix.md §A.4. Locks the chunker's English output against
 * silent drift when the sentence-segmentation backend changes (regex →
 * Intl.Segmenter, ICU version updates, future locale plumbing).
 *
 * Failure means English chunk boundaries shifted. Either accept the new
 * split (refresh the snapshot AND re-run LoCoMo mid×2 to confirm the
 * eval still meets the gate) or revert. The point is the divergence
 * shows up loud rather than silently degrading recall.
 */
describe("LoCoMo English boundary snapshot", () => {
	it("chunk hashes on conv-26 session_3 don't drift", () => {
		const text = readFileSync(
			join(__dirname, "fixtures", "locomo-conv26-session3.txt"),
			"utf8",
		);
		const chunks = chunk(text, { contentType: "conversation" }, "snapshot-fixture");
		const fingerprint = chunks
			.map((c) => createHash("sha256").update(c.chunkText).digest("hex").slice(0, 16))
			.join(",");
		expect({ count: chunks.length, fingerprint }).toMatchSnapshot();
	});
});
