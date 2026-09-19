import { executeMemoryRecallTool } from "./http-memory-tools";
import { toolHostContext } from "./http-memory-tools";
import type { HostMemoryContext } from "../install/memory-connection";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import { AGGREGATION_OPERATIONS, MEMORY_CATEGORIES, Type } from "./memory-tool-dependencies";


import { resolveToolDescriptions, stringEnum, type ToolContext, type ToolResult } from "./memory-tool-schemas";



const RECALL_PARAMETERS = Type.Object({
	external_reference: Type.Optional(Type.String()),
	external_reference_visibility: Type.Optional(stringEnum(["public", "private"])),
	query: Type.String({
		description: "Search query for finding relevant memories",
	}),
	top_k: Type.Optional(
		Type.Integer({ description: "Max ranked results to return; aggregations return capped evidence" }),
	),
	min_score: Type.Optional(Type.Number({ description: "Minimum score threshold" })),
	scope: Type.Optional(Type.String({ description: "Scope filter" })),
	category: Type.Optional(stringEnum(MEMORY_CATEGORIES)),
	include_metadata: Type.Optional(Type.Boolean({ description: "Include metadata" })),
	include_history: Type.Optional(
		Type.Boolean({
			description:
				"Return every generation of a memory's text, each chunk labelled [current] or [history]. Default returns the current generation of each memory.",
		}),
	),
	include_refused: Type.Optional(
		Type.Boolean({
			description: "Set false to hide refusal-marked memories. Default recall includes them.",
		}),
	),
	token_budget: Type.Optional(
		Type.Integer({ description: "Recall token budget; minimum 5000" }),
	),
	aggregation: Type.Optional(
		Type.Object({
			operation: stringEnum(AGGREGATION_OPERATIONS),
			terms: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
				minItems: 1,
				maxItems: 8,
			}),
		}, {
			description:
				"Required for count, first, last, and complete-population evidence questions. Terms are the facts every matching memory must contain.",
		}),
	),
});
function buildMemoryRecallTool(
	ctx: ToolContext,
	access: HostMemoryContext,
	options: { name: string; label: string; description: string },
) {
	return {
		name: options.name,
		label: options.label,
		description: options.description,
		parameters: RECALL_PARAMETERS,
		/** Searches visible scopes, applies intent boosts, then returns sanitized context text. */
		async execute(_toolCallId: unknown, params: unknown): Promise<ToolResult> { return executeMemoryRecallTool(ctx, access, _toolCallId, params, options); },
	};
}
export function registerMemoryRecall(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => {
			const access = toolHostContext(toolCtx);
			return buildMemoryRecallTool(ctx, access, {
				name: "memory_recall",
				label: "Memory Recall",
				description: resolveToolDescriptions(ctx.language).memoryRecall,
			});
		},
		{ name: "memory_recall" },
	);
}