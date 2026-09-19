import { executeMemorySaveTool } from "./http-memory-tools";
import { toolHostContext } from "./http-memory-tools";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { Type, MEMORY_CATEGORIES } from "./memory-tool-dependencies";


import { metadataType, resolveToolDescriptions, stringEnum, type ToolContext, type ToolResult } from "./memory-tool-schemas";


export function registerMemorySave(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return {
				name: "memory_store",
				label: "Memory Store",
				description: resolveToolDescriptions(ctx.language).memoryStore,
				parameters: Type.Object({
					content: Type.String({ description: "Information to remember" }),
				category: Type.Optional(stringEnum(MEMORY_CATEGORIES)),
					scope: Type.Optional(Type.String({ description: "Memory scope" })),
					importance: Type.Optional(Type.Number({ description: "Importance score 0-1" })),
					metadata: metadataType,
				}),
				/** Stores clean, non-noise content after envelope stripping, scope checks, and embedding. */
				async execute(_toolCallId, params): Promise<ToolResult> { return executeMemorySaveTool(ctx, access, _toolCallId, params); },
			};
		},
		{ name: "memory_store" },
	);
}
