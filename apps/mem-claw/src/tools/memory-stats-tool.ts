import { executeMemoryStatsTool } from "./http-memory-tools";
import { toolHostContext } from "./http-memory-tools";
import type { HostMemoryContext } from "../install/memory-connection";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { Type } from "./memory-tool-dependencies";

import { resolveToolDescriptions, type ToolContext, type ToolResult } from "./memory-tool-schemas";
export function registerMemoryStats(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return {
				name: "memory_stats",
				label: "Memory Stats",
				description: resolveToolDescriptions(ctx.language).memoryStats,
				parameters: Type.Object({
					scope: Type.Optional(Type.String({ description: "Scope filter" })),
				}),
				/** Returns aggregate memory statistics constrained to scopes visible to the caller. */
				async execute(_toolCallId, params): Promise<ToolResult> { return executeMemoryStatsTool(ctx, access, _toolCallId, params); },
			};
		},
		{ name: "memory_stats" },
	);
}