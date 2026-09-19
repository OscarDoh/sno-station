import { describe, expect, it } from "vitest";
import { chunk, classifyContentRoute, countTokens } from "../src/index";

describe("oversized conversation turns", () => {
	it("emits one oversized chunk for a single turn that exceeds maxTokens", () => {
		const turn = `[2026-06-30T10:00:00Z] Alice: ${"important fact ".repeat(200)}`;
		const chunks = chunk(
			turn,
			{
				contentType: "conversation",
				minTokens: 16,
				targetTokens: 32,
				maxTokens: 48,
				overlapTokens: 0,
			},
			"oversized-turn",
		);

		expect(countTokens(turn)).toBeGreaterThan(48);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.chunkText).toBe(turn);
		expect(chunks[0]?.startOffset).toBe(0);
		expect(chunks[0]?.endOffset).toBe(turn.length);
		expect(chunks[0]?.tokenCount).toBeGreaterThan(48);
		expect(chunks[0]?.flags).toEqual(["oversized"]);
	});

	it("flags an oversized turn whole even when a short turn precedes it", () => {
		// Regression: a short turn accumulating below minTokens must not be
		// force-split forward into the next turn when that next turn is itself
		// oversized. The short turn and the oversized turn must land in two
		// separate chunks, with the oversized one whole and flagged.
		const shortTurn = "[2026-06-30T10:00:00Z] Bob: ok";
		const longTurn = `[2026-06-30T10:00:01Z] Alice: ${"important fact ".repeat(200)}`;
		const text = `${shortTurn}\n${longTurn}`;
		const chunks = chunk(
			text,
			{
				contentType: "conversation",
				minTokens: 16,
				targetTokens: 32,
				maxTokens: 48,
				overlapTokens: 0,
			},
			"short-then-oversized-turn",
		);

		expect(countTokens(shortTurn)).toBeLessThan(16);
		expect(countTokens(longTurn)).toBeGreaterThan(48);

		expect(chunks).toHaveLength(2);
		// The turn-boundary offset is the start of the next turn's line, so the
		// separating newline belongs to the end of the first chunk.
		expect(chunks[0]?.chunkText).toBe(`${shortTurn}\n`);
		expect(chunks[0]?.flags).toBeUndefined();
		expect(chunks[1]?.chunkText).toBe(longTurn);
		expect(chunks[1]?.flags).toEqual(["oversized"]);
	});

	it("does not emit empty flags on normal conversation chunks", () => {
		const chunks = chunk("[2026-06-30T10:00:00Z] Alice: normal short turn", {
			contentType: "conversation",
		});
		expect(chunks[0]?.flags).toBeUndefined();
	});

	it("routes clear log-shaped oversized text to attachment before conversation chunking", () => {
		const content = [
			"[2026-06-30T10:00:00Z] Alice: 2026-06-30T10:00:00Z ERROR worker failed request_id=0",
			...Array.from(
				{ length: 24 },
				(_, index) => `2026-06-30T10:00:${String(index).padStart(2, "0")}Z ERROR worker failed request_id=${index}`,
			),
		].join("\n");

		expect(countTokens(content)).toBeGreaterThan(48);
		expect(classifyContentRoute({ content })).toMatchObject({
			route: "attachment",
			reasons: ["clear-log-dump-shell-shape"],
		});
	});
});
