/** @file self-improvement-extract-skill-tool.ts
 * @purpose Registers the self_improvement_extract_skill tool.
 * @boundary One host tool registration and its handler logic.
 */

import { selfImprovementExtractSkillSchema } from "./memory-self-improvement-schemas";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import {
	SnoStationMemError,
	ensureSelfImprovementLearningFiles,
	join,
	mkdir,
	readFile,
	Type,
	writeFile,
} from "./memory-tool-dependencies";
import { escapeRegExp, resolveWorkspaceDir, withFileWriteQueue } from "./memory-tool-files";
import {
	makeResult,
	runWithAudit,
} from "./learning-tool-results";
import { stringEnum, type ToolContext, type ToolResult } from "./memory-tool-schemas";

export function registerSelfImprovementExtractSkill(
	api: SnoStationMemPluginApi,
	ctx: ToolContext,
): void {
	api.registerTool(
		(toolCtx) => ({
			name: "self_improvement_extract_skill",
			label: "Extract Skill From Learning",
			description:
				"Create a new skill scaffold from a learning entry and mark the source learning as promoted_to_skill.",
			parameters: Type.Object({
				learningId: Type.String({
					description: "Learning ID like LRN-YYYYMMDD-001",
				}),
				skillName: Type.String({
					description: "Skill folder name, lowercase with hyphens",
				}),
				sourceFile: Type.Optional(stringEnum(["LEARNINGS.md", "ERRORS.md", "FEATURE_REQUESTS.md"])),
				outputDir: Type.Optional(
					Type.String({
						description: "Relative output dir under workspace (default: skills)",
					}),
				),
			}),
			/** Promotes a learning entry into a skill scaffold inside the validated workspace. */
			async execute(_toolCallId, params): Promise<ToolResult> {
				return runWithAudit(ctx, "self_improvement_extract_skill", undefined, async () => {
					const parsed = selfImprovementExtractSkillSchema.safeParse(params);
					// Handle the absent-value case explicitly before the happy path depends on it.
					if (!parsed.success) {
						return makeResult(`Invalid parameters: ${parsed.error.message}`, {
							error: "invalid_params",
						});
					}
					const { learningId, skillName, sourceFile, outputDir } = parsed.data;
					// Compute the normalized workspace dir once so later tool execution checks use one value.
					const workspaceDir = resolveWorkspaceDir(toolCtx, ctx.workspaceDir);
					// Await the tool execution dependency before deriving downstream state.
					await ensureSelfImprovementLearningFiles(workspaceDir);
					// Compute the normalized learnings path once so later tool execution checks use one value.
					const learningsPath = join(workspaceDir, ".learnings", sourceFile);
					const safeOutputDir = outputDir
						.replace(/\\/g, "/")
						.split("/")
						.filter((s) => s && s !== "." && s !== "..")
						.join("/");
					const skillDir = join(workspaceDir, safeOutputDir || "skills", skillName);
					await mkdir(skillDir, { recursive: true });
					const skillTitle = skillName
						.split("-")
						.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
						.join(" ");
					const summary = await withFileWriteQueue(learningsPath, async () => {
						const learningBody = await readFile(learningsPath, "utf-8");
						const escapedId = escapeRegExp(learningId.trim());
						const entryRegex = new RegExp(`## \\[${escapedId}\\][\\s\\S]*?(?=\\n## \\[|$)`);
						const match = learningBody.match(entryRegex);
						// Guard match here so the remaining tool execution path works with normalized inputs.
						if (!match) {
							// Surface this invalid tool execution state as an explicit typed failure.
							throw new SnoStationMemError(
								"learning_not_found",
								`Learning entry ${learningId} not found in .learnings/${sourceFile}`,
							);
						}
						const summaryMatch = match[0].match(/### Summary\n([\s\S]*?)\n###/m);
						return (summaryMatch?.[1] ?? "Summarize the source learning here.").trim();
					});
					const skillContent = [
						"---",
						`name: ${skillName}`,
						`description: "Extracted from learning ${learningId}. Replace with a concise description."`,
						"---",
						"",
						`# ${skillTitle}`,
						"",
						"## Why",
						summary,
						"",
						"## When To Use",
						"- [TODO] Define trigger conditions",
						"",
						"## Steps",
						"1. [TODO] Add repeatable workflow steps",
						"2. [TODO] Add verification steps",
						"",
						"## Source Learning",
						`- Learning ID: ${learningId}`,
						`- Source File: .learnings/${sourceFile}`,
						"",
					].join("\n");
					const skillPath = join(skillDir, "SKILL.md");
					await writeFile(skillPath, skillContent, "utf-8");
					await withFileWriteQueue(learningsPath, async () => {
						const learningBody = await readFile(learningsPath, "utf-8");
						const escapedId = escapeRegExp(learningId.trim());
						const entryRegex = new RegExp(`## \\[${escapedId}\\][\\s\\S]*?(?=\\n## \\[|$)`);
						const match = learningBody.match(entryRegex);
						// Guard match here so the remaining tool execution path works with normalized inputs.
						if (!match) {
							// Surface this invalid tool execution state as an explicit typed failure.
							throw new SnoStationMemError(
								"learning_not_found",
								`Learning entry ${learningId} not found in .learnings/${sourceFile}`,
							);
						}
						const promotedMarker = "**Status**: promoted_to_skill";
						const skillPathMarker = `- Skill-Path: ${safeOutputDir || "skills"}/${skillName}`;
						let updatedEntry = match[0];
						updatedEntry = updatedEntry.includes("**Status**:")
							? updatedEntry.replace(/\*\*Status\*\*:\s*.+/m, promotedMarker)
							: `${updatedEntry.trimEnd()}\n${promotedMarker}\n`;
						// Isolate the tool execution operation that can fail because of runtime I/O or input shape.
						if (!updatedEntry.includes("Skill-Path:")) {
							updatedEntry = `${updatedEntry.trimEnd()}\n${skillPathMarker}\n`;
						}
						await writeFile(learningsPath, learningBody.replace(match[0], updatedEntry), "utf-8");
					});

					return makeResult(
						`Extracted skill scaffold to ${safeOutputDir || "skills"}/${skillName}/SKILL.md and updated ${learningId}.`,
						{
							action: "skill_extracted",
							learningId,
							sourceFile,
							skillPath: `${safeOutputDir || "skills"}/${skillName}/SKILL.md`,
						},
					);
				});
			},
		}),
		{ name: "self_improvement_extract_skill" },
	);
}
