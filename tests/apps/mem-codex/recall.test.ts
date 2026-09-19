import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	INJECTION_HEADER,
	applyInjectedMemories,
	recallMemories,
	renderMemoryBlock,
	resetLedgerForSource,
	selectUnseenMemories,
	type RecallMemory,
} from "../../../apps/mem-codex/src/recall.ts";
import { spoolDirectory } from "../../../apps/mem-codex/src/paths.ts";
import { readSession, writeSession } from "../../../apps/mem-codex/src/session-state.ts";

const hookMocks = vi.hoisted(() => ({
	getRecall: vi.fn(),
	startWorkerDetached: vi.fn(),
}));

vi.mock("../../../apps/mem-codex/src/doctor.js", () => ({ sidecarStatus: async () => "healthy" }));
vi.mock("../../../apps/mem-codex/src/import.js", () => ({
	importReceiptExists: async () => true,
	importRepository: vi.fn(),
}));
vi.mock("../../../apps/mem-codex/src/memory-client.js", () => ({
	connectMemory: async () => ({ principal: "tester", getRecall: hookMocks.getRecall }),
	isDegradedConnection: () => false,
}));
vi.mock("../../../apps/mem-codex/src/scope.js", () => ({
	repositoryRoot: async () => "/repo",
	hookScope: (project: string, session: string) => ({ principal: "tester", project, session }),
}));
vi.mock("../../../apps/mem-codex/src/worker.js", () => ({
	startWorkerDetached: hookMocks.startWorkerDetached,
}));

const { sessionStart, stop, userPromptSubmit } = await import("../../../apps/mem-codex/src/hooks.js");

const previousProfile = process.env.SNO_PROFILE_DIR;
const profiles: string[] = [];

beforeEach(async () => {
	vi.clearAllMocks();
	const profile = await mkdtemp(join(tmpdir(), "mem-codex-recall-"));
	profiles.push(profile);
	process.env.SNO_PROFILE_DIR = profile;
});

afterEach(async () => {
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	await Promise.all(profiles.splice(0).map(profile => rm(profile, { recursive: true, force: true })));
});

function memory(id: string, text: string): RecallMemory {
	return { id, text };
}

describe("memory block rendering", () => {
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

		const startup = { ledger: [{ id: "a", chars: 12, hookEvent: "SessionStart" }], ledgerChars: 12 };
		expect(resetLedgerForSource(startup, "startup")).toBe(false);
		expect(startup.ledger).toHaveLength(1);
	});
});

describe("hook capture and session cap", () => {
	it("keeps the prompt for Stop when recall throws", async () => {
		hookMocks.getRecall.mockRejectedValueOnce(new Error("recall unavailable"));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const output = await userPromptSubmit({
				session_id: "session-timeout",
				turn_id: "turn-timeout",
				cwd: "/repo",
				prompt: "Please remember this turn even when recall fails.",
			});
			expect(JSON.parse(output).hookSpecificOutput.additionalContext).toBe("");
			await stop({
				session_id: "session-timeout",
				turn_id: "turn-timeout",
				cwd: "/repo",
				last_assistant_message: "The assistant reply is durable.",
			});
		} finally {
			error.mockRestore();
		}

		const names = await readdir(spoolDirectory());
		expect(names).toHaveLength(1);
		const record = JSON.parse(await readFile(join(spoolDirectory(), names[0] ?? ""), "utf8"));
		expect(record).toMatchObject({
			turnId: "turn-timeout",
			user: "Please remember this turn even when recall fails.",
			assistant: "The assistant reply is durable.",
		});
	});

	it("accounts actual emitted characters and applies the remaining cap to both hook events", async () => {
		hookMocks.getRecall.mockResolvedValue({
			degraded: false,
			toolResult: { details: { memories: [{ id: "one", text: "A compact remembered fact." }] } },
		});
		await writeSession({
			sessionId: "session-cap",
			prompts: {},
			ledger: [],
			ledgerChars: 11_800,
			receipt: {},
		});

		const promptOutput = JSON.parse(await userPromptSubmit({
			session_id: "session-cap",
			turn_id: "turn-cap",
			cwd: "/repo",
			prompt: "Find the compact remembered fact for this request.",
		}));
		const promptBlock = promptOutput.hookSpecificOutput.additionalContext as string;
		const afterPrompt = await readSession("session-cap");
		expect(promptBlock.length).toBeGreaterThan(0);
		expect(afterPrompt.ledgerChars).toBe(11_800 + promptBlock.length);
		expect(afterPrompt.ledgerChars).toBeLessThanOrEqual(12_000);

		await writeSession({
			sessionId: "session-start-cap",
			prompts: {},
			ledger: [],
			ledgerChars: 11_950,
			receipt: {},
		});
		const startOutput = JSON.parse(await sessionStart({
			session_id: "session-start-cap",
			cwd: "/repo",
			source: "resume",
		}));
		expect(startOutput.hookSpecificOutput.additionalContext).toBe("");
		expect((await readSession("session-start-cap")).ledgerChars).toBe(11_950);
	});
});
