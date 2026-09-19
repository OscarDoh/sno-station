import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import {
	ensureSelfImprovementLearningFiles,
	join,
	readFile,
	Type,
} from "./memory-tool-dependencies";
import { resolveWorkspaceDir } from "./memory-tool-files";
import {
	makeResult,
	runWithAudit,
} from "./learning-tool-results";
import type { ToolContext, ToolResult } from "./memory-tool-schemas";

export function registerSelfImprovementReview(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	api.registerTool(
		(toolCtx) => ({
			name: "self_improvement_review",
			label: "Self-Improvement Review",
			description:
				"Summarize governance backlog from .learnings files (pending/high-priority/promoted counts).",
			parameters: Type.Object({}),
			/** Summarizes learning-file backlog counts without mutating governance files. */
			async execute(): Promise<ToolResult> {
				return runWithAudit(ctx, "self_improvement_review", undefined, async () => {
					// Compute the normalized workspace dir once so later tool execution checks use one value.
					const workspaceDir = resolveWorkspaceDir(toolCtx, ctx.workspaceDir);
					// Await the tool execution dependency before deriving downstream state.
					await ensureSelfImprovementLearningFiles(workspaceDir);
					// Compute the normalized learnings dir once so later tool execution checks use one value.
					const learningsDir = join(workspaceDir, ".learnings");
					const files = ["LEARNINGS.md", "ERRORS.md", "FEATURE_REQUESTS.md"] as const;
					const stats = {
						pending: 0,
						high: 0,
						promoted: 0,
						total: 0,
					};

					// Iterate deterministically so tool execution output order remains stable.
					for (const f of files) {
						const content = await readFile(join(learningsDir, f), "utf-8").catch(() => "");
						stats.total += (content.match(/^## \[/gm) ?? []).length;
						stats.pending += (content.match(/\*\*Status\*\*:\s*pending/gi) ?? []).length;
						stats.high += (content.match(/\*\*Priority\*\*:\s*(high|critical)/gi) ?? []).length;
						stats.promoted += (
							content.match(/\*\*Status\*\*:\s*promoted(_to_skill)?/gi) ?? []
						).length;
					}

					const text = [
						"Self-Improvement Governance Snapshot:",
						`- Total entries: ${stats.total}`,
						`- Pending: ${stats.pending}`,
						`- High/Critical: ${stats.high}`,
						`- Promoted: ${stats.promoted}`,
						"",
						"Recommended loop:",
						"1) Resolve high-priority pending entries",
						"2) Distill reusable rules into AGENTS.md / SOUL.md / TOOLS.md",
						"3) Extract repeatable patterns as skills",
					].join("\n");

					return makeResult(text, { action: "review", stats });
				});
			},
		}),
		{ name: "self_improvement_review" },
	);
}
