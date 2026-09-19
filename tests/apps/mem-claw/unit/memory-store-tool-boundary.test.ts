import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it } from "vitest";
import { toolHostContext } from "../../../../apps/mem-claw/src/tools/http-memory-tools.ts";
import { registerMemoryStore } from "../../../../apps/mem-claw/src/tools/memory-store-tool.ts";
import {
	storeParamsSchema,
	type ToolContext,
} from "../../../../apps/mem-claw/src/tools/memory-tool-schemas.ts";

it("preserves gateway administrator scopes without an agent identity", () => {
	const context = toolHostContext({ gatewayClientScopes: ["operator.admin"] });
	expect(context.gatewayClientScopes).toEqual(["operator.admin"]);
});

describe("memory_store category boundary", () => {
	let stateDir: string | undefined;

	afterEach(() => {
		if (stateDir) rmSync(stateDir, { recursive: true, force: true });
		stateDir = undefined;
	});

	it("rejects explicit lessons and stores auto-detected lessons as episodic", async () => {
		stateDir = mkdtempSync(join(tmpdir(), "memory-store-tool-boundary-"));
		let registered: AnyAgentTool | undefined;
		let storedCategory: unknown;
		const api = {
			registerTool(toolOrFactory: unknown) {
				registered =
					typeof toolOrFactory === "function"
						? (toolOrFactory as (context: { agentId: string }) => AnyAgentTool)({
								agentId: "boundary-test",
							})
						: (toolOrFactory as AnyAgentTool);
			},
		} as unknown as OpenClawPluginApi;
		const context = {
			stateDir,
			agentId: "boundary-test",
			store: {
				sqlite: { getFailureReason: () => undefined },
				findByContentHash: () => undefined,
				store: async (input: { category: unknown }) => {
					storedCategory = input.category;
					return { id: "stored-auto-lesson", category: input.category };
				},
			},
			scopePolicy: {
				getDefaultScope: () => "agent:boundary-test",
				validateScope: () => true,
				isAccessible: () => true,
			},
		} as unknown as ToolContext;

		registerMemoryStore(api, context);

		if (!registered) throw new Error("expected memory_store registration");
		const parameters = registered.parameters as {
			properties?: { category?: { enum?: string[] } };
		};
		expect(parameters.properties?.category?.enum).toEqual(["episodic", "profile"]);
		expect(storeParamsSchema.safeParse({ content: "durable lesson", category: "lesson" }).success).toBe(
			false,
		);

		const result = await registered.execute(
			"lesson-call",
			{
				content: "When a file is missing, verify the working directory first.",
				category: "lesson",
			},
			new AbortController().signal,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toMatch(/write authority/i);

		const autoDetected = await registered.execute(
			"auto-lesson-call",
			{ content: "Avoid running migrations on Friday; we learned that the hard way." },
			new AbortController().signal,
		);
		expect(autoDetected.isError).not.toBe(true);
		expect(autoDetected.details?.category).toBe("episodic");
		expect(storedCategory).toBe("episodic");
	});
});
