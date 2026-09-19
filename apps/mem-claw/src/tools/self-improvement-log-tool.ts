/** @file self-improvement-log-tool.ts
 * @purpose Registers the self_improvement_log tool.
 * @boundary One host tool registration and its handler logic.
 */

import {
	LEARNING_TYPE_FILE,
	LEARNING_TYPE_PREFIX,
	selfImprovementLogSchema,
} from "./memory-self-improvement-schemas";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import {
	appendFile,
	ensureSelfImprovementLearningFiles,
	join,
	readFile,
	Type,
} from "./memory-tool-dependencies";
import {
	nextLearningId,
	resolveWorkspaceDir,
	withFileWriteQueue,
} from "./memory-tool-files";
import {
	makeResult,
	runWithAudit,
} from "./learning-tool-results";
import { stringEnum, type ToolContext, type ToolResult } from "./memory-tool-schemas";

export function registerSelfImprovementLog(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => ({
			name: "self_improvement_log",
			label: "Self-Improvement Log",
			description:
				"Log structured learning/error/feature-request entries into .learnings for governance and later distillation.",
			parameters: Type.Object({
				type: stringEnum(["learning", "error", "feature"]),
				summary: Type.String({ description: "One-line summary" }),
				details: Type.Optional(Type.String({ description: "Detailed context or error output" })),
				suggestedAction: Type.Optional(
					Type.String({ description: "Concrete action to prevent recurrence" }),
				),
				category: Type.Optional(
					Type.String({
						description:
							"learning category (correction/best_practice/knowledge_gap) when type=learning",
					}),
				),
				area: Type.Optional(
					Type.String({
						description: "frontend|backend|infra|tests|docs|config or custom area",
					}),
				),
				priority: Type.Optional(Type.String({ description: "low|medium|high|critical" })),
			}),
			/** Appends governance entries into workspace learning files with serialized writes. */
			async execute(_toolCallId, params): Promise<ToolResult> {
				return runWithAudit(ctx, "self_improvement_log", undefined, async () => {
					const parsed = selfImprovementLogSchema.safeParse(params);
					// Handle the absent-value case explicitly before the happy path depends on it.
					if (!parsed.success) {
						return makeResult(`Invalid parameters: ${parsed.error.message}`, {
							error: "invalid_params",
						});
					}
					const { type, summary, details, suggestedAction, category, area, priority } = parsed.data;
					// Compute the normalized workspace dir once so later tool execution checks use one value.
					const workspaceDir = resolveWorkspaceDir(toolCtx, ctx.workspaceDir);
					// Await the tool execution dependency before deriving downstream state.
					await ensureSelfImprovementLearningFiles(workspaceDir);
					// Compute the normalized learnings dir once so later tool execution checks use one value.
					const learningsDir = join(workspaceDir, ".learnings");
					const fileName = LEARNING_TYPE_FILE[type];
					const filePath = join(learningsDir, fileName);
					const idPrefix = LEARNING_TYPE_PREFIX[type];
					const entryId = await withFileWriteQueue(filePath, async () => {
						const id = await nextLearningId(filePath, idPrefix);
						const titleSuffix = type === "learning" ? ` ${category}` : "";
						const entry = [
							`## [${id}]${titleSuffix}`,
							"",
							`**Logged**: ${new Date().toISOString()}`,
							`**Priority**: ${priority}`,
							`**Status**: pending`,
							`**Area**: ${area}`,
							"",
							"### Summary",
							summary.trim(),
							"",
							"### Details",
							details.trim() || "-",
							"",
							"### Suggested Action",
							suggestedAction.trim() || "-",
							"",
							"### Metadata",
							"- Source: mem-claw/self_improvement_log",
							"---",
							"",
						].join("\n");
						// Await the tool execution dependency before deriving downstream state.
						const prev = await readFile(filePath, "utf-8").catch(() => "");
						const separator = prev.trimEnd().length > 0 ? "\n\n" : "";
						await appendFile(filePath, `${separator}${entry}`, "utf-8");
						return id;
					});
					return makeResult(`Logged ${type} entry ${entryId} to .learnings/${fileName}`, {
						action: "logged",
						type,
						id: entryId,
						filePath,
					});
				});
			},
		}),
		{ name: "self_improvement_log" },
	);
}
