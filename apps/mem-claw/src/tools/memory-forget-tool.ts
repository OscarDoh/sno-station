import { executeMemoryForgetTool } from "./http-memory-tools";
import { toolHostContext } from "./http-memory-tools";
import type { HostMemoryContext } from "../install/memory-connection";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { Type } from "./memory-tool-dependencies";

import { resolveToolDescriptions, type ToolContext, type ToolResult } from "./memory-tool-schemas";

export function registerMemoryForget(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return {
				name: "memory_forget",
				label: "Memory Forget",
				description: resolveToolDescriptions(ctx.language).memoryForget,
				parameters: Type.Object({
					id: Type.Optional(Type.String({ description: "Memory ID to delete" })),
					query: Type.Optional(Type.String({ description: "Search query for deletion" })),
					suppress_key: Type.Optional(
						Type.Object({
							subject: Type.String({ description: "Canonical subject to suppress" }),
							attribute: Type.String({ description: "Attribute to suppress" }),
						}),
					),
					suppress_content: Type.Optional(
						Type.String({ description: "Exact claim text to suppress" }),
					),
					scope: Type.Optional(Type.String({ description: "Scope filter" })),
					min_score: Type.Optional(
						Type.Number({
							description: "Minimum semantic score for query matches",
						}),
					),
					max_delete: Type.Optional(
						Type.Integer({
							description: "Max number of query matches to delete",
						}),
					),
					confirm: Type.Optional(
						Type.Boolean({
							description: "Must be true to execute query-based deletion",
						}),
					),
				}),
				/** Deletes by id or confirmed query while preserving agent scope boundaries. */
				async execute(_toolCallId, params): Promise<ToolResult> { return executeMemoryForgetTool(ctx, access, _toolCallId, params); },
			};
		},
		{ name: "memory_forget" },
	);
}