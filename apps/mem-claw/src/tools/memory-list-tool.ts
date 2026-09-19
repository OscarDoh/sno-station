import { executeMemoryListTool } from "./http-memory-tools";
import { toolHostContext } from "./http-memory-tools";
import type { HostMemoryContext } from "../install/memory-connection";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { MEMORY_CATEGORIES, Type } from "./memory-tool-dependencies";


import { resolveToolDescriptions, stringEnum, type ToolContext, type ToolResult } from "./memory-tool-schemas";
export function registerMemoryList(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return {
				name: "memory_list",
				label: "Memory List",
				description: resolveToolDescriptions(ctx.language).memoryList,
				parameters: Type.Object({
					scope: Type.Optional(Type.String({ description: "Scope filter" })),
					category: Type.Optional(stringEnum(MEMORY_CATEGORIES)),
					limit: Type.Optional(Type.Integer({ description: "Page size" })),
					offset: Type.Optional(Type.Integer({ description: "Offset" })),
					importance_min: Type.Optional(Type.Number({ description: "Minimum importance" })),
				}),
				/** Lists paginated memories after applying scope, category, and importance filters. */
				async execute(_toolCallId, params): Promise<ToolResult> { return executeMemoryListTool(ctx, access, _toolCallId, params); },
			};
		},
		{ name: "memory_list" },
	);
}