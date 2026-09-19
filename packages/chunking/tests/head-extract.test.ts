import { describe, expect, it } from "vitest";
import {
	DEFAULT_HEAD_EXTRACT_CONFIG,
	HEAD_EXTRACT_MIN_CONTENT_TOKENS,
	HEAD_EXTRACT_OVERLAP_DROP_RATIO,
	HEAD_EXTRACT_TOKEN_BUDGET,
	HeadExtractConfigSchema,
	headExtract,
	shouldDropSummary,
} from "../src/head-extract";
import { countTokens } from "../src/tokenize";

describe("headExtract()", () => {
	describe("empty input", () => {
		it("returns undefined for empty string", () => {
			expect(headExtract("", "prose")).toBeUndefined();
		});

		it("returns undefined for whitespace-only input", () => {
			expect(headExtract("   \n\t\n", "prose")).toBeUndefined();
		});
	});

	describe("conversation content type", () => {
		it("returns undefined when all lines fall below minContentTokens", () => {
			const text = [
				"[2026-04-28T10:00:00Z] Alice: hi",
				"[2026-04-28T10:01:00Z] Bob: ok",
				"[2026-04-28T10:02:00Z] Alice: yes",
			].join("\n");
			expect(headExtract(text, "conversation")).toBeUndefined();
		});

		it("skips short prefix lines and returns the first content-bearing line", () => {
			const long =
				"This particular line carries enough informational tokens to clear the floor easily.";
			const text = [
				"[2026-04-28T10:00:00Z] Alice: hi",
				"[2026-04-28T10:01:00Z] Bob: ok",
				`[2026-04-28T10:02:00Z] Alice: ${long}`,
			].join("\n");
			const out = headExtract(text, "conversation");
			expect(out).toBeDefined();
			expect(out).toBe(long);
		});

		it("handles lines without a turn-line prefix", () => {
			const text = "this is a bare line with sufficient token weight to clear the floor here";
			const out = headExtract(text, "conversation");
			expect(out).toBe(text);
		});
	});

	describe("prose content type", () => {
		it("accumulates leading sentences within the budget", () => {
			const s1 = "First sentence is short.";
			const s2 = "Second sentence is also brief.";
			const s3 = "Third sentence keeps going on and on.";
			const text = `${s1} ${s2} ${s3}`;
			const out = headExtract(text, "prose");
			expect(out).toBeDefined();
			if (!out) return;
			expect(countTokens(out)).toBeLessThanOrEqual(HEAD_EXTRACT_TOKEN_BUDGET);
			expect(out.startsWith(s1)).toBe(true);
		});

		it("hard-truncates a single oversized sentence at a whitespace boundary", () => {
			const word = "alphabetic";
			const long = Array.from({ length: 200 }, () => word).join(" ");
			const out = headExtract(long, "prose");
			expect(out).toBeDefined();
			if (!out) return;
			expect(countTokens(out)).toBeLessThanOrEqual(HEAD_EXTRACT_TOKEN_BUDGET);
			expect(out.endsWith(" ")).toBe(false);
			expect(long.startsWith(out)).toBe(true);
		});

		it("trims surrounding whitespace from input", () => {
			const text = "   Leading and trailing whitespace should be stripped before extraction.   ";
			const out = headExtract(text, "prose");
			expect(out).toBeDefined();
			if (!out) return;
			expect(out.startsWith(" ")).toBe(false);
			expect(out.endsWith(" ")).toBe(false);
		});
	});

	describe("structured content type", () => {
		it("treats structured text the same as prose for head-extract purposes", () => {
			const text =
				"export function foo(x: number): number {\n  return x + 1;\n}\n\nexport const bar = 2;";
			const out = headExtract(text, "structured");
			expect(out).toBeDefined();
			if (!out) return;
			expect(countTokens(out)).toBeLessThanOrEqual(HEAD_EXTRACT_TOKEN_BUDGET);
		});
	});

	describe("prose with leading metadata frontmatter", () => {
		it("preserves leading key: value metadata lines and prepends them to the prose head", () => {
			const text = [
				"sample_id: conv-26",
				"session_key: session_1",
				"speaker_a: Caroline",
				"speaker_b: Melanie",
				"",
				"Hey Melanie! Good to see you. How have you been?",
			].join("\n");
			const out = headExtract(text, "prose");
			expect(out).toBeDefined();
			expect(out).toContain("sample_id: conv-26");
			expect(out).toContain("Hey Melanie!");
			expect(countTokens(out ?? "")).toBeLessThanOrEqual(HEAD_EXTRACT_TOKEN_BUDGET);
		});

		it("preserves the entire leading metadata block (including session_date_time) for split chunks", () => {
			const text = [
				"# LOCOMO Memory",
				"",
				"sample_id: conv-26",
				"session_date_time: 1:56 pm on 8 May, 2023",
				"",
				"## Message 1",
				"dia_id: D1:1",
				"speaker: Caroline",
				"text:",
				"  Hey Mel! Good to see you! How have you been?",
			].join("\n");
			const out = headExtract(text, "prose");
			expect(out).toBeDefined();
			expect(out).toContain("# LOCOMO Memory");
			expect(out).toContain("session_date_time: 1:56 pm on 8 May, 2023");
			expect(countTokens(out ?? "")).toBeLessThanOrEqual(HEAD_EXTRACT_TOKEN_BUDGET);
		});

		it("returns the metadata block alone when the entire input is metadata-shaped", () => {
			const text = ["# Header", "key: value", "another: thing", ""].join("\n");
			const out = headExtract(text, "prose");
			expect(out).toBeDefined();
			expect(out).toContain("# Header");
			expect(out).toContain("key: value");
		});

		it("leaves plain prose unchanged when there is no metadata prefix", () => {
			const text = "A short paragraph that has no metadata lines preceding it.";
			expect(headExtract(text, "prose")).toBe(text);
		});

		it("does not strip a key:value line that follows real content", () => {
			const text = [
				"This is the opening sentence with enough tokens to count.",
				"key: trailing-value",
			].join("\n");
			const out = headExtract(text, "prose");
			expect(out).toBeDefined();
			expect(out?.startsWith("This is the opening sentence")).toBe(true);
		});
	});
});

describe("shouldDropSummary()", () => {
	it("returns true when the summary is a near-prefix of the chunk", () => {
		const chunk = "The quick brown fox jumps over the lazy dog repeatedly across the meadow.";
		const summary = "The quick brown fox jumps";
		expect(shouldDropSummary(summary, chunk)).toBe(true);
	});

	it("returns false on disjoint summary and chunk text", () => {
		const chunk = "Completely unrelated content about rivers, mountains, and weather patterns.";
		const summary = "Notes about kernel scheduling and process accounting.";
		expect(shouldDropSummary(summary, chunk)).toBe(false);
	});

	it("returns false when summary is empty", () => {
		expect(shouldDropSummary("", "any chunk text here")).toBe(false);
	});

	it("respects the overlapDropRatio boundary", () => {
		// 5-word summary, only 3 words match the chunk prefix → ratio 0.6.
		const summary = "alpha beta gamma delta epsilon";
		const chunk = "alpha beta gamma zeta eta theta iota kappa lambda mu nu xi";
		expect(shouldDropSummary(summary, chunk, { overlapDropRatio: 0.5 })).toBe(true);
		expect(shouldDropSummary(summary, chunk, { overlapDropRatio: 0.8 })).toBe(false);
	});

	it("is case-insensitive and tolerant to surrounding punctuation", () => {
		const chunk = '"The Quick Brown Fox" jumps over the lazy dog.';
		const summary = "the quick brown fox";
		expect(shouldDropSummary(summary, chunk)).toBe(true);
	});

	it("returns true when CJK summary is a prefix of CJK chunk (no whitespace)", () => {
		expect(shouldDropSummary("今天天气很好", "今天天气很好我们去公园然后一起吃饭聊天")).toBe(
			true,
		);
	});

	it("returns false when CJK summary is not a prefix of CJK chunk", () => {
		expect(shouldDropSummary("昨天下雨了", "今天天气很好我们去公园然后一起吃饭聊天")).toBe(
			false,
		);
	});
});

describe("HeadExtractConfigSchema", () => {
	it("parses undefined as the default config", () => {
		const out = HeadExtractConfigSchema.parse(undefined);
		expect(out).toEqual(DEFAULT_HEAD_EXTRACT_CONFIG);
		expect(out.tokenBudget).toBe(HEAD_EXTRACT_TOKEN_BUDGET);
		expect(out.minContentTokens).toBe(HEAD_EXTRACT_MIN_CONTENT_TOKENS);
		expect(out.overlapDropRatio).toBe(HEAD_EXTRACT_OVERLAP_DROP_RATIO);
	});

	it("parses an empty object as the default config", () => {
		expect(HeadExtractConfigSchema.parse({})).toEqual(DEFAULT_HEAD_EXTRACT_CONFIG);
	});
});
