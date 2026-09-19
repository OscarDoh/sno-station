import { executeMemoryUpdateTool } from "./http-memory-tools";
import { toolHostContext } from "./http-memory-tools";
import type { HostMemoryContext } from "../install/memory-connection";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { MEMORY_CATEGORIES, Type } from "./memory-tool-dependencies";



import { metadataType, resolveToolDescriptions, stringEnum, type ToolContext, type ToolResult } from "./memory-tool-schemas";

export function registerMemoryUpdate(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return {
				name: "memory_update",
				label: "Memory Update",
				description: resolveToolDescriptions(ctx.language).memoryUpdate,
				parameters: Type.Object({
					id: Type.String({ description: "UUID of memory entry" }),
					text: Type.Optional(Type.String({ description: "Updated text content" })),
					category: Type.Optional(stringEnum(MEMORY_CATEGORIES)),
					importance: Type.Optional(Type.Number({ description: "Updated importance" })),
					metadata: metadataType,
				}),
				/** Applies partial memory updates only after ownership and replacement-content checks. */
				async execute(_toolCallId, params): Promise<ToolResult> { return executeMemoryUpdateTool(ctx, access, _toolCallId, params); },
			};
		},
		{ name: "memory_update" },
	);
}