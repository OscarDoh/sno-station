import {
	boundedRedactions,
	boundedWarnings,
	MAX_TEXT_CHARS,
	MAX_WARNINGS,
	provenance,
	warning,
	type AtomicSpan,
	type RedactionEvent,
	type SanitizerSource,
	type SanitizerWarning,
	type TranscriptSanitizerResult,
} from "./types.js";
import { redactForStorage } from "./redaction.js";
import { normalizeText } from "./text-hygiene.js";

type VisibleRole = "User" | "Assistant" | "Tool";

interface VisibleMessage {
	role: VisibleRole;
	name?: string;
	text: string;
	atomic: boolean;
}

function pushTranscriptWarning(warnings: SanitizerWarning[], event: SanitizerWarning): void {
	if (warnings.length < MAX_WARNINGS - 1) {
		warnings.push(event);
		return;
	}
	if (!warnings.some((existing) => existing.code === "warnings_truncated")) {
		warnings.push(warning("warnings_truncated", "Additional sanitizer warnings were truncated"));
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeRole(role: unknown, type?: unknown): VisibleRole | undefined {
	if (role === "user") return "User";
	if (role === "assistant") return "Assistant";
	if (role === "tool" || type === "tool_result") return "Tool";
	return undefined;
}

function isHiddenPartType(type: unknown): boolean {
	return type === "thinking" || type === "reasoning" || type === "output";
}

function extractContentParts(value: unknown, warnings: SanitizerWarning[]): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) {
		const out: string[] = [];
		for (const part of value) {
			const record = asRecord(part);
			if (!record) continue;
			const type = record["type"];
			const text = record["text"];
				if ((type === "text" || type === undefined) && typeof text === "string") {
					out.push(text);
				} else if (isHiddenPartType(type)) {
					pushTranscriptWarning(
						warnings,
						warning("hidden_transcript_part_removed", "Hidden transcript part was removed"),
					);
				} else if (typeof type === "string") {
					out.push(`[unsupported ${type} part]`);
					pushTranscriptWarning(
						warnings,
						warning("unsupported_transcript_part", "Unsupported transcript part was replaced"),
					);
				}
		}
		return out;
	}
	const record = asRecord(value);
	const text = record?.["text"];
	if (typeof text === "string") return [text];
	return [];
}

function extractMessage(value: unknown, warnings: SanitizerWarning[]): VisibleMessage | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const type = record["type"];
	const message = asRecord(record["message"]) ?? record;
	const messageRole = message["role"];
		const role = normalizeRole(messageRole, type);
		if (!role) {
			if (messageRole === "system" || messageRole === "developer" || type === "thinking") {
				pushTranscriptWarning(
					warnings,
					warning("hidden_role_removed", "Hidden or control transcript item was removed"),
				);
			}
			return undefined;
		}
	const messageContent = message["content"];
	const content = type === "tool_result" && messageContent === undefined ? record["content"] : messageContent;
	const parts = extractContentParts(content, warnings);
	if (parts.length === 0) return undefined;
	const messageName = message["name"];
	const recordName = record["name"];
	const name =
		typeof messageName === "string"
			? messageName
			: typeof recordName === "string"
				? recordName
				: undefined;
	return {
		role,
		...(name ? { name } : {}),
		text: parts.join("\n"),
		atomic: role === "Tool",
	};
}

function normalizeMessages(value: unknown, warnings: SanitizerWarning[]): VisibleMessage[] {
	if (typeof value === "string") {
		return [{ role: "User", text: value, atomic: false }];
	}
	const record = asRecord(value);
	if (Array.isArray(value)) {
		return value.flatMap((item) => {
			const message = extractMessage(item, warnings);
			return message ? [message] : [];
		});
	}
	const messages = record?.["messages"];
	if (Array.isArray(messages)) {
		return normalizeMessages(messages, warnings);
	}
	const single = extractMessage(value, warnings);
	return single ? [single] : [];
}

function sanitizeTranscriptText(text: string, source: SanitizerSource): {
	text: string;
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	truncated: boolean;
} {
	const normalized = normalizeText(text, { preserveLines: true });
	const redacted = redactForStorage(normalized.text, { source, contentType: "chat_messages" });
	return {
		text: redacted.text,
		redactions: redacted.redactions,
		warnings: boundedWarnings([...normalized.warnings, ...redacted.warnings]),
		truncated: normalized.truncated || redacted.provenance.truncated,
	};
}

function renderMessages(messages: Iterable<VisibleMessage>, source: SanitizerSource): TranscriptSanitizerResult {
	const warnings: SanitizerWarning[] = [];
	const redactions: RedactionEvent[] = [];
	const lines: string[] = [];
	const atomicSpans: AtomicSpan[] = [];
	let truncated = false;
	let aggregateTruncated = false;
	let transcriptLength = 0;

	for (const message of messages) {
		const sanitized = sanitizeTranscriptText(message.text, source);
		redactions.push(...sanitized.redactions);
		warnings.push(...sanitized.warnings);
		truncated = truncated || sanitized.truncated;
		const text = sanitized.text.trim();
		if (!text) continue;
		const previous = lines.at(-1);
		const prefix = message.role === "Tool" ? `Tool ${message.name ?? "result"}:` : `${message.role}:`;
		if (previous?.startsWith(prefix) && message.role !== "Tool") {
			const addition = `\n${text}`;
			const available = MAX_TEXT_CHARS - transcriptLength;
			if (available <= 0) {
				aggregateTruncated = true;
				break;
			}
			const clipped = addition.slice(0, available);
			lines[lines.length - 1] = `${previous}${clipped}`;
			transcriptLength += clipped.length;
			if (clipped.length < addition.length) {
				aggregateTruncated = true;
				break;
			}
		} else {
			const rendered = `${prefix} ${text}`;
			const separatorLength = lines.length > 0 ? 1 : 0;
			const available = MAX_TEXT_CHARS - transcriptLength - separatorLength;
			if (available <= 0) {
				aggregateTruncated = true;
				break;
			}
			const clipped = rendered.slice(0, available);
			const startOffset = transcriptLength + separatorLength;
			lines.push(clipped);
			transcriptLength += separatorLength + clipped.length;
			if (message.atomic) {
				atomicSpans.push({
					startOffset,
					endOffset: startOffset + clipped.length,
					reason: "tool-result",
				});
			}
			if (clipped.length < rendered.length) {
				aggregateTruncated = true;
				break;
			}
		}
	}
	if (aggregateTruncated) {
		truncated = true;
		pushTranscriptWarning(
			warnings,
			warning("content_truncated", "Transcript exceeded sanitizer text limit", undefined, MAX_TEXT_CHARS),
		);
	}

	return {
		transcriptText: lines.join("\n"),
		atomicSpans,
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings(warnings),
		provenance: provenance(
			source,
			"chat_messages",
			[
				"transcript-visible-roles-projected",
				"hidden-control-content-removed",
				...(atomicSpans.length > 0 ? ["atomic-spans-detected"] : []),
			],
			truncated,
		),
	};
}

export function sanitizeTranscript(
	value: unknown,
	options: { source?: SanitizerSource } = {},
): TranscriptSanitizerResult {
	const record = asRecord(value);
	const source = options.source ?? (record?.["source"] as SanitizerSource | undefined) ?? "generic-chat";
	const warnings: SanitizerWarning[] = [];
	const messages = normalizeMessages(record?.["messages"] ?? value, warnings);
	const rendered = renderMessages(messages, source);
	return {
		...rendered,
		warnings: boundedWarnings([...warnings, ...rendered.warnings]),
	};
}

function* replayLines(text: string): Generator<{ line: string; index: number }> {
	let start = 0;
	let index = 0;
	while (start <= text.length) {
		const nextLine = text.indexOf("\n", start);
		const end = nextLine === -1 ? text.length : nextLine;
		const rawLine = text.slice(start, end);
		yield { line: rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, index };
		if (nextLine === -1) return;
		start = nextLine + 1;
		index += 1;
	}
}

function* replayMessages(text: string, warnings: SanitizerWarning[]): Generator<VisibleMessage> {
	for (const { line, index } of replayLines(text)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			const record = asRecord(parsed);
			if (record?.["type"] === "thinking" || record?.["type"] === "reasoning") {
				pushTranscriptWarning(
					warnings,
					warning("hidden_replay_record_removed", "Hidden replay record was removed"),
				);
				continue;
			}
			const message = extractMessage(parsed, warnings);
			if (message) yield message;
		} catch {
			pushTranscriptWarning(
				warnings,
				warning("malformed_jsonl_line", "Malformed JSONL line was skipped", `$[${index}]`),
			);
		}
	}
}

export function parseReplayJsonl(
	text: string,
	options: { source?: SanitizerSource } = {},
): TranscriptSanitizerResult {
	const source = options.source ?? "generic-chat";
	const warnings: SanitizerWarning[] = [];
	const rendered = renderMessages(replayMessages(text, warnings), source);
	return {
		...rendered,
		provenance: provenance(
			source,
			"jsonl_transcript",
			["jsonl-replay-parsed", ...rendered.provenance.decisions],
			rendered.provenance.truncated,
		),
		warnings: boundedWarnings([...warnings, ...rendered.warnings]),
	};
}
