import { z } from "zod";
import { type ContentRoute, ContentRouteSchema } from "./content-route.js";
import { type ContentType, ContentTypeSchema } from "./content-type.js";
import { countTokens } from "./tokenize.js";

export const ContentRouteInputSchema = z
	.object({
		content: z.string(),
		declaredRoute: ContentRouteSchema.optional(),
		contentType: ContentTypeSchema.optional(),
		filename: z.string().min(1).optional(),
		mediaType: z.string().min(1).optional(),
	})
	.strict();

export type ContentRouteInput = z.infer<typeof ContentRouteInputSchema>;

export interface AttachmentRouteDecision {
	route: "attachment";
	decisionSource: "caller" | "heuristic";
	reasons: string[];
}

export interface EmbedRouteDecision {
	route: "embed";
	contentType: ContentType;
	decisionSource: "caller" | "heuristic";
	reasons: string[];
}

export type ContentRouteDecision = AttachmentRouteDecision | EmbedRouteDecision;

const RAW_FILE_EXTENSIONS = new Set([
	"c",
	"cc",
	"cpp",
	"cs",
	"css",
	"go",
	"h",
	"hpp",
	"java",
	"js",
	"jsx",
	"log",
	"out",
	"php",
	"py",
	"rb",
	"rs",
	"sh",
	"sql",
	"stderr",
	"stdout",
	"swift",
	"ts",
	"tsx",
	"wasm",
]);

const RAW_MEDIA_RE = /^(?:application\/octet-stream|application\/x-|text\/x-)/i;
const LOG_LINE_RE =
	/^(?:\d{4}-\d{2}-\d{2}[T ][^\s]+\s+)?(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b|^\[(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\]/;
const STACK_LINE_RE = /^(?:\s*at\s+\S+|Traceback \(most recent call last\):|\s*File ".+", line \d+|(?:Type)?Error:)/;
const SHELL_LINE_RE = /^(?:[$#>] |\+\s+\w|\w+@[\w.-]+:[^\n]*[$#] )/;
const CODE_LINE_RE =
	/^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+[A-Za-z_$]/;

function attachmentDecision(reason: string, source: "caller" | "heuristic"): AttachmentRouteDecision {
	return {
		route: "attachment",
		decisionSource: source,
		reasons: [reason],
	};
}

function embedDecision(
	contentType: ContentType,
	source: "caller" | "heuristic",
	reasons: string[] = [],
): EmbedRouteDecision {
	return {
		route: "embed",
		contentType,
		decisionSource: source,
		reasons,
	};
}

function filenameExtension(filename: string | undefined): string | undefined {
	if (filename === undefined) return undefined;
	const lastPart = filename.split("/").at(-1) ?? filename;
	const dot = lastPart.lastIndexOf(".");
	if (dot <= 0 || dot >= lastPart.length - 1) return undefined;
	return lastPart.slice(dot + 1).toLowerCase();
}

function hasMetadataRawSignal(input: ContentRouteInput): boolean {
	const ext = filenameExtension(input.filename);
	if (ext !== undefined && RAW_FILE_EXTENSIONS.has(ext)) return true;
	if (input.mediaType === undefined) return false;
	return RAW_MEDIA_RE.test(input.mediaType);
}

function isJsonLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
	} catch {
		return false;
	}
}

function logDumpShellRatio(lines: readonly string[]): number {
	if (lines.length === 0) return 0;
	let matched = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (
			LOG_LINE_RE.test(trimmed) ||
			STACK_LINE_RE.test(trimmed) ||
			SHELL_LINE_RE.test(trimmed) ||
			isJsonLine(trimmed)
		) {
			matched++;
		}
	}
	return matched / lines.length;
}

function hasClearLogDumpShellShape(lines: readonly string[]): boolean {
	return lines.length >= 20 && logDumpShellRatio(lines) >= 0.55;
}

function hasClearCodeShape(lines: readonly string[]): boolean {
	if (lines.length === 0) return false;
	let matched = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("```") || CODE_LINE_RE.test(trimmed)) matched++;
	}
	return matched / lines.length >= 0.6;
}

function ratio(matches: Iterable<unknown>, denominator: number): number {
	if (denominator === 0) return 0;
	let count = 0;
	for (const _match of matches) count++;
	return count / denominator;
}

function hasLowNaturalLanguageDenseShape(content: string): boolean {
	if (countTokens(content) < 2048) return false;
	const nonWhitespace = content.replace(/\s+/g, "");
	if (nonWhitespace.length === 0) return false;
	const naturalLanguageRatio = ratio(nonWhitespace.matchAll(/\p{L}/gu), nonWhitespace.length);
	const symbolDigitRatio = ratio(nonWhitespace.matchAll(/[\p{N}\p{P}\p{S}_]/gu), nonWhitespace.length);
	return naturalLanguageRatio < 0.25 && symbolDigitRatio >= 0.45;
}

export function classifyContentRoute(input: ContentRouteInput): ContentRouteDecision {
	const parsed = ContentRouteInputSchema.parse(input);
	const declaredRoute: ContentRoute | undefined = parsed.declaredRoute;
	const embeddedType = parsed.contentType ?? "prose";

	if (declaredRoute === "attachment") {
		return attachmentDecision("caller-declared-route", "caller");
	}
	if (declaredRoute === "embed") {
		return embedDecision(embeddedType, "caller", ["caller-declared-route"]);
	}

	if (hasMetadataRawSignal(parsed)) {
		return attachmentDecision("metadata-raw-file-signal", "heuristic");
	}

	const lines = parsed.content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (hasClearLogDumpShellShape(lines)) {
		return attachmentDecision("clear-log-dump-shell-shape", "heuristic");
	}
	if (hasClearCodeShape(lines)) {
		return attachmentDecision("clear-code-shape", "heuristic");
	}
	if (hasLowNaturalLanguageDenseShape(parsed.content)) {
		return attachmentDecision("low-natural-language-density", "heuristic");
	}

	return embedDecision(embeddedType, "heuristic");
}
