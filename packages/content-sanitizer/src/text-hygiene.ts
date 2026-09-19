import { createHash } from "node:crypto";
import { MAX_TEXT_CHARS, warning, type SanitizerWarning } from "./types.js";

export function stableInputHash(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
	const serialized = JSON.stringify(stableJsonValue(value, new WeakSet()));
	return serialized ?? String(value);
}

function stableJsonValue(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value === "bigint") return `${value.toString()}n`;
	if (value === null || value === undefined) return value;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value !== "object") return String(value);
	if (seen.has(value)) return "[Circular]";
	seen.add(value);
	if (Array.isArray(value)) {
		const out = value.map((item) => stableJsonValue(item, seen));
		seen.delete(value);
		return out;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		seen.delete(value);
		return String(value);
	}
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) {
		out[key] = stableJsonValue(record[key], seen);
	}
	seen.delete(value);
	return out;
}

function removeDisallowedControlChars(text: string): string {
	let out = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === undefined) continue;
		const code = char.charCodeAt(0);
		if (code === 0 || (code >= 1 && code <= 8) || code === 11 || code === 12) continue;
		if ((code >= 14 && code <= 31) || code === 127) continue;
		out += char;
	}
	return out;
}

export function normalizeText(
	text: string,
	options: { preserveLines?: boolean; maxTextChars?: number } = {},
): { text: string; warnings: SanitizerWarning[]; truncated: boolean } {
	const warnings: SanitizerWarning[] = [];
	const maxTextChars = options.maxTextChars ?? MAX_TEXT_CHARS;
	let out = removeDisallowedControlChars(text.normalize("NFC"));
	let truncated = false;
	if (out.length > maxTextChars) {
		out = out.slice(0, maxTextChars);
		truncated = true;
		warnings.push(warning("content_truncated", "Input exceeded sanitizer text limit", undefined, text.length));
	}
	if (options.preserveLines) {
		out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
	} else {
		out = out.replace(/[ \t]+/g, " ").replace(/\n{4,}/g, "\n\n\n").trim();
	}
	return { text: out, warnings, truncated };
}

export function stripHtmlTags(text: string): string {
	return text
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ");
}

export function collapseInlineText(text: string): string {
	return text.replace(/[ \t\r\n]+/g, " ").trim();
}
