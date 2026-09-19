import { describe, expect, it } from "vitest";
import {
	INJECTION_HEADER,
	applyInjectedMemories,
	recallMemories,
	renderMemoryBlock,
	resetLedgerForSource,
	selectUnseenMemories,
	type RecallMemory,
} from "../../../apps/mem-claude/src/recall.ts";

function memory(id: string, text: string): RecallMemory {
	return { id, text };
}

describe("memory block rendering", () => {
	it.each([1_500, 3_500])("keeps exactly %i characters and drops the final whole item at cap+1", cap => {
		const memories = Array.from({ length: 20 }, (_, index) => memory(`id-${index}`, "x"));
		const overhead = renderMemoryBlock(memories, 10_000, memories.length).length - memories.length;
		let remaining = cap - overhead;
		for (const [index, item] of memories.entries()) {
			const characters = Math.min(200, remaining - (memories.length - index - 1));
			item.text = "x".repeat(characters);
			remaining -= characters;
		}
		const exact = renderMemoryBlock(memories, cap, memories.length);
		expect(exact.length).toBe(cap);
		expect(exact.split("\n")).toHaveLength(memories.length + 1);
		const last = memories[memories.length - 1];
		if (!last) throw new Error("missing boundary fixture item");
		last.text += "x";
		expect(renderMemoryBlock(memories, cap + 1, memories.length).length).toBe(cap + 1);
		const capped = renderMemoryBlock(memories, cap, memories.length);
		expect(capped).toBe(exact.split("\n").slice(0, -1).join("\n"));
	});

	it("omits memories whose metadata points at a successor", () => {
		expect(recallMemories({ toolResult: { details: { memories: [
			{ id: "old", text: "old text", metadata: '{"supersededBy":"new"}' },
			{ id: "new", text: "new text", metadata: { correctionOf: "old" } },
		] } } })).toEqual([{ id: "new", text: "new text" }]);
	});

	it("uses one capped line per item with an id suffix", () => {
		const block = renderMemoryBlock([
			memory("first", `${"A".repeat(260)}. Hidden second sentence.`),
			memory("second", "A short fact. Another sentence is not included."),
		], 3_500, 5);

		const lines = block.split("\n");
		expect(lines[0]).toBe(INJECTION_HEADER);
		expect(lines.slice(1)).toHaveLength(2);
		for (const line of lines.slice(1)) expect(line.length).toBeLessThanOrEqual(240);
		expect(lines[1]).toMatch(/ \[id:first\]$/);
		expect(lines[1]).not.toContain("Hidden second sentence");
		expect(lines[2]).toBe("A short fact. [id:second]");
	});

	it("keeps an exact-cap block and drops a whole tail item at cap minus one", () => {
		const memories = [memory("one", "First item."), memory("two", "Second item.")];
		const exact = renderMemoryBlock(memories, 3_500, 5);

		expect(renderMemoryBlock(memories, exact.length, 5)).toBe(exact);
		const smaller = renderMemoryBlock(memories, exact.length - 1, 5);
		expect(smaller).toContain("[id:one]");
		expect(smaller).not.toContain("[id:two]");
		expect(smaller.length).toBeLessThanOrEqual(exact.length - 1);
	});

	it("honors both block caps without truncating a retained line", () => {
		const memories = Array.from({ length: 20 }, (_, index) =>
			memory(`memory-${index}`, `${String(index).padStart(2, "0")} ${"x".repeat(220)}`));

		for (const cap of [1_500, 3_500]) {
			const block = renderMemoryBlock(memories, cap, memories.length);
			expect(block.length).toBeLessThanOrEqual(cap);
			for (const line of block.split("\n").slice(1)) {
				expect(line.length).toBeLessThanOrEqual(240);
				expect(line).toMatch(/ \[id:memory-\d+\]$/);
			}
		}
	});
});

describe("session injection ledger", () => {
	it("deduplicates within one session and leaves another session independent", () => {
		const first = { ledger: [], ledgerChars: 0 };
		const second = { ledger: [], ledgerChars: 0 };
		const recalled = [memory("a", "Alpha."), memory("b", "Beta.")];

		const injectedChars = renderMemoryBlock(recalled, 3_500, recalled.length).length;
		applyInjectedMemories(first, recalled, "UserPromptSubmit", injectedChars, "turn-1");
		expect(selectUnseenMemories(recalled, first)).toEqual([]);
		expect(selectUnseenMemories(recalled, second)).toEqual(recalled);
		expect(first.ledgerChars).toBeGreaterThan(0);
	});

	it("resets only for compact and clear session starts", () => {
		for (const source of ["compact", "clear"] as const) {
			const state = { ledger: [{ id: "a", chars: 12, hookEvent: "SessionStart" }], ledgerChars: 12 };
			expect(resetLedgerForSource(state, source)).toBe(true);
			expect(state).toEqual({ ledger: [], ledgerChars: 0 });
		}

		for (const source of ["startup", "resume", "fork"] as const) {
			const startup = { ledger: [{ id: "a", chars: 12, hookEvent: "SessionStart" }], ledgerChars: 12 };
			expect(resetLedgerForSource(startup, source)).toBe(false);
			expect(startup.ledger).toHaveLength(1);
		}
	});
});
