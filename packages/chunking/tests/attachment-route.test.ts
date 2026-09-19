import { describe, expect, it } from "vitest";
import {
	ATTACHMENT_SUMMARY_CAP_TOKENS,
	ATTACHMENT_SUMMARY_HEAD_TOKENS,
	ATTACHMENT_SUMMARY_TAIL_TOKENS,
	AttachmentRouteInputSchema,
	buildAttachmentRoute,
	countTokens,
} from "../src/index";

describe("buildAttachmentRoute()", () => {
	it("validates attachment inputs at trust boundaries", () => {
		expect(AttachmentRouteInputSchema.safeParse({ content: "raw" }).success).toBe(true);
		expect(AttachmentRouteInputSchema.safeParse({ content: 123 }).success).toBe(false);
		expect(AttachmentRouteInputSchema.safeParse({ content: "raw", route: "embed" }).success).toBe(
			false,
		);
	});

	it("emits raw storage payload and handle vectors linked by attachmentId", () => {
		const raw = "export function add(a: number, b: number): number {\n\treturn a + b;\n}";
		const result = buildAttachmentRoute({
			attachmentId: "att-code-1",
			content: raw,
			filename: "math.ts",
			mediaType: "text/x-typescript",
			routeReasons: ["declared-attachment"],
		});

		expect(result.route).toBe("attachment");
		expect(result.attachmentId).toBe("att-code-1");
		expect(result.raw).toEqual({
			content: raw,
			filename: "math.ts",
			mediaType: "text/x-typescript",
		});
		expect(result.handle.attachmentId).toBe("att-code-1");
		expect(result.handle.vectors.map((vector) => vector.kind)).toEqual([
			"summary",
			"tags",
			"filename",
			"type",
		]);
		expect(result.handle.vectors.some((vector) => vector.text === raw)).toBe(false);
	});

	it("uses consumer-provided one-sentence summary without changing its source", () => {
		const result = buildAttachmentRoute({
			content: "raw diagnostic payload",
			consumerSummary: "Diagnostic payload showing a failed startup check.",
		});
		const summary = result.handle.vectors.find((vector) => vector.kind === "summary");
		expect(summary).toEqual({
			kind: "summary",
			text: "Diagnostic payload showing a failed startup check.",
			source: "consumer-llm",
			tags: ["route:attachment"],
		});
	});

	it("emits deterministic fallback summary and metadata tags in local-only mode", () => {
		const input = {
			content: "\n\nINFO boot complete\nERROR failed to open database\nTRACE line",
			filename: "server.log",
			mediaType: "text/plain",
			routeReasons: ["log-shape"],
		};

		const first = buildAttachmentRoute(input);
		const second = buildAttachmentRoute(input);
		expect(JSON.stringify(first.handle)).toBe(JSON.stringify(second.handle));

		const summary = first.handle.vectors.find((vector) => vector.kind === "summary");
		expect(summary?.source).toBe("deterministic-auto-extract");
		expect(summary?.text).toContain("INFO boot complete");
		expect(summary?.tags).toEqual([
			"route:attachment",
			"filename:server.log",
			"extension:log",
			"mediaType:text/plain",
			"reason:log-shape",
		]);
	});

	it("caps summarizer input at 2048 char-approximation tokens with head/tail sampling", () => {
		const middleOnly = "MIDDLE_UNIQUE_SHOULD_NOT_APPEAR";
		const content = [
			"HEAD_MARKER ",
			"a".repeat(7000),
			middleOnly,
			"z".repeat(2500),
			" TAIL_MARKER",
		].join("");
		const result = buildAttachmentRoute({ content, filename: "large.dump" });

		expect(ATTACHMENT_SUMMARY_CAP_TOKENS).toBe(2048);
		expect(ATTACHMENT_SUMMARY_HEAD_TOKENS).toBe(1536);
		expect(ATTACHMENT_SUMMARY_TAIL_TOKENS).toBe(512);
		expect(result.handle.summaryInput.capTokens).toBe(2048);
		expect(result.handle.summaryInput.wasTruncated).toBe(true);
		expect(result.handle.summaryInput.strategy).toBe("head-tail");
		expect(result.handle.summaryInput.text).toContain("HEAD_MARKER");
		expect(result.handle.summaryInput.text).toContain("TAIL_MARKER");
		expect(result.handle.summaryInput.text).not.toContain(middleOnly);
		expect(countTokens(result.handle.summaryInput.text)).toBeLessThanOrEqual(2048);
		for (const vector of result.handle.vectors) {
			expect(vector.text).not.toContain(middleOnly);
		}
	});
});
