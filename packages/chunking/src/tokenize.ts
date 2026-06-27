import type { TokenizerMode } from "./chunk-config.js";

/**
 * Per PRD §7.1. CJK char ranges covering CJK Unified Ideographs (Basic + Ext A
 * for classical/rare chars), Hiragana, Katakana, Hangul Syllables.
 */
const CJK_REGEX = /[㐀-䶿一-鿿぀-ゟ゠-ヿ가-힯]/g;

/** Per project convention: `DEFAULT_CHARS_PER_TOKEN = 3.0` (mem-claw/config). */
const CHARS_PER_TOKEN = 3;

/**
 * CJK divisor 1.2 is intentionally tighter than the project-wide embedder-context
 * divisor `CJK_CHAR_TOKEN_DIVISOR = 2.5` (see apps/mem-claw/config/index.ts:127).
 *
 * Rationale: the embedder layer caps at 8192 tokens, so its conservative divisor
 * favors fewer-but-larger chunks. The chunker layer caps at maxTokens=448, where
 * the failure mode is overflow at the embedder, not under-utilization. We accept
 * smaller-than-needed CJK chunks (at the chunker) as the cost of strict cap
 * adherence (at the embedder). Tightening 2.5 → 1.2 is the safe direction.
 */
const CJK_CHARS_PER_TOKEN = 1.2;

/** Ratio of CJK characters to total non-whitespace characters. */
export function getCjkRatio(text: string): number {
	const nonWs = text.replace(/\s+/g, "");
	if (nonWs.length === 0) return 0;
	const cjkCount = (text.match(CJK_REGEX) ?? []).length;
	return cjkCount / nonWs.length;
}

/** Per PRD §7.1. Returns true when ≥`threshold` of non-whitespace chars are CJK. */
export function isCjkHeavy(text: string, threshold = 0.3): boolean {
	return getCjkRatio(text) >= threshold;
}

/**
 * Per PRD §7.1. Deterministic token count.
 *
 * Additive over CJK and non-CJK char counts: `cjk/CJK_CHARS_PER_TOKEN +
 * nonCjk/CHARS_PER_TOKEN`. Strictly monotonic on substring extension, which is
 * what `chunker.forceSplitOffset` binary search requires. The earlier
 * threshold-flip implementation (`isCjkHeavy ? 1.2 : 3`) was non-monotonic on
 * mixed-script substrings: extending the substring by one Chinese char could
 * cross the 30% threshold and discontinuously jump the divisor, which made
 * binary search converge to suboptimal split points.
 *
 * Phase 1 only supports `char-approximation`. `mode` is kept on the signature
 * so callers (and `ChunkConfig.tokenizerMode`) carry an explicit, schema-checked
 * value; future modes are added by extending `TOKENIZER_MODES` *and* this switch
 * in the same change.
 */
export function countTokens(text: string, _mode: TokenizerMode = "char-approximation"): number {
	if (text.length === 0) return 0;
	const cjkCount = (text.match(CJK_REGEX) ?? []).length;
	const nonCjkCount = text.length - cjkCount;
	return Math.ceil(cjkCount / CJK_CHARS_PER_TOKEN + nonCjkCount / CHARS_PER_TOKEN);
}
