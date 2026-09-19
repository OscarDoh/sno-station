/** @file Loads the two frozen recall trace sets (STP-1 inputs) as served-row lists per question.
 *
 * The traces are what recall actually served on 2026-09-02 (the baseline of record) and on the
 * 2026-09-04 run that was stopped after three personas. Each line carries the whole request that
 * was assembled for one question, with the served memories as a numbered list. Both the QCG-1
 * budget replay and the QCG-12 group-reservation replay read them through this one loader.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
export const BASELINE_TRACES = join(
	REPO_ROOT,
	"evals/memora/results/full-weekly-90-20260902/traces",
);
export const STOPPED_TRACES = join(
	REPO_ROOT,
	"evals/memora/results/87003cac9001edee77c9bd52e4ce5ec8910e280e-dirty-444fc29e/traces",
);

export interface TraceQuestion {
	set: string;
	persona: string;
	id: string;
	rows: string[];
}

/**
 * Split one assembled request back into the memory rows it served.
 *
 * The runner renders them as a numbered list under "Relevant Memories:", one entry per served
 * row, and an entry may run over several lines. Splitting on a line that begins a new number is
 * therefore the only faithful reconstruction; anything finer would invent a row boundary the
 * served text does not have.
 */
export function splitServedRows(assembled: unknown, where: string): string[] {
	const messages = (assembled as { messages?: { role: string; content: string }[] })?.messages;
	if (!Array.isArray(messages)) throw new Error(`${where}: assembled_request has no messages`);
	const user = messages.find((message) => message.role === "user");
	if (!user) throw new Error(`${where}: assembled_request has no user message`);
	const marker = user.content.indexOf("Relevant Memories:");
	if (marker === -1) throw new Error(`${where}: user message has no "Relevant Memories:" block`);
	const block = user.content.slice(marker + "Relevant Memories:".length);
	const rows: string[] = [];
	for (const line of block.split("\n")) {
		if (/^\d+\.\s/.test(line)) rows.push(line.replace(/^\d+\.\s/, ""));
		else if (rows.length > 0) rows[rows.length - 1] += `\n${line}`;
	}
	return rows.map((row) => row.trim()).filter((row) => row.length > 0);
}

export function loadTraceSet(dir: string, label: string): TraceQuestion[] {
	if (!existsSync(dir)) throw new Error(`trace set missing: ${dir}`);
	const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort();
	if (files.length === 0) throw new Error(`trace set has no .jsonl files: ${dir}`);
	const questions: TraceQuestion[] = [];
	for (const file of files) {
		const path = join(dir, file);
		const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
		if (lines.length === 0) throw new Error(`trace file is empty: ${path}`);
		for (const [index, line] of lines.entries()) {
			const record = JSON.parse(line) as {
				question_id?: string;
				persona?: string;
				assembled_request?: unknown;
			};
			const where = `${path}:${index + 1}`;
			if (!record.question_id) throw new Error(`${where}: no question_id`);
			questions.push({
				set: label,
				persona: record.persona ?? file.replace(".jsonl", ""),
				id: record.question_id,
				rows: splitServedRows(record.assembled_request, where),
			});
		}
	}
	return questions;
}
