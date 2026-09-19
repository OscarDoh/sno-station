import { executeMemoryReflectionResolveTool } from "./http-memory-tools";


import { toolHostContext } from "./http-memory-tools";
import type { HostMemoryContext } from "../install/memory-connection";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { Type } from "./memory-tool-dependencies";

import type { ToolContext, ToolResult } from "./memory-tool-schemas";

export function registerMemoryReflectionResolve(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return {
				name: "memory_reflection_resolve",
				label: "Memory Reflection Resolve",
				description:
					"Mark a memory-reflection item resolved so it stops being injected during reflection recall. Provide memoryId to resolve one item, or query to preview matching unresolved items.",
				parameters: Type.Object({
					memoryId: Type.Optional(Type.String({ description: "Reflection item id to resolve." })),
					query: Type.Optional(
						Type.String({ description: "Search query to preview matching unresolved reflection items." }),
					),
					scope: Type.Optional(Type.String({ description: "Optional scope filter." })),
					dryRun: Type.Optional(
						Type.Boolean({
							description: "Preview only. Defaults to true for query mode and false for memoryId mode.",
						}),
					),
					note: Type.Optional(Type.String({ description: "Optional resolution note for the audit trail." })),
					limit: Type.Optional(
						Type.Integer({ description: "Max query candidates to preview/resolve (default 5, max 20)." }),
					),
				}),
				async execute(_toolCallId, params): Promise<ToolResult> { return executeMemoryReflectionResolveTool(ctx, access, _toolCallId, params); },
			};
		},
		{ name: "memory_reflection_resolve" },
	);
}