import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectCodeBoundaries,
	detectConversationBoundaries,
	detectProseBoundaries,
} from "../src/boundaries";

describe("detectConversationBoundaries()", () => {
	it("matches pure-CJK speakers across multiple turns", () => {
		const line1 = "[2024-01-01] 张三: 你好";
		const line2 = "[2024-01-01] 李四: 再见";
		const text = `${line1}\n${line2}`;
		const { offsets } = detectConversationBoundaries(text);
		// sentinels {0, len} + two turn-starts; first turn-start is 0 (merges), so
		// internal boundary = start of second line; total offsets length = 3.
		expect(offsets).toEqual([0, line1.length + 1, text.length]);
	});

	it("matches mixed-script speaker names (Latin + Han)", () => {
		const text = "Alice 张: hello\nBob: hi";
		const { offsets } = detectConversationBoundaries(text);
		// Two turn lines: offsets at 0 (sentinel/turn) and at second line start, plus end sentinel.
		expect(offsets).toEqual([0, "Alice 张: hello\n".length, text.length]);
	});

	it("regression: ASCII-only speaker names still match", () => {
		const text = "Alice: hi\nBob: bye";
		const { offsets } = detectConversationBoundaries(text);
		expect(offsets).toEqual([0, "Alice: hi\n".length, text.length]);
	});

	it("matches multi-character Han speaker names (\\p{L} fix)", () => {
		const line1 = "[t] 王小明: hi";
		const line2 = "[t] 王小明: bye";
		const text = `${line1}\n${line2}`;
		const { offsets } = detectConversationBoundaries(text);
		expect(offsets).toEqual([0, line1.length + 1, text.length]);
	});

	it("allows digits in speaker names (\\p{N})", () => {
		const text = "User1: hi\nUser2: bye";
		const { offsets } = detectConversationBoundaries(text);
		expect(offsets).toEqual([0, "User1: hi\n".length, text.length]);
	});

	it("matches Hangul speaker names", () => {
		const line1 = "홍길동: 안녕";
		const line2 = "김철수: 반갑";
		const text = `${line1}\n${line2}`;
		const { offsets } = detectConversationBoundaries(text);
		expect(offsets).toEqual([0, line1.length + 1, text.length]);
	});
});

describe("detectProseBoundaries() — sentence segmentation (Intl.Segmenter)", () => {
	it("segments Chinese sentences on 。！？ terminators", () => {
		const text = "你好。今天天气真好！我们去吧？";
		const { offsets } = detectProseBoundaries(text);
		// At least 4 offsets: sentinels {0, len} + ≥ 2 internal sentence boundaries.
		// (3 sentences → 2 internal boundaries minimum; final boundary at len merges with sentinel.)
		expect(offsets.length).toBeGreaterThanOrEqual(4);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
	});

	it("segments Japanese sentences on 。 terminators", () => {
		const text = "こんにちは。今日はいい天気です。";
		const { offsets } = detectProseBoundaries(text);
		// 2 sentences → ≥ 1 internal boundary. Sentinels add 0 and len.
		expect(offsets.length).toBeGreaterThanOrEqual(3);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
	});

	it("regression: English sentences still segment", () => {
		const text = "Hello world. Foo bar.";
		const { offsets } = detectProseBoundaries(text);
		// 2 sentences → ≥ 1 internal boundary between them.
		expect(offsets.length).toBeGreaterThanOrEqual(3);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
	});

	// Plan §boundaries.test #10 (abbreviation handling for "Dr. Smith") OMITTED.
	// Empirical: better-sqlite3 Intl.Segmenter (current ICU build) splits after "Dr. "
	// identically to the old regex `/(?<=[.!?])\s+(?=[A-Z])/g`. The plan's
	// "regression catch" rationale assumed segmenter-level abbreviation merging
	// that does not hold on this runtime, so the test as specified cannot
	// discriminate old vs new behavior. Documented as a known limitation.

	it("segments mixed-script text with both Latin and CJK terminators", () => {
		const text = "Hello。你好.We continue.";
		const { offsets } = detectProseBoundaries(text);
		// Multiple sentence segments → at least one internal boundary.
		expect(offsets.length).toBeGreaterThanOrEqual(3);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
	});

	it("returns only sentinels when text has no terminator", () => {
		const text = "just a phrase";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets).toEqual([0, text.length]);
	});

	it("returns [0] for empty string (sentinels {0, len} dedupe when len=0)", () => {
		const { offsets } = detectProseBoundaries("");
		// withSentinels uses a Set, so {0, 0} dedupes to {0}. This documents the
		// actual sentinel-merge behavior on an empty input.
		expect(offsets).toEqual([0]);
	});

	it("uses paragraph path when paragraph breaks exist (does not subdivide via sentence segmenter)", () => {
		const text = "para1.\n\npara2.";
		const { offsets } = detectProseBoundaries(text);
		// `\n\s*\n` matches at index 6 with length 2 → boundary at 8. No sentence
		// subdivision of "para1." even though it has a terminator.
		expect(offsets).toEqual([0, 8, text.length]);
	});
});

describe("detectProseBoundaries() — fallback path (no Intl.Segmenter)", () => {
	// Force the no-ICU fallback by deleting `Intl.Segmenter` for the duration
	// of each test, then restoring it. This is the only path test users on
	// older runtimes (or stripped-ICU builds) actually hit.
	const intlGlobal = Intl as unknown as { Segmenter?: unknown };
	let saved: unknown;

	beforeEach(() => {
		saved = intlGlobal.Segmenter;
		delete intlGlobal.Segmenter;
	});

	afterEach(() => {
		if (saved !== undefined) intlGlobal.Segmenter = saved;
	});

	it("emits sorted ascending boundaries on Latin terminators", () => {
		const text = "Hello world. Foo bar. Baz.";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
		// strictly ascending
		for (let i = 1; i < offsets.length; i++) {
			const prev = offsets[i - 1] ?? 0;
			const cur = offsets[i] ?? 0;
			expect(cur).toBeGreaterThan(prev);
		}
		// internal boundaries after "Hello world. " (13) and "Foo bar. " (22).
		expect(offsets).toContain(13);
		expect(offsets).toContain(22);
	});

	it("handles leading terminators without dropping the run", () => {
		// Regression: old fallback regex `[^.!?。！？]+[.!?。！？]+\s*` required
		// non-terminator chars before the run, so a leading `!?` was skipped
		// and the first sentence boundary slid forward.
		const text = "!?Hello. Next.";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
		// Leading `!?` (length 2) is itself a terminator run → boundary at 2.
		expect(offsets).toContain(2);
		// Then `Hello.` ends at index 8 → boundary at 9 (incl. the space).
		expect(offsets).toContain(9);
	});

	it("handles consecutive terminators (Hi.! Next.)", () => {
		const text = "Hi.! Next.";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
		// `.!` is one terminator run + one space → boundary at 5.
		expect(offsets).toContain(5);
	});

	it("handles CJK terminators in fallback", () => {
		const text = "你好。再见。";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
		// Boundary after `你好。` (3 chars) and at end-of-text (6).
		expect(offsets).toContain(3);
	});

	it("returns sentinels-only when no terminator present", () => {
		const text = "just a phrase";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets).toEqual([0, text.length]);
	});

	it("handles mixed Latin+CJK terminators in fallback", () => {
		const text = "Hello。你好.We continue.";
		const { offsets } = detectProseBoundaries(text);
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
		// Sorted ascending invariant.
		for (let i = 1; i < offsets.length; i++) {
			const prev = offsets[i - 1] ?? 0;
			const cur = offsets[i] ?? 0;
			expect(cur).toBeGreaterThan(prev);
		}
	});
});

describe("detectCodeBoundaries() — regression", () => {
	it("splits on fences, headings, and decls", () => {
		const text = ["# Title", "intro text", "```", "code", "```", "export function foo() {}"].join(
			"\n",
		);
		const { offsets } = detectCodeBoundaries(text);
		// Sentinel 0, heading-start 0 (merges), fence-start, fence-end, decl-start, sentinel len.
		// Just assert structure: starts at 0, ends at len, multiple internal offsets.
		expect(offsets[0]).toBe(0);
		expect(offsets.at(-1)).toBe(text.length);
		expect(offsets.length).toBeGreaterThanOrEqual(4);
		// Heading at 0 merges with sentinel. Verify fence and decl positions appear.
		expect(offsets).toContain(text.indexOf("```"));
		expect(offsets).toContain(text.indexOf("export function"));
	});
});
