/**
 * Per PRD §7.2. Boundary detection per content type.
 *
 * Each detector returns sorted ascending char offsets. Offsets are *between*
 * chars (offset N means split between text[N-1] and text[N]). Sentinels `0`
 * and `text.length` are always included so the chunker can iterate spans.
 */

/**
 * Per PRD §7.2. Conversation turn lines: `[ts] Speaker: ` or `Speaker: ` at line
 * start. Speaker name is Unicode letters/digits/space/tab/underscore so CJK and
 * mixed-script names match (`张三:`, `Alice 张:`). `\w` is ASCII-only in JS
 * regex even with the `u` flag, so we expand to `\p{L}\p{N}_` explicitly.
 */
const TURN_LINE_RE = /^(?:\[\S+\] )?\p{L}[\p{L}\p{N}_ \t]{0,40}: /gmu;

/** Per PRD §7.2. Paragraph break: ≥1 blank line. */
const PARAGRAPH_BREAK_RE = /\n\s*\n/g;

/**
 * Per PRD §7.2 fallback. Locale-aware sentence segmentation when no paragraph
 * breaks exist in a span. Uses `Intl.Segmenter` (ICU-backed, bundled with the
 * runtime, zero install footprint) so CJK punctuation `。！？` and non-spaced
 * scripts (Thai/Lao) segment correctly. Note: some ICU builds split
 * after `Dr. ` like a naive regex would; abbreviation merging is aspirational.
 *
 * Returns boundary offsets — char positions where the next sentence starts.
 * Falls back to a terminator-run scanner if `Intl.Segmenter` is missing
 * (older runtimes without ICU). Boundary at `s.index + s.segment.length` for
 * each segment except the last; sentinels handle `0` and `text.length`.
 */
const SENTENCE_TERMINATOR_RE = /[.!?。！？]+\s*/g;

function splitSentenceOffsets(text: string): number[] {
	if (text.length === 0) return [];
	type SegmenterCtor = new (
		locale?: string,
		options?: { granularity: "sentence" },
	) => { segment(input: string): Iterable<{ index: number; segment: string }> };
	const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
	if (Segmenter !== undefined) {
		const seg = new Segmenter(undefined, { granularity: "sentence" });
		const out: number[] = [];
		for (const s of seg.segment(text)) {
			out.push(s.index + s.segment.length);
		}
		return out;
	}
	// Fallback: scan for terminator runs (Latin + CJK) plus trailing whitespace
	// and emit the post-run offset as a sentence boundary. Unlike a regex that
	// requires non-terminator chars *before* the run, this handles leading
	// terminators (e.g. `!?Hello.`) and consecutive runs (e.g. `Hi.! Next.`)
	// without dropping boundaries. Match starts are non-decreasing because
	// `RegExp.matchAll` advances `lastIndex` past each match, so emitted
	// offsets are sorted ascending. Never throws.
	const out: number[] = [];
	for (const m of text.matchAll(SENTENCE_TERMINATOR_RE)) {
		if (m.index === undefined) continue;
		out.push(m.index + m[0].length);
	}
	return out;
}

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
	return withSentinels(splitSentenceOffsets(text), text.length);
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
