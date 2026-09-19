import { performance } from "node:perf_hooks";
import {
	CODING_SKIN_LEDGER_MAX_CHARS,
	CODING_SKIN_PROMPT_CONTEXT_MAX_CHARS,
	CODING_SKIN_PROMPT_MIN_CHARS,
	CODING_SKIN_PROMPT_RECALL_LIMIT,
	CODING_SKIN_PROMPT_TIMEOUT_MS,
	CODING_SKIN_SESSION_CONTEXT_MAX_CHARS,
	CODING_SKIN_SESSION_QUERY,
	CODING_SKIN_SESSION_RECALL_LIMIT,
	CODING_SKIN_SESSION_TIMEOUT_MS,
} from "@snoai/sno-station-mem/coding-skin";
import { z } from "zod";
import { sidecarStatus } from "./doctor.js";
import { importReceiptExists, importRepository } from "./import.js";
import { connectMemory, isDegradedConnection } from "./memory-client.js";
import {
	applyInjectedMemories,
	buildMemoryBlock,
	recallMemories,
	resetLedgerForSource,
	selectUnseenMemories,
	withinDeadline,
} from "./recall.js";
import { hookScope, repositoryRoot } from "./scope.js";
import { startWorkerDetached } from "./worker.js";
import {
	appendSpool,
	readSession,
	recordDegraded,
	recordInjection,
	recordInvocation,
	recordLedgerReset,
	recordLookup,
	recordSkip,
	writeSession,
} from "./session-state.js";

const baseHookSchema = z.object({
	session_id: z.string().min(1),
	cwd: z.string().min(1),
});
const sessionStartSchema = baseHookSchema.extend({ source: z.enum(["startup", "resume", "clear", "compact"]) });
const promptSchema = baseHookSchema.extend({ turn_id: z.string().min(1), prompt: z.string() });
const stopSchema = baseHookSchema.extend({ turn_id: z.string().min(1), last_assistant_message: z.string() });

function emptyEnvelope(event: "SessionStart" | "UserPromptSubmit"): string {
	return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: "" } });
}

function closedReason(error: unknown): string {
	if (error instanceof z.ZodError) return "invalid-input";
	if (error instanceof Error && error.name === "TimeoutError") return "timeout";
	return "engine-failed";
}

async function persistSkip(sessionId: string, event: string, reason: string, started: number): Promise<void> {
	const state = await readSession(sessionId);
	recordSkip(state, event, reason);
	recordInvocation(state, event, performance.now() - started);
	await writeSession(state);
}

export async function sessionStart(raw: unknown): Promise<string> {
	const started = performance.now();
	try {
		const input = sessionStartSchema.parse(raw);
		const project = await repositoryRoot(input.cwd);
		if (!project) {
			await persistSkip(input.session_id, "SessionStart", "no-repository-root", started);
			return emptyEnvelope("SessionStart");
		}
		const state = await readSession(input.session_id);
		if (resetLedgerForSource(state, input.source)) recordLedgerReset(state, "SessionStart");
		if (!await importReceiptExists(project)) await importRepository(project);
		if (state.ledgerChars >= CODING_SKIN_LEDGER_MAX_CHARS) {
			recordSkip(state, "SessionStart", "session-cap");
			recordInvocation(state, "SessionStart", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("SessionStart");
		}
		if (await sidecarStatus() !== "healthy") {
			recordDegraded(state, "SessionStart", "sidecar-unreachable");
			recordInvocation(state, "SessionStart", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("SessionStart");
		}
		const client = await connectMemory();
		if (isDegradedConnection(client)) {
			recordDegraded(state, "SessionStart", client.reason);
			recordInvocation(state, "SessionStart", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("SessionStart");
		}
		recordLookup(state, "SessionStart");
		const recalled = await withinDeadline(
			client.getRecall(CODING_SKIN_SESSION_QUERY, hookScope(project, input.session_id), { source: "manual", limit: CODING_SKIN_SESSION_RECALL_LIMIT, includeMetadata: true }),
			CODING_SKIN_SESSION_TIMEOUT_MS,
		);
		if (recalled.degraded) recordDegraded(state, "SessionStart", recalled.reason);
		const remainingCap = Math.min(CODING_SKIN_SESSION_CONTEXT_MAX_CHARS, CODING_SKIN_LEDGER_MAX_CHARS - state.ledgerChars);
		const block = recalled.degraded
			? { text: "", memories: [] }
			: buildMemoryBlock(selectUnseenMemories(recallMemories(recalled), state), remainingCap, CODING_SKIN_SESSION_RECALL_LIMIT);
		applyInjectedMemories(state, block.memories, "SessionStart", block.text.length);
		recordInjection(state, "SessionStart", block.memories.length, block.text.length);
		recordInvocation(state, "SessionStart", performance.now() - started);
		await writeSession(state);
		return block.text ? JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: block.text } }) : emptyEnvelope("SessionStart");
	} catch (error) {
		console.error(JSON.stringify({ event: "session-start", reason: closedReason(error) }));
		return emptyEnvelope("SessionStart");
	}
}

export async function userPromptSubmit(raw: unknown): Promise<string> {
	const started = performance.now();
	try {
		const input = promptSchema.parse(raw);
		const project = await repositoryRoot(input.cwd);
		if (!project) {
			await persistSkip(input.session_id, "UserPromptSubmit", "no-repository-root", started);
			return emptyEnvelope("UserPromptSubmit");
		}
		const state = await readSession(input.session_id);
		state.prompts[input.turn_id] = { prompt: input.prompt, at: Date.now() };
		await writeSession(state);
		if (input.prompt.trim().length < CODING_SKIN_PROMPT_MIN_CHARS) {
			recordSkip(state, "UserPromptSubmit", "short-prompt");
			recordInvocation(state, "UserPromptSubmit", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("UserPromptSubmit");
		}
		if (state.ledgerChars >= CODING_SKIN_LEDGER_MAX_CHARS) {
			recordSkip(state, "UserPromptSubmit", "session-cap");
			recordInvocation(state, "UserPromptSubmit", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("UserPromptSubmit");
		}
		if (await sidecarStatus() !== "healthy") {
			recordDegraded(state, "UserPromptSubmit", "sidecar-unreachable");
			recordInvocation(state, "UserPromptSubmit", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("UserPromptSubmit");
		}
		const client = await connectMemory();
		if (isDegradedConnection(client)) {
			recordDegraded(state, "UserPromptSubmit", client.reason);
			recordInvocation(state, "UserPromptSubmit", performance.now() - started);
			await writeSession(state);
			return emptyEnvelope("UserPromptSubmit");
		}
		recordLookup(state, "UserPromptSubmit");
		const recalled = await withinDeadline(
			client.getRecall(input.prompt, hookScope(project, input.session_id), { source: "manual", limit: CODING_SKIN_PROMPT_RECALL_LIMIT, includeMetadata: true }),
			CODING_SKIN_PROMPT_TIMEOUT_MS,
		);
		if (recalled.degraded) recordDegraded(state, "UserPromptSubmit", recalled.reason);
		const remainingCap = Math.min(CODING_SKIN_PROMPT_CONTEXT_MAX_CHARS, CODING_SKIN_LEDGER_MAX_CHARS - state.ledgerChars);
		const block = recalled.degraded
			? { text: "", memories: [] }
			: buildMemoryBlock(selectUnseenMemories(recallMemories(recalled), state), remainingCap, CODING_SKIN_PROMPT_RECALL_LIMIT);
		applyInjectedMemories(state, block.memories, "UserPromptSubmit", block.text.length, input.turn_id);
		recordInjection(state, "UserPromptSubmit", block.memories.length, block.text.length);
		recordInvocation(state, "UserPromptSubmit", performance.now() - started);
		await writeSession(state);
		return block.text ? JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: block.text } }) : emptyEnvelope("UserPromptSubmit");
	} catch (error) {
		console.error(JSON.stringify({ event: "user-prompt-submit", reason: closedReason(error) }));
		return emptyEnvelope("UserPromptSubmit");
	}
}

export async function stop(raw: unknown): Promise<void> {
	const started = performance.now();
	let sessionId: string | undefined;
	try {
		const input = stopSchema.parse(raw);
		sessionId = input.session_id;
		const project = await repositoryRoot(input.cwd);
		if (!project) {
			await persistSkip(input.session_id, "Stop", "no-repository-root", started);
			return;
		}
		const state = await readSession(input.session_id);
		const prompt = state.prompts[input.turn_id]?.prompt.trim() ?? "";
		const assistant = input.last_assistant_message.trim();
		if (!prompt || !assistant) {
			recordSkip(state, "Stop", "empty-turn");
		} else {
			await appendSpool({
				sessionId: input.session_id,
				turnId: input.turn_id,
				project,
				childCwd: project,
				user: prompt,
				assistant,
				at: Date.now(),
			});
			startWorkerDetached();
		}
		recordInvocation(state, "Stop", performance.now() - started);
		await writeSession(state);
	} catch (error) {
		const reason = closedReason(error);
		console.error(JSON.stringify({ event: "stop", reason }));
		if (sessionId) {
			try {
				const state = await readSession(sessionId);
				recordDegraded(state, "Stop", reason);
				recordInvocation(state, "Stop", performance.now() - started);
				await writeSession(state);
			} catch {
				// The hook still exits successfully when even its receipt cannot be written.
			}
		}
	}
}
