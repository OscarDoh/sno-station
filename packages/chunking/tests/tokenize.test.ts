import { describe, expect, it } from "vitest";
import { countTokens, getCjkRatio, isCjkHeavy } from "../src/tokenize";

/** Asserts countTokens is monotonic non-decreasing on every prefix extension. */
function assertMonotonic(text: string): void {
	let prev = 0;
	for (let i = 1; i <= text.length; i++) {
		const cur = countTokens(text.slice(0, i));
		expect(cur).toBeGreaterThanOrEqual(prev);
		prev = cur;
	}
}

describe("CJK_REGEX coverage (via isCjkHeavy)", () => {
	it("recognizes CJK Extension A (㐀) as CJK", () => {
		expect(isCjkHeavy("㐀㐀㐀")).toBe(true);
	});

	it("returns false for pure ASCII", () => {
		expect(isCjkHeavy("hello world")).toBe(false);
	});

	it("returns true at exactly 30% CJK by non-whitespace ratio", () => {
		// 3 CJK + 7 ASCII non-whitespace chars = 3/10 = 0.3.
		expect(isCjkHeavy("中中中aaaaaaa")).toBe(true);
	});

	it("returns false just below the 30% threshold", () => {
		// 2 CJK + 8 ASCII non-whitespace chars = 2/10 = 0.2.
		expect(isCjkHeavy("中中aaaaaaaa")).toBe(false);
	});

	it("returns true for pure Hiragana", () => {
		expect(isCjkHeavy("こんにちは")).toBe(true);
	});

	it("returns true at 50% mix", () => {
		expect(isCjkHeavy("中中中中中aaaaa")).toBe(true);
	});
});

describe("getCjkRatio()", () => {
	it("counts CJK characters over non-whitespace characters", () => {
		expect(getCjkRatio("abc 中文")).toBeCloseTo(2 / 5, 12);
		expect(getCjkRatio(" \n\t")).toBe(0);
		expect(getCjkRatio("日本語 and English")).toBeGreaterThan(0);
	});

	it("keeps isCjkHeavy as a threshold view over the raw ratio", () => {
		const text = "中文abc";
		expect(isCjkHeavy(text, getCjkRatio(text) - 0.01)).toBe(true);
		expect(isCjkHeavy(text, getCjkRatio(text) + 0.01)).toBe(false);
	});
});

describe("countTokens() — additive formula", () => {
	it("returns 0 for empty string", () => {
		expect(countTokens("")).toBe(0);
	});

	it("pure ASCII length 1 → ceil(1/3) = 1", () => {
		expect(countTokens("a")).toBe(1);
	});

	it("pure ASCII length 3 → ceil(3/3) = 1", () => {
		expect(countTokens("abc")).toBe(1);
	});

	it("pure ASCII length 10 → ceil(10/3) = 4", () => {
		expect(countTokens("a".repeat(10))).toBe(4);
	});

	it("pure ASCII length 100 → ceil(100/3) = 34", () => {
		expect(countTokens("a".repeat(100))).toBe(34);
	});

	it("pure CJK length 1 → ceil(1/1.2) = 1", () => {
		expect(countTokens("中")).toBe(1);
	});

	it("pure CJK length 10 → ceil(10/1.2) = 9", () => {
		expect(countTokens("中".repeat(10))).toBe(9);
	});

	it("pure CJK length 100 → ceil(100/1.2) = 84", () => {
		expect(countTokens("中".repeat(100))).toBe(84);
	});

	it("50/50 mix: 10 CJK + 10 ASCII → ceil(10/1.2 + 10/3) = 12 (NOT 17 from old impl)", () => {
		const text = `${"中".repeat(10)}${"a".repeat(10)}`;
		// Old impl: heavy=true (50% > 30%) → ceil(20/1.2) = 17.
		// New additive: ceil(8.333... + 3.333...) = ceil(11.666...) = 12.
		expect(countTokens(text)).toBe(12);
	});

	it("whitespace-only text: 3 spaces → ceil(3/3) = 1", () => {
		expect(countTokens("   ")).toBe(1);
	});

	it("CJK Extension A: 3 㐀 chars → ceil(3/1.2) = 3 (proves Ext A in CJK_REGEX)", () => {
		// Old CJK_REGEX (without Ext A) would treat 㐀 as non-CJK → ceil(3/3) = 1.
		expect(countTokens("㐀㐀㐀")).toBe(3);
	});
});

describe("countTokens() — strict monotonicity on substring extension", () => {
	const cases: Array<{ name: string; text: string }> = [
		{ name: "ASCII-only", text: "the quick brown fox jumps over the lazy dog repeatedly" },
		{ name: "CJK-only", text: "你好世界今天天气真好我们一起去公园散步好吗" },
		{
			name: "30% CJK mix",
			text: "中中中aaaaaaaaaa中中中bbbbbbbbbb",
		},
		{
			name: "60% CJK mix",
			text: "中中中中中中aaaa中中中中中中bbbb",
		},
		{
			name: "RTL + CJK mix",
			text: "مرحبا中中中hello世界",
		},
		{
			name: "mixed with punctuation",
			text: "Hello, 世界! This is a test... 中文也可以。Yes?",
		},
	];

	for (const { name, text } of cases) {
		it(`monotonic on ${name}`, () => {
			assertMonotonic(text);
		});
	}

	it("regression: crossing the old 30% threshold stays monotonic", () => {
		// Build "aaaaaa" then progressively append CJK chars one at a time.
		// Old impl had a discontinuity at the threshold flip. New impl must not.
		const base = "aaaaaa";
		for (let extra = 0; extra <= 12; extra++) {
			const text = base + "中".repeat(extra);
			assertMonotonic(text);
		}
	});
});
