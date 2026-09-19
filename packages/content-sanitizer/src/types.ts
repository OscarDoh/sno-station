import type { ContentType } from "@snoai/chunking";
import { z } from "zod";

export const CONTENT_SANITIZER_VERSION = "0.1.0";

export const CONTENT_TYPES = [
	"plain_text",
	"markdown",
	"html",
	"email_html",
	"email_text",
	"rich_text_json",
	"chat_messages",
	"jsonl_transcript",
	"structured_json",
	"document_text",
	"code",
	"log",
] as const;

export type SanitizerContentType = (typeof CONTENT_TYPES)[number];

export const SOURCES = [
	"openclaw",
	"claude-jsonl",
	"codex-jsonl",
	"manual-tool",
	"document",
	"generic-chat",
	"generic-text",
] as const;

export type SanitizerSource = (typeof SOURCES)[number];

export const SanitizerInputSchema = z.object({
	mode: z.literal("storage-safe").default("storage-safe"),
	source: z.enum(SOURCES).default("generic-text"),
	declaredContentType: z.enum(CONTENT_TYPES).optional(),
	content: z.unknown(),
});

export type SanitizerInput = z.input<typeof SanitizerInputSchema>;
export type ParsedSanitizerInput = z.output<typeof SanitizerInputSchema>;

export interface SanitizerWarning {
	code: string;
	message: string;
	path?: string;
	count?: number;
}

export interface RedactionEvent {
	kind: "secret" | "private";
	class: string;
	count: number;
	path?: string;
}

export interface SanitizerProvenance {
	source: SanitizerSource;
	contentType: SanitizerContentType;
	version: string;
	decisions: string[];
	truncated: boolean;
}

export interface AtomicSpan {
	startOffset: number;
	endOffset: number;
	reason: string;
}

export interface SanitizerProjection {
	vectorText: string;
	plainText: string;
	markdownText?: string;
	transcriptText?: string;
}

export interface SanitizedContent {
	sanitizedRaw: string;
	detectedContentType: SanitizerContentType;
	chunkingContentType: ContentType;
	projections: SanitizerProjection;
	chunkingHandoff: {
		text: string;
		contentType: ContentType;
		atomicSpans: AtomicSpan[];
	};
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	provenance: SanitizerProvenance;
	stableInputHash: string;
	rawInputHash: string;
}

export interface TextSanitizerResult {
	text: string;
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	provenance: SanitizerProvenance;
}

export interface HtmlProjectionResult {
	plainText: string;
	markdownText: string;
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	provenance: SanitizerProvenance;
}

export interface RichTextProjectionResult {
	plainText: string;
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	provenance: SanitizerProvenance;
}

export interface StructuredJsonSanitizerResult {
	value: unknown;
	text: string;
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	provenance: SanitizerProvenance;
}

export interface TranscriptSanitizerResult {
	transcriptText: string;
	atomicSpans: AtomicSpan[];
	redactions: RedactionEvent[];
	warnings: SanitizerWarning[];
	provenance: SanitizerProvenance;
}

export type StorageValidationResult<T = Record<string, unknown>> =
	| {
			ok: true;
			value: T;
			redactions: RedactionEvent[];
			warnings: SanitizerWarning[];
			provenance: SanitizerProvenance;
	  }
	| {
			ok: false;
			reason: string;
			redactions: RedactionEvent[];
			warnings: SanitizerWarning[];
			provenance: SanitizerProvenance;
	  };

export class ContentSanitizerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContentSanitizerError";
	}
}

export const MAX_WARNINGS = 20;
export const MAX_REDACTIONS = 50;
export const MAX_TEXT_CHARS = 512 * 1024;

export function warning(code: string, message: string, path?: string, count?: number): SanitizerWarning {
	return {
		code,
		message,
		...(path ? { path } : {}),
		...(count !== undefined ? { count } : {}),
	};
}

export function boundedWarnings(warnings: SanitizerWarning[]): SanitizerWarning[] {
	if (warnings.length <= MAX_WARNINGS) return warnings;
	return [
		...warnings.slice(0, MAX_WARNINGS - 1),
		warning("warnings_truncated", "Additional sanitizer warnings were truncated", undefined, warnings.length),
	];
}

export function boundedRedactions(redactions: RedactionEvent[]): RedactionEvent[] {
	return redactions.slice(0, MAX_REDACTIONS);
}

export function provenance(
	source: SanitizerSource,
	contentType: SanitizerContentType,
	decisions: string[],
	truncated = false,
): SanitizerProvenance {
	return {
		source,
		contentType,
		version: CONTENT_SANITIZER_VERSION,
		decisions: decisions.slice(0, 16),
		truncated,
	};
}
