import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type { JsonValue } from "@snoai/sno-station-mem/client";
import {
	CODING_SKIN_CORRECTION_LOCK_STALE_MS,
	CODING_SKIN_EXPLICIT_RECALL_LIMIT,
} from "@snoai/sno-station-mem/coding-skin";
import { z } from "zod";
import { acquirePidFileLock, writeJsonAtomic } from "./files.js";
import { isDegradedConnection, connectMemory } from "./memory-client.js";
import { correctionLockPath, correctionStatePath } from "./paths.js";
import { recallMemories, renderMemoryLine } from "./recall.js";
import { manualScope, repositoryRoot } from "./scope.js";

export interface CommandResult {
	ok: boolean;
	text: string;
}

const correctionStateSchema = z.object({
	marker: z.string().startsWith("pending:"),
	textHash: z.string().length(64),
	newId: z.string().min(1).optional(),
});

type CorrectionState = z.infer<typeof correctionStateSchema>;

const correctionRecallSchema = z.object({
	toolResult: z.object({
		details: z.object({
			memories: z.array(z.object({
				id: z.string().min(1),
				text: z.string(),
				metadata: z.unknown().optional(),
			})),
		}),
	}),
});

function correctionTextHash(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

async function readCorrectionState(id: string): Promise<CorrectionState | undefined> {
	try {
		return correctionStateSchema.parse(JSON.parse(await readFile(correctionStatePath(id), "utf8")));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

function metadataRecord(value: unknown): Record<string, JsonValue> {
	if (typeof value === "string") {
		try { return metadataRecord(JSON.parse(value) as JsonValue); } catch { return {}; }
	}
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

async function context(): Promise<
	| { ok: true; client: Exclude<Awaited<ReturnType<typeof connectMemory>>, { degraded: true }>; project: string }
	| { ok: false; reason: string }
> {
	const project = await repositoryRoot(process.cwd());
	if (!project) return { ok: false, reason: "no-repository-root" };
	const client = await connectMemory();
	if (isDegradedConnection(client)) return { ok: false, reason: client.reason };
	return { ok: true, client, project };
}

export async function recallCommand(query: string): Promise<CommandResult> {
	if (!query.trim()) return { ok: false, text: "invalid-input" };
	const current = await context();
	if (!current.ok) return { ok: false, text: current.reason };
	const recalled = await current.client.getRecall(query, manualScope(current.project), {
		source: "manual",
		limit: CODING_SKIN_EXPLICIT_RECALL_LIMIT,
		includeMetadata: true,
	});
	if (recalled.degraded) return { ok: false, text: recalled.reason };
	if (recalled.toolResult?.isError) {
		const reason = recalled.toolResult.details["errorCode"];
		return { ok: false, text: typeof reason === "string" ? reason : "engine-failed" };
	}
	const memories = recallMemories(recalled);
	const text = memories.map(memory => `${memory.id}\t${renderMemoryLine(memory)}\n${memory.text}`).join("\n\n");
	return { ok: true, text: text || "No relevant memories found." };
}

export async function getCommand(id: string): Promise<CommandResult> {
	if (!id.trim()) return { ok: false, text: "invalid-input" };
	const current = await context();
	if (!current.ok) return { ok: false, text: current.reason };
	const inspected = await current.client.inspect({ op: "get", id }, manualScope(current.project));
	if (inspected.degraded) return { ok: false, text: inspected.reason };
	if (inspected.result.op !== "get" || !inspected.result.entry) return { ok: false, text: "not-found" };
	const entry = inspected.result.entry;
	const supersededBy = metadataRecord(entry.metadata)["supersededBy"];
	return { ok: true, text: `${entry.id}\n${entry.text}${typeof supersededBy === "string" ? `\nsuperseded by ${supersededBy}` : ""}` };
}

export async function rememberCommand(text: string): Promise<CommandResult> {
	if (!text.trim()) return { ok: false, text: "invalid-input" };
	const current = await context();
	if (!current.ok) return { ok: false, text: current.reason };
	const stored = await current.client.mutate({ op: "store", content: text, category: "episodic" }, manualScope(current.project));
	if (stored.degraded) return { ok: false, text: stored.reason };
	if (stored.result.isError) {
		const reason = stored.result.details["errorCode"];
		return { ok: false, text: typeof reason === "string" ? reason : "engine-failed" };
	}
	const id = stored.result.details["id"];
	return typeof id === "string" ? { ok: true, text: id } : { ok: false, text: "engine-failed" };
}

export async function correctCommand(id: string, text: string): Promise<CommandResult> {
	if (!id.trim() || !text.trim()) return { ok: false, text: "invalid-input" };
	const current = await context();
	if (!current.ok) return { ok: false, text: current.reason };
	const lock = await acquirePidFileLock(correctionLockPath(id), CODING_SKIN_CORRECTION_LOCK_STALE_MS);
	if (!lock) return { ok: false, text: "correction-in-progress" };
	const statePath = correctionStatePath(id);
	try {
		const scope = manualScope(current.project);
		const inspected = await current.client.inspect({ op: "get", id }, scope);
		if (inspected.degraded) return { ok: false, text: inspected.reason };
		if (inspected.result.op !== "get" || !inspected.result.entry) return { ok: false, text: "not-found" };
		const old = inspected.result.entry;
		const oldMetadata = metadataRecord(old.metadata);
		const existingSuccessor = oldMetadata["supersededBy"];
		let correctionState = await readCorrectionState(id);
		if (typeof existingSuccessor === "string" && !existingSuccessor.startsWith("pending:")) {
			if (correctionState) await unlink(statePath).catch(() => undefined);
			return { ok: false, text: `superseded by ${existingSuccessor}; correct that id` };
		}
		const textHash = correctionTextHash(text);
		if (typeof existingSuccessor === "string") {
			if (!correctionState || correctionState.marker !== existingSuccessor || correctionState.textHash !== textHash) {
				return { ok: false, text: "correction-in-progress" };
			}
		} else {
			if (correctionState) await unlink(statePath).catch(() => undefined);
			correctionState = { marker: `pending:${randomUUID()}`, textHash };
			await writeJsonAtomic(statePath, correctionState);
			const pending = await current.client.mutate({
				op: "update",
				id,
				metadata: { ...oldMetadata, supersededBy: correctionState.marker },
			}, scope);
			if (pending.degraded || pending.result.isError) {
				const reason = pending.degraded ? pending.reason : pending.result.details["errorCode"];
				return { ok: false, text: typeof reason === "string" ? reason : "engine-failed" };
			}
		}
		let newId = correctionState.newId;
		if (!newId && typeof existingSuccessor === "string") {
			const recalled = await current.client.getRecall(text, scope, { source: "manual", limit: CODING_SKIN_EXPLICIT_RECALL_LIMIT, includeMetadata: true });
			if (recalled.degraded) return { ok: false, text: recalled.reason };
			if (recalled.toolResult?.isError) {
				const reason = recalled.toolResult.details["errorCode"];
				return { ok: false, text: typeof reason === "string" ? reason : "engine-failed" };
			}
			const parsed = correctionRecallSchema.safeParse(recalled);
			const nonce = correctionState.marker.slice("pending:".length);
			newId = parsed.success
				? parsed.data.toolResult.details.memories.find(memory => {
					const metadata = metadataRecord(memory.metadata);
					return metadata["correctionOf"] === id && metadata["correctionNonce"] === nonce;
				})?.id
				: undefined;
			if (newId) {
				correctionState = { ...correctionState, newId };
				await writeJsonAtomic(statePath, correctionState);
			}
		}
		if (!newId) {
			const nonce = correctionState.marker.slice("pending:".length);
			const stored = await current.client.mutate({
				op: "store",
				content: text,
				category: old.category,
				metadata: { correctionOf: id, correctionNonce: nonce },
			}, scope);
			if (stored.degraded) return { ok: false, text: stored.reason };
			if (stored.result.isError) {
				const reason = stored.result.details["errorCode"];
				return { ok: false, text: typeof reason === "string" ? reason : "engine-failed" };
			}
			const storedId = stored.result.details["id"];
			if (typeof storedId !== "string") return { ok: false, text: "engine-failed" };
			newId = storedId;
			correctionState = { ...correctionState, newId };
			await writeJsonAtomic(statePath, correctionState);
		}
		const updated = await current.client.mutate({
			op: "update",
			id,
			metadata: { ...oldMetadata, supersededBy: newId, correctedAt: Date.now() },
		}, scope);
		if (updated.degraded || updated.result.isError) {
			const reason = updated.degraded ? updated.reason : updated.result.details["errorCode"];
			return { ok: false, text: `${id} ${newId} update_failed ${typeof reason === "string" ? reason : "engine-failed"}` };
		}
		await unlink(statePath).catch(() => undefined);
		return { ok: true, text: newId };
	} finally {
		await lock.release();
	}
}
