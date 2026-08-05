/**
 * Per PRD §8.1. Bounded no-LLM head-extract used to build the dense-payload
 * summary prefix when the active ingest path runs without an LLM (e.g. the
 * `chunk-ingester` used by phase 1/2 of the LoCoMo eval).
 */

import { z } from "zod";
import type { ContentType } from "./content-type.js";
import { countTokens } from "./tokenize.js";

export const HEAD_EXTRACT_TOKEN_BUDGET = 96 as const;
export const HEAD_EXTRACT_MIN_CONTENT_TOKENS = 8 as const;
export const HEAD_EXTRACT_OVERLAP_DROP_RATIO = 0.8 as const;

export const HeadExtractConfigSchema = z
	.object({
		tokenBudget: z.number().int().positive().default(HEAD_EXTRACT_TOKEN_BUDGET),
		minContentTokens: z.number().int().positive().default(HEAD_EXTRACT_MIN_CONTENT_TOKENS),
		overlapDropRatio: z.number().min(0).max(1).default(HEAD_EXTRACT_OVERLAP_DROP_RATIO),
	})
	.strict()
	.prefault({
		tokenBudget: HEAD_EXTRACT_TOKEN_BUDGET,
		minContentTokens: HEAD_EXTRACT_MIN_CONTENT_TOKENS,
		overlapDropRatio: HEAD_EXTRACT_OVERLAP_DROP_RATIO,
	});

export type HeadExtractConfig = z.infer<typeof HeadExtractConfigSchema>;

export const DEFAULT_HEAD_EXTRACT_CONFIG: HeadExtractConfig = HeadExtractConfigSchema.parse({});

// Mirrors boundaries.ts TURN_LINE_RE shape but anchored per-line for single-line tests.
const TURN_LINE_PREFIX_RE = /^(?:\[\S+\] )?[A-Za-z][\w \t]{0,40}: /;

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z])/g;

// Identifies frontmatter-style metadata lines (markdown headings + key:value).
// The leading run of these lines is captured verbatim and prepended to the
// prose head so structured-corpus chunks retain temporal/identity anchors
// (e.g. `session_date_time:`) that would otherwise live only in the first chunk.
const MARKDOWN_HEADING_RE = /^#{1,6}\s/;
const METADATA_KEY_VALUE_RE = /^[a-z][a-z0-9_]{0,40}:\s*(?:\S.*)?$/;

function resolveConfig(config: Partial<HeadExtractConfig> | undefined): HeadExtractConfig {
	if (config === undefined) return DEFAULT_HEAD_EXTRACT_CONFIG;
	return HeadExtractConfigSchema.parse(config);
}

/** Largest prefix of `text` whose token count is `<= budget`, snapped to whitespace if possible. */
function truncateToBudget(text: string, budget: number): string {
	if (countTokens(text) <= budget) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2);
		if (countTokens(text.slice(0, mid)) <= budget) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	const end = lo;
	for (let i = end; i > 0; i--) {
		const ch = text[i - 1];
		if (ch === " " || ch === "\n" || ch === "\t") return text.slice(0, i).trimEnd();
	}
	return text.slice(0, end);
}

/** Conversation skip: first line whose post-prefix content has > minContentTokens tokens. */
function pickConversationLine(text: string, minContentTokens: number): string | undefined {
	const lines = text.split("\n");
	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) continue;
		const prefixMatch = line.match(TURN_LINE_PREFIX_RE);
		const content = prefixMatch ? line.slice(prefixMatch[0].length) : line;
		if (countTokens(content) > minContentTokens) return content;
	}
	return undefined;
}

interface SplitHead {
	metadata: string;
	body: string;
}

/**
 * Split text at the first non-(heading|key:value|blank) line. Returns the
 * leading metadata block (verbatim, trimmed) and the remaining body. Either
 * side may be empty when the input lacks that part.
 */
export function extractMetadataHeader(text: string): string | undefined {
	const { metadata } = splitLeadingMetadata(text.trim());
	return metadata.length > 0 ? metadata : undefined;
}

function splitLeadingMetadata(text: string): SplitHead {
	const lines = text.split("\n");
	let i = 0;
	while (i < lines.length) {
		const trimmed = (lines[i] ?? "").trim();
		if (trimmed.length === 0) {
			i++;
			continue;
		}
		if (MARKDOWN_HEADING_RE.test(trimmed)) {
			i++;
			continue;
		}
		if (METADATA_KEY_VALUE_RE.test(trimmed)) {
			i++;
			continue;
		}
		break;
	}
	const metadata = lines
		.slice(0, i)
		.filter((l) => l.trim().length > 0)
		.join("\n")
		.trim();
	const body = lines.slice(i).join("\n");
	return { metadata, body };
}

/** Prose/code: accumulate sentences (or lines) up to budget; hard-truncate if even one overflows. */
function pickProseHead(text: string, budget: number): string | undefined {
	const trimmed = text.trim();
	if (trimmed.length === 0) return undefined;
	const sentences = trimmed.split(SENTENCE_SPLIT_RE);
	let acc = "";
	for (const s of sentences) {
		const candidate = acc.length === 0 ? s : `${acc} ${s}`;
		if (countTokens(candidate) > budget) {
			if (acc.length === 0) return truncateToBudget(s, budget);
			return acc;
		}
		acc = candidate;
	}
	return acc;
}

/**
 * Per PRD §8.1. Build a deterministic summary prefix capped at `tokenBudget`.
 * Returns `undefined` when no eligible content exists (empty input, or
 * conversation with no line above the min-content-tokens floor).
 */
export function headExtract(
	parentText: string,
	contentType: ContentType,
	config?: Partial<HeadExtractConfig>,
): string | undefined {
	const cfg = resolveConfig(config);
	const trimmed = parentText.trim();
	if (trimmed.length === 0) return undefined;

	if (contentType === "conversation") {
		const line = pickConversationLine(trimmed, cfg.minContentTokens);
		if (line === undefined) return undefined;
		return truncateToBudget(line.trim(), cfg.tokenBudget);
	}

	const { metadata, body } = splitLeadingMetadata(trimmed);
	const bodyTrimmed = body.trim();

	if (metadata.length === 0) {
		const head = pickProseHead(bodyTrimmed, cfg.tokenBudget);
		if (head === undefined || head.length === 0) return undefined;
		return head;
	}

	// Metadata fits inside the budget — emit `metadata + blank line + prose head`
	// so every chunk's dense_payload carries the parent's temporal/identity
	// anchors (PRD §8.1: structured corpora must not lose date headers when a
	// session is split across chunks).
	const metadataTokens = countTokens(metadata);
	if (metadataTokens >= cfg.tokenBudget) {
		return truncateToBudget(metadata, cfg.tokenBudget);
	}
	if (bodyTrimmed.length === 0) return metadata;

	const headBudget = cfg.tokenBudget - metadataTokens - 1; // 1 token reserved for the joining blank line
	if (headBudget <= 0) return metadata;
	const head = pickProseHead(bodyTrimmed, headBudget);
	if (head === undefined || head.length === 0) return metadata;
	return `${metadata}\n\n${head}`;
}

/**
 * Unicode-aware token extraction for overlap comparison.
 * Each CJK codepoint emits as its own token; Latin alphanumeric runs emit as
 * a single lowercased token; everything else (whitespace, punctuation) is a
 * separator. Mirrors the CJK ranges from `tokenize.ts`.
 */
const CJK_CHAR_RE = /[一-鿿　-〿぀-ゟ゠-ヿ가-힯]/u;
const TOKEN_SCAN_RE = /[A-Za-z0-9]+|[一-鿿　-〿぀-ゟ゠-ヿ가-힯]/gu;

function wordTokens(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(TOKEN_SCAN_RE)) {
		const tok = m[0];
		out.push(CJK_CHAR_RE.test(tok) ? tok : tok.toLowerCase());
	}
	return out;
}

/**
 * Per PRD §8.1 overlap-drop rule. First-chunk near-duplication degrades vector
 * quality (the chunk and its prepended summary embed to nearly the same point),
 * so when the summary's word tokens are mostly a prefix of the chunk's first
 * `tokenBudget` tokens, the caller drops the summary.
 */
export function shouldDropSummary(
	summary: string,
	chunkText: string,
	config?: Partial<HeadExtractConfig>,
): boolean {
	const cfg = resolveConfig(config);
	const summaryWords = wordTokens(summary);
	if (summaryWords.length === 0) return false;
	const chunkPrefix = truncateToBudget(chunkText.trim(), cfg.tokenBudget);
	const chunkWords = wordTokens(chunkPrefix);
	let matched = 0;
	const limit = Math.min(summaryWords.length, chunkWords.length);
	for (let i = 0; i < limit; i++) {
		if (summaryWords[i] === chunkWords[i]) matched++;
	}
	const ratio = matched / summaryWords.length;
	return ratio >= cfg.overlapDropRatio;
}
