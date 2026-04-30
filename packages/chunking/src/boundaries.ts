/**
 * Per PRD §7.2. Boundary detection per content type.
 *
 * Each detector returns sorted ascending char offsets. Offsets are *between*
 * chars (offset N means split between text[N-1] and text[N]). Sentinels `0`
 * and `text.length` are always included so the chunker can iterate spans.
 */

/** Per PRD §7.2. Conversation turn lines: `[ts] Speaker: ` or `Speaker: ` at line start. */
const TURN_LINE_RE = /^(?:\[\S+\] )?[A-Za-z][\w \t]{0,40}: /gm;

/** Per PRD §7.2. Paragraph break: ≥1 blank line. */
const PARAGRAPH_BREAK_RE = /\n\s*\n/g;

/** Per PRD §7.2. Sentence break fallback when no paragraph breaks exist in a span. */
const SENTENCE_BREAK_RE = /(?<=[.!?])\s+(?=[A-Z])/g;

/** Per PRD §7.2. Code structure markers: fences, headings, top-level decls. */
const CODE_FENCE_RE = /^```/gm;
const HEADING_RE = /^#{1,6} /gm;
const DECL_RE = /^(?:export\s+)?(?:function|class|interface|type|const|let|enum)\s+\w+/gm;

interface Boundaries {
	offsets: number[];
}

/** Per PRD §7.2. Adds sentinels and dedupes a sorted ascending offset list. */
function withSentinels(offsets: number[], textLength: number): Boundaries {
	const set = new Set<number>([0, textLength]);
	for (const o of offsets) {
		if (o > 0 && o < textLength) set.add(o);
	}
	const sorted = [...set].sort((a, b) => a - b);
	return { offsets: sorted };
}

/** Per PRD §7.2. Collects all match-start offsets for a regex against text. */
function collectMatchStarts(text: string, re: RegExp): number[] {
	const out: number[] = [];
	for (const m of text.matchAll(re)) {
		if (m.index !== undefined) out.push(m.index);
	}
	return out;
}

/** Per PRD §7.2. Conversation: split at the start of each turn line. */
export function detectConversationBoundaries(text: string): Boundaries {
	return withSentinels(collectMatchStarts(text, TURN_LINE_RE), text.length);
}

/** Per PRD §7.2. Prose: split at paragraph breaks, falling back to sentence breaks if none. */
export function detectProseBoundaries(text: string): Boundaries {
	const paragraphMatches: number[] = [];
	for (const m of text.matchAll(PARAGRAPH_BREAK_RE)) {
		if (m.index === undefined) continue;
		// Boundary sits *after* the blank line so the next chunk starts cleanly.
		paragraphMatches.push(m.index + m[0].length);
	}
	if (paragraphMatches.length > 0) {
		return withSentinels(paragraphMatches, text.length);
	}
	const sentenceMatches: number[] = [];
	for (const m of text.matchAll(SENTENCE_BREAK_RE)) {
		if (m.index === undefined) continue;
		sentenceMatches.push(m.index + m[0].length);
	}
	return withSentinels(sentenceMatches, text.length);
}

/** Per PRD §7.2. Code: split on fences, headings, and top-level declarations. */
export function detectCodeBoundaries(text: string): Boundaries {
	const all = [
		...collectMatchStarts(text, CODE_FENCE_RE),
		...collectMatchStarts(text, HEADING_RE),
		...collectMatchStarts(text, DECL_RE),
	];
	return withSentinels(all, text.length);
}
