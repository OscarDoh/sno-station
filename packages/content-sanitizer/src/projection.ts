import type { ContentType } from "@snoai/chunking";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import {
	boundedRedactions,
	boundedWarnings,
	MAX_TEXT_CHARS,
	provenance,
	SanitizerInputSchema,
	warning,
	type HtmlProjectionResult,
	type ParsedSanitizerInput,
	type RedactionEvent,
	type RichTextProjectionResult,
	type SanitizedContent,
	type SanitizerContentType,
	type SanitizerInput,
	type SanitizerSource,
	type SanitizerWarning,
	type StructuredJsonSanitizerResult,
	type TextSanitizerResult,
} from "./types.js";
import {
	isOnlyRedactionMarkers,
	isSecretFieldName,
	redactForStorage,
	redactPrivateBlocksForStorage,
	redactStructuredSecretValue,
} from "./redaction.js";
import { normalizeText, stableInputHash, stripHtmlTags } from "./text-hygiene.js";
import { parseReplayJsonl, sanitizeTranscript } from "./transcript.js";

const REDACTION_LOOKAHEAD_CHARS = 4096;
const DANGEROUS_HTML_TAGS = ["script", "style", "iframe", "object", "embed", "noscript"];
const STRUCTURAL_HTML_TAGS = [
	"article",
	"aside",
	"details",
	"figcaption",
	"figure",
	"footer",
	"header",
	"main",
	"nav",
	"section",
	"summary",
	"time",
];
const RICH_TEXT_NODE_TYPES = new Set([
	"blockquote",
	"bulletList",
	"codeBlock",
	"doc",
	"hardBreak",
	"heading",
	"image",
	"listItem",
	"orderedList",
	"paragraph",
	"table",
	"tableCell",
	"tableHeader",
	"tableRow",
	"text",
]);

function appendRedactions(target: RedactionEvent[], source: RedactionEvent[]): void {
	for (const event of source) {
		const existing = target.find(
			(candidate) =>
				candidate.kind === event.kind &&
				candidate.class === event.class &&
				candidate.path === event.path,
		);
		if (existing) {
			existing.count += event.count;
		} else {
			target.push({ ...event });
		}
	}
}

export function sanitizePlainText(
	text: string,
	options: { source?: SanitizerSource; contentType?: SanitizerContentType; preserveLines?: boolean } = {},
): TextSanitizerResult {
	const source = options.source ?? "generic-text";
	const contentType = options.contentType ?? "plain_text";
	const preserveLines = options.preserveLines ?? true;
	const boundedInput =
		text.length > MAX_TEXT_CHARS + REDACTION_LOOKAHEAD_CHARS
			? text.slice(0, MAX_TEXT_CHARS + REDACTION_LOOKAHEAD_CHARS)
			: text;
	const normalized = normalizeText(boundedInput, {
		preserveLines,
		maxTextChars: MAX_TEXT_CHARS + REDACTION_LOOKAHEAD_CHARS,
	});
	const inputExceededLimit = text.length > MAX_TEXT_CHARS;
	const redacted = redactForStorage(normalized.text, { source, contentType });
	const bounded = normalizeText(redacted.text, { preserveLines, maxTextChars: MAX_TEXT_CHARS });
	const warnings = [...normalized.warnings, ...redacted.warnings, ...bounded.warnings];
	if (inputExceededLimit && !bounded.truncated) {
		warnings.push(
			warning("content_truncated", "Input exceeded sanitizer text limit", undefined, normalized.text.length),
		);
	}
	return {
		text: bounded.text,
		redactions: redacted.redactions,
		warnings: boundedWarnings(warnings),
		provenance: provenance(
			source,
			contentType,
			["plain-text-normalized", ...redacted.provenance.decisions],
			inputExceededLimit || bounded.truncated,
		),
	};
}

export function projectHtml(
	html: string,
	options: { source?: SanitizerSource; contentType?: SanitizerContentType } = {},
): HtmlProjectionResult {
	const source = options.source ?? "document";
	const contentType = options.contentType ?? "html";
	const rawRedacted = redactPrivateBlocksForStorage(html, { source, contentType });
	const allowedTags = Array.from(
		new Set([
			...sanitizeHtml.defaults.allowedTags.filter(
				(tag) => !DANGEROUS_HTML_TAGS.includes(tag),
			),
			...STRUCTURAL_HTML_TAGS,
		]),
	);
	const cleaned = sanitizeHtml(rawRedacted.text, {
		allowedTags,
		allowedAttributes: {
			a: ["href", "name", "target", "rel"],
			img: ["alt", "title"],
			blockquote: ["cite"],
		},
		allowedSchemes: ["http", "https", "mailto"],
		disallowedTagsMode: "discard",
		enforceHtmlBoundary: false,
	});
	const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	const markdownRaw = turndown.turndown(cleaned);
	const plainRaw = stripHtmlTags(cleaned);
	const plain = sanitizePlainText(plainRaw, { source, contentType, preserveLines: true });
	const markdown = sanitizePlainText(markdownRaw, { source, contentType: "markdown", preserveLines: true });
	const redactions = [...rawRedacted.redactions, ...plain.redactions];
	appendRedactions(redactions, markdown.redactions);
	const warnings = [...rawRedacted.warnings, ...plain.warnings, ...markdown.warnings];
	const truncated =
		plain.provenance.truncated ||
		markdown.provenance.truncated ||
		warnings.some((event) => event.code === "content_truncated");
	return {
		plainText: plain.text,
		markdownText: markdown.text,
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings(warnings),
		provenance: provenance(source, contentType, ["html-sanitized", "html-projected-to-markdown"], truncated),
	};
}

function collectRichText(
	value: unknown,
	path: string,
	warnings: SanitizerWarning[],
	seen: WeakSet<object>,
): string[] {
	if (typeof value === "string") return [value];
	if (typeof value === "number" || typeof value === "boolean") return [String(value)];
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) {
		if (seen.has(value)) {
			warnings.push(warning("rich_text_cycle_removed", "Cyclic rich text node was removed", path));
			return [];
		}
		seen.add(value);
		const out = value.flatMap((item, index) => collectRichText(item, `${path}[${index}]`, warnings, seen));
		seen.delete(value);
		return out;
	}
	if (typeof value !== "object") return [];
	if (seen.has(value)) {
		warnings.push(warning("rich_text_cycle_removed", "Cyclic rich text node was removed", path));
		return [];
	}
	seen.add(value);
	const record = value as Record<string, unknown>;
	const chunks: string[] = [];
	const recordText = record["text"];
	if (typeof recordText === "string") chunks.push(recordText);
	const recordValue = record["value"];
	if (typeof recordValue === "string") chunks.push(recordValue);
	const content = record["content"];
	if (Array.isArray(content)) {
		const recordType = record["type"];
		const type = typeof recordType === "string" ? recordType : "";
		const childText = content.flatMap((item, index) =>
			collectRichText(item, `${path}.content[${index}]`, warnings, seen),
		);
		chunks.push(childText.join(type === "paragraph" ? " " : "\n"));
	}
	const children = record["children"];
	if (Array.isArray(children)) {
		chunks.push(
			children
				.flatMap((item, index) =>
					collectRichText(item, `${path}.children[${index}]`, warnings, seen),
				)
				.join("\n"),
		);
	}
	if (chunks.length === 0 && Object.keys(record).length > 128) {
		warnings.push(warning("rich_text_node_skipped", "Oversized rich text node was skipped", path));
	}
	seen.delete(value);
	return chunks.filter((chunk) => chunk.trim().length > 0);
}

export function projectRichText(
	value: unknown,
	options: { source?: SanitizerSource; contentType?: SanitizerContentType } = {},
): RichTextProjectionResult {
	const source = options.source ?? "document";
	const contentType = options.contentType ?? "rich_text_json";
	const warnings: SanitizerWarning[] = [];
	const text = collectRichText(value, "$", warnings, new WeakSet()).join("\n");
	const sanitized = sanitizePlainText(text, { source, contentType, preserveLines: true });
	return {
		plainText: sanitized.text,
		redactions: sanitized.redactions,
		warnings: boundedWarnings([...warnings, ...sanitized.warnings]),
		provenance: provenance(source, contentType, ["rich-text-projected"], sanitized.provenance.truncated),
	};
}

function withRedactionPath(event: RedactionEvent, path: string): RedactionEvent {
	if (event.path) return event;
	return { ...event, path };
}

function withWarningPath(event: SanitizerWarning, path: string): SanitizerWarning {
	if (event.path) return event;
	return { ...event, path };
}

export function sanitizeStructuredJsonForStorage(
	value: unknown,
	options: { source?: SanitizerSource; contentType?: SanitizerContentType } = {},
): StructuredJsonSanitizerResult {
	const source = options.source ?? "generic-text";
	const contentType = options.contentType ?? "structured_json";
	const redactions: RedactionEvent[] = [];
	const warnings: SanitizerWarning[] = [];
	const seen = new WeakSet<object>();
	function walk(node: unknown, path: string): unknown {
		if (node === null || node === undefined) return node;
		if (typeof node === "string") {
			const sanitized = sanitizePlainText(node, { source, contentType, preserveLines: true });
			appendRedactions(
				redactions,
				sanitized.redactions.map((event) => withRedactionPath(event, path)),
			);
			warnings.push(...sanitized.warnings.map((event) => withWarningPath(event, path)));
			return sanitized.text;
		}
		if (typeof node === "number" || typeof node === "boolean") {
			return node;
		}
		if (typeof node === "bigint") return `${node.toString()}n`;
		if (typeof node !== "object") return "[unsupported]";
		if (seen.has(node)) {
			warnings.push(warning("structured_json_cycle_removed", "Cyclic structured JSON field was removed", path));
			return "[Circular]";
		}
		seen.add(node);
		if (Array.isArray(node)) {
			const out = node.map((item, index) => walk(item, `${path}[${index}]`));
			seen.delete(node);
			return out;
		}
		const prototype = Object.getPrototypeOf(node);
		if (prototype !== Object.prototype && prototype !== null) {
			seen.delete(node);
			return sanitizePlainText(String(node), { source, contentType, preserveLines: true }).text;
		}
		const record = node as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(record)) {
			const keyPath = `${path}.${key}`;
			if (isSecretFieldName(key)) {
				const redacted = redactStructuredSecretValue(keyPath);
				out[key] = redacted.text;
				redactions.push(redacted.event);
				continue;
			}
			out[key] = walk(record[key], keyPath);
		}
		seen.delete(node);
		return out;
	}
	const walked = walk(value, "$");
	const text = JSON.stringify(walked);
	if (text.length === 0) warnings.push(warning("structured_json_empty", "Structured JSON projected to empty text"));
	return {
		value: walked,
		text,
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings(warnings),
		provenance: provenance(source, contentType, ["structured-json-sanitized"]),
	};
}

function sortStructuredJsonValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (Array.isArray(value)) return value.map((item) => sortStructuredJsonValue(item));
	if (typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) {
		out[key] = sortStructuredJsonValue(record[key]);
	}
	return out;
}

function projectStructuredJson(value: unknown): {
	text: string;
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
} {
	const sanitized = sanitizeStructuredJsonForStorage(value, {
		source: "generic-text",
		contentType: "structured_json",
	});
	return {
		text: JSON.stringify(sortStructuredJsonValue(sanitized.value), null, 2),
		redactions: sanitized.redactions,
		warnings: sanitized.warnings,
	};
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function isLikelyRichTextJson(value: unknown, depth = 0): boolean {
	const record = asPlainRecord(value);
	if (!record) {
		return Array.isArray(value) && depth < 2
			? value.some((item) => isLikelyRichTextJson(item, depth + 1))
			: false;
	}
	const nodeType = record["type"];
	const hasRichType = typeof nodeType === "string" && RICH_TEXT_NODE_TYPES.has(nodeType);
	const content = record["content"];
	const children = record["children"];
	const hasText = typeof record["text"] === "string" || typeof record["value"] === "string";
	if (hasRichType && (hasText || Array.isArray(content) || Array.isArray(children))) return true;
	if (depth >= 2) return false;
	if (Array.isArray(content) && content.some((item) => isLikelyRichTextJson(item, depth + 1))) {
		return true;
	}
	if (Array.isArray(children) && children.some((item) => isLikelyRichTextJson(item, depth + 1))) {
		return true;
	}
	return false;
}

function looksLikeHtml(text: string): boolean {
	return /<!doctype\s+html|<html\b|<body\b|<article\b|<section\b|<main\b|<p\b|<div\b|<h[1-6]\b|<table\b|<ul\b|<ol\b/i.test(
		text,
	);
}

function looksLikeEmailText(text: string): boolean {
	const headerLines = text
		.split(/\r?\n/)
		.slice(0, 20)
		.filter((line) => /^(?:from|to|cc|bcc|subject|date|reply-to|message-id):\s+\S/i.test(line));
	return headerLines.length >= 2 && headerLines.some((line) => /^subject:/i.test(line));
}

function looksLikeMarkdown(text: string): boolean {
	return (
		/^#{1,6}\s+\S/m.test(text) ||
		/(?:^|\n)(?:```|~~~)/.test(text) ||
		/^\s{0,3}[-*+]\s+\S/m.test(text) ||
		/^\s{0,3}\d+\.\s+\S/m.test(text) ||
		/\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(text) ||
		/^\|.+\|\r?\n\|[-: |]+\|/m.test(text)
	);
}

function looksLikeLog(text: string): boolean {
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const logLines = lines.filter((line) =>
		/^\s*(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|\[[^\]]*(?:debug|info|warn|error|fatal)[^\]]*\]|(?:debug|info|warn|error|fatal)\b|at\s+\S+\s+\(.+:\d+:\d+\))/i.test(
			line,
		),
	);
	return logLines.length >= 2 || (logLines.length === 1 && lines.length <= 3);
}

function looksLikeCode(text: string): boolean {
	const score = [
		/^\s*(?:import|export)\s+.+from\s+["'][^"']+["'];?/m,
		/^\s*(?:const|let|var)\s+\w+\s*=/m,
		/^\s*(?:async\s+)?function\s+\w+\s*\(/m,
		/^\s*(?:class|interface|type)\s+\w+/m,
		/^\s*(?:def|class)\s+\w+\s*\(/m,
		/^\s*(?:package|func)\s+\w+/m,
		/[{};]\s*$/m,
	].filter((pattern) => pattern.test(text)).length;
	return score >= 2;
}

function looksLikeDocumentText(text: string): boolean {
	return text.length > 160 && /\n\s*\n/.test(text);
}

function detectContentType(input: ParsedSanitizerInput): SanitizerContentType {
	if (input.declaredContentType) return input.declaredContentType;
	if (input.source === "claude-jsonl" || input.source === "codex-jsonl") return "jsonl_transcript";
	if (
		(input.source === "generic-chat" || input.source === "openclaw") &&
		typeof input.content !== "string"
	) {
		return "chat_messages";
	}
	if (typeof input.content === "object" && input.content !== null) {
		if (isLikelyRichTextJson(input.content)) return "rich_text_json";
		return "structured_json";
	}
	if (typeof input.content !== "string") return "plain_text";
	const text = input.content.trim();
	if (looksLikeHtml(text)) return "html";
	if (looksLikeEmailText(text)) return "email_text";
	if (looksLikeMarkdown(text)) return "markdown";
	if (looksLikeLog(text)) return "log";
	if (looksLikeCode(text)) return "code";
	if (looksLikeDocumentText(text)) return "document_text";
	return "plain_text";
}

function chunkingContentType(contentType: SanitizerContentType): ContentType {
	if (contentType === "chat_messages" || contentType === "jsonl_transcript") return "conversation";
	// `@snoai/chunking` >=1.0.0 removed "code" as an embeddable content type
	// (code now routes to the package's attachment axis instead). This function
	// only selects a boundary detector for the flat-chunked embed path, so
	// code/log content maps to "prose" — same flat-chunk shape as before,
	// just no longer requesting a value the schema rejects.
	return "prose";
}

function stringifyContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (typeof content === "number" || typeof content === "boolean") return String(content);
	return JSON.stringify(content);
}

export function sanitizeContentIngress(input: SanitizerInput): SanitizedContent {
	const parsed = SanitizerInputSchema.parse(input);
	const contentType = detectContentType(parsed);
	const source = parsed.source;
	const rawInputHash = stableInputHash({
		source,
		declaredContentType: parsed.declaredContentType ?? null,
		content: parsed.content,
	});
	const redactions: RedactionEvent[] = [];
	const warnings: SanitizerWarning[] = [];
	let vectorText = "";
	let plainText = "";
	let markdownText: string | undefined;
	let transcriptText: string | undefined;
	let atomicSpans = [] as SanitizedContent["chunkingHandoff"]["atomicSpans"];
	let decisions: string[] = [];
	let truncated = false;

	switch (contentType) {
		case "html":
		case "email_html": {
			const projected = projectHtml(stringifyContent(parsed.content), { source, contentType });
			plainText = projected.plainText;
			vectorText = projected.plainText;
			markdownText = projected.markdownText;
			appendRedactions(redactions, projected.redactions);
			warnings.push(...projected.warnings);
			decisions = projected.provenance.decisions;
			break;
		}
		case "rich_text_json": {
			const projected = projectRichText(parsed.content, { source, contentType });
			plainText = projected.plainText;
			vectorText = projected.plainText;
			appendRedactions(redactions, projected.redactions);
			warnings.push(...projected.warnings);
			decisions = projected.provenance.decisions;
			break;
		}
		case "structured_json": {
			const projected = projectStructuredJson(parsed.content);
			const sanitized = sanitizePlainText(projected.text, { source, contentType, preserveLines: true });
			plainText = sanitized.text;
			vectorText = sanitized.text;
			appendRedactions(redactions, projected.redactions);
			appendRedactions(redactions, sanitized.redactions);
			warnings.push(...projected.warnings, ...sanitized.warnings);
			decisions = ["structured-json-projected", ...sanitized.provenance.decisions];
			break;
		}
		case "chat_messages": {
			const projected = sanitizeTranscript({ source, messages: parsed.content });
			plainText = projected.transcriptText;
			vectorText = projected.transcriptText;
			transcriptText = projected.transcriptText;
			atomicSpans = projected.atomicSpans;
			appendRedactions(redactions, projected.redactions);
			warnings.push(...projected.warnings);
			decisions = projected.provenance.decisions;
			break;
		}
		case "jsonl_transcript": {
			const projected = parseReplayJsonl(stringifyContent(parsed.content), { source });
			plainText = projected.transcriptText;
			vectorText = projected.transcriptText;
			transcriptText = projected.transcriptText;
			atomicSpans = projected.atomicSpans;
			appendRedactions(redactions, projected.redactions);
			warnings.push(...projected.warnings);
			decisions = projected.provenance.decisions;
			break;
		}
		case "code":
		case "log":
		case "markdown":
		case "email_text":
		case "document_text":
		case "plain_text": {
			const sanitized = sanitizePlainText(stringifyContent(parsed.content), {
				source,
				contentType,
				preserveLines: true,
			});
			plainText = sanitized.text;
			vectorText = sanitized.text;
			appendRedactions(redactions, sanitized.redactions);
			warnings.push(...sanitized.warnings);
			decisions = sanitized.provenance.decisions;
			truncated = sanitized.provenance.truncated;
			break;
		}
	}

	const normalizedVector = vectorText;
	const handoffText = vectorText;
	if (!handoffText.trim() || isOnlyRedactionMarkers(handoffText)) {
		warnings.push(warning("empty_after_sanitization", "Content became empty after sanitization"));
	}
	const finalTruncated = truncated || warnings.some((event) => event.code === "content_truncated");
	const hash = stableInputHash({ contentType, text: handoffText });
	return {
		sanitizedRaw: plainText,
		detectedContentType: contentType,
		chunkingContentType: chunkingContentType(contentType),
		projections: {
			vectorText: normalizedVector,
			plainText,
			...(markdownText ? { markdownText } : {}),
			...(transcriptText ? { transcriptText } : {}),
		},
		chunkingHandoff: {
			text: handoffText,
			contentType: chunkingContentType(contentType),
			atomicSpans,
		},
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings(warnings),
		provenance: provenance(source, contentType, decisions, finalTruncated),
		stableInputHash: hash,
		rawInputHash,
	};
}
