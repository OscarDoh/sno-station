import type { TokenizerMode } from "./chunk-config";

/** Per PRD §7.1. CJK char range covering CJK Unified Ideographs, Hiragana, Katakana, Hangul Syllables. */
const CJK_REGEX = /[一-鿿぀-ゟ゠-ヿ가-힯]/g;

/** Per project convention: `DEFAULT_CHARS_PER_TOKEN = 3.0` (claw-storix-plugin/config). */
const CHARS_PER_TOKEN = 3;

/**
 * CJK divisor 1.2 is intentionally tighter than the project-wide embedder-context
 * divisor `CJK_CHAR_TOKEN_DIVISOR = 2.5` (see apps/claw-storix-plugin/config/index.ts:127).
 *
 * Rationale: the embedder layer caps at 8192 tokens, so its conservative divisor
 * favors fewer-but-larger chunks. The chunker layer caps at maxTokens=448, where
 * the failure mode is overflow at the embedder, not under-utilization. We accept
 * smaller-than-needed CJK chunks (at the chunker) as the cost of strict cap
 * adherence (at the embedder). Tightening 2.5 → 1.2 is the safe direction.
 */
const CJK_CHARS_PER_TOKEN = 1.2;

/** Per PRD §7.1. Returns true when ≥`threshold` of non-whitespace chars are CJK. */
export function isCjkHeavy(text: string, threshold = 0.3): boolean {
	const nonWs = text.replace(/\s+/g, "");
	if (nonWs.length === 0) return false;
	const cjkCount = (text.match(CJK_REGEX) ?? []).length;
	return cjkCount / nonWs.length >= threshold;
}

/**
 * Per PRD §7.1. Deterministic token count.
 *
 * Phase 1 only supports `char-approximation`. `mode` is kept on the signature
 * so callers (and `ChunkConfig.tokenizerMode`) carry an explicit, schema-checked
 * value; future modes are added by extending `TOKENIZER_MODES` *and* this switch
 * in the same change.
 */
export function countTokens(text: string, _mode: TokenizerMode = "char-approximation"): number {
	if (text.length === 0) return 0;
	const divisor = isCjkHeavy(text) ? CJK_CHARS_PER_TOKEN : CHARS_PER_TOKEN;
	return Math.ceil(text.length / divisor);
}
