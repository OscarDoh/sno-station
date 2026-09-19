import { describe, expect, it } from "vitest";
import { classifyContentRoute, ContentRouteInputSchema } from "../src/index";

function lines(prefix: string, count: number): string {
	return Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join("\n");
}

describe("classifyContentRoute()", () => {
	it("honors caller-declared attachment before heuristics", () => {
		const result = classifyContentRoute({
			content: "This is ordinary prose that would otherwise be embedded.",
			declaredRoute: "attachment",
		});
		expect(result).toEqual({
			route: "attachment",
			decisionSource: "caller",
			reasons: ["caller-declared-route"],
		});
	});

	it("honors caller-declared embed before attachment-looking text", () => {
		const result = classifyContentRoute({
			content: lines("2026-06-30T10:00:00Z ERROR service failed", 25),
			declaredRoute: "embed",
			contentType: "prose",
		});
		expect(result).toEqual({
			route: "embed",
			contentType: "prose",
			decisionSource: "caller",
			reasons: ["caller-declared-route"],
		});
	});

	it("validates route inputs at trust boundaries", () => {
		expect(ContentRouteInputSchema.safeParse({ content: "hello" }).success).toBe(true);
		expect(ContentRouteInputSchema.safeParse({ content: "hello", declaredRoute: "code" }).success).toBe(
			false,
		);
		expect(ContentRouteInputSchema.safeParse({ content: "hello", contentType: "code" }).success).toBe(
			false,
		);
	});

	it("routes clear logs, JSONL dumps, and shell output to attachment", () => {
		expect(
			classifyContentRoute({
				content: lines("2026-06-30T10:00:00Z ERROR worker failed request_id=abc", 25),
			}),
		).toMatchObject({ route: "attachment", reasons: ["clear-log-dump-shell-shape"] });

		expect(
			classifyContentRoute({
				content: Array.from(
					{ length: 22 },
					(_, index) => `{"level":"error","index":${index},"message":"failed"}`,
				).join("\n"),
			}),
		).toMatchObject({ route: "attachment", reasons: ["clear-log-dump-shell-shape"] });

		expect(
			classifyContentRoute({
				content: lines("$ npm run build && echo completed", 20),
			}),
		).toMatchObject({ route: "attachment", reasons: ["clear-log-dump-shell-shape"] });
	});

	it("routes raw code and metadata-confirmed raw files to attachment", () => {
		const code = [
			"export function alpha() {}",
			"export const beta = 1;",
			"class Gamma {}",
			"interface Delta {}",
			"type Epsilon = string;",
			"const zeta = true;",
		].join("\n");
		expect(classifyContentRoute({ content: code })).toMatchObject({
			route: "attachment",
			reasons: ["clear-code-shape"],
		});

		expect(
			classifyContentRoute({
				content: "ordinary body",
				filename: "src/example.ts",
				mediaType: "text/x-typescript",
			}),
		).toMatchObject({
			route: "attachment",
			reasons: ["metadata-raw-file-signal"],
		});
	});

	it("keeps ambiguous prose and small code examples embedded", () => {
		const technicalProse = [
			"This migration note explains why the parser keeps ordinary text embedded.",
			"Here is a tiny example:",
			"```ts",
			"const value = 1;",
			"```",
			"The surrounding explanation is the semantic content users search for.",
		].join("\n");
		expect(classifyContentRoute({ content: technicalProse })).toMatchObject({
			route: "embed",
			contentType: "prose",
			reasons: [],
		});

		expect(
			classifyContentRoute({
				content: "这是一个普通的中文说明，包含几个技术词 API 和 JSON，但不是日志或转储。",
			}),
		).toMatchObject({ route: "embed", contentType: "prose", reasons: [] });

		expect(
			classifyContentRoute({
				content: "The user said こんにちは and then described the deployment plan in English.",
			}),
		).toMatchObject({ route: "embed", contentType: "prose", reasons: [] });
	});
});
