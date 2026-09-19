import { createLogger as createDiagnosticLogger } from "@snoai/utils/logger";
const diagnosticLog = createDiagnosticLogger("mem-claw:learning-file-hooks");
/** @file learning-file-hooks.ts
 * @purpose Hooks reflection outcomes into learning capture and review workflows.
 * @boundary Reflection events, learning files, and plugin lifecycle integration.
 * @see strategy-hook-runner.ts, learning-file-maintenance.ts, openclaw-plugin-runtime.ts.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { ensureSelfImprovementLearningFiles } from "@snoai/sno-station-mem/internal/engine/operations/learning-file-maintenance";
import type { PluginConfig } from "@snoai/sno-station-mem/internal/engine/shared/types";

const SELF_IMPROVEMENT_NOTE_PREFIX = "/note self-improvement (before reset):";
const DEFAULT_SELF_IMPROVEMENT_REMINDER = `## Self-Improvement Reminder

After completing tasks, evaluate if any learnings should be captured:

**Log when:**
- User corrects you -> .learnings/LEARNINGS.md
- Command/operation fails -> .learnings/ERRORS.md
- User wants missing capability -> .learnings/FEATURE_REQUESTS.md
- You discover your knowledge was wrong -> .learnings/LEARNINGS.md
- You find a better approach -> .learnings/LEARNINGS.md

**Promote when pattern is proven:**
- Behavioral patterns -> SOUL.md
- Workflow improvements -> AGENTS.md
- Tool gotchas -> TOOLS.md
Keep entries simple: date, title, what happened, what to do differently.`;

/**
 * Reads self improvement reminder content and applies self-improvement hook wiring fallback
 * behavior for missing data.
 */
async function loadSelfImprovementReminderContent(workspaceDir?: string): Promise<string> {
	const baseDir =
		typeof workspaceDir === "string" && workspaceDir.trim().length ? workspaceDir.trim() : "";
	if (!baseDir) return DEFAULT_SELF_IMPROVEMENT_REMINDER;

	// Compute the normalized reminder path once so later module behavior checks use one value.
	const reminderPath = path.join(baseDir, "SELF_IMPROVEMENT_REMINDER.md");
	try {
		const content = await readFile(reminderPath, "utf-8");
		const trimmed = content.trim();
		return trimmed.length ? trimmed : DEFAULT_SELF_IMPROVEMENT_REMINDER;
	} catch {
		return DEFAULT_SELF_IMPROVEMENT_REMINDER;
	}
}

/** Implements setup self improvement as the local self-improvement hook wiring operation. */
export function setupSelfImprovement(
	api: OpenClawPluginApi,
	config: PluginConfig["selfImprovement"],
	isInternalReflectionSessionKey: (sessionKey: unknown) => boolean,
): void {
	api.registerHook(
		"agent:bootstrap",
		async (event) => {
			try {
				const sessionKey = event.sessionKey;
				const context = event.context;
				// Compute the normalized workspace dir once so later module behavior checks use one value.
				const workspaceDir =
					typeof context.workspaceDir === "string" ? context.workspaceDir.trim() : "";

				if (isInternalReflectionSessionKey(sessionKey)) return;
				// Keep identity and boundary checks ahead of any privileged operation.
				if (config.skipSubagentBootstrap && sessionKey.includes(":subagent:")) return;

				// Keep identity and boundary checks ahead of any privileged operation.
				if (config.ensureLearningFiles && workspaceDir) {
					// Await the module behavior dependency before deriving downstream state.
					await ensureSelfImprovementLearningFiles(workspaceDir);
				}

				const bootstrapFiles = context.bootstrapFiles;
				if (!Array.isArray(bootstrapFiles)) return;

				const alreadyInjected = bootstrapFiles.some((f: unknown) => {
					if (!f || typeof f !== "object") return false;
					// Compute the normalized p once so later module behavior checks use one value.
					const p = (f as Record<string, unknown>).path;
					return p === "SELF_IMPROVEMENT_REMINDER.md";
				});
				if (alreadyInjected) return;

				const content = await loadSelfImprovementReminderContent(workspaceDir || undefined);
				bootstrapFiles.push({
					path: "SELF_IMPROVEMENT_REMINDER.md",
					content,
					virtual: true,
				});
			} catch (err) {
				diagnosticLog.warn("Learning reminder injection failed", { error: err }, { event_name: "memory.learning_file_hooks.learning.reminder.injection.failed", file: "apps/mem-claw/src/hooks/learning-file-hooks.ts", function: "setupSelfImprovement", site_id: "operations.learning-file-hooks.setupSelfImprovement.6219afe5d1" });
			}
		},
		{ name: "mem-claw:self-improvement:bootstrap" },
	);
	if (config.beforeResetNote) {
		/**
		 * Persists self improvement note through the single self-improvement hook wiring write path.
		 */
		const appendSelfImprovementNote = async (event: { messages: string[] }) => {
			try {
				const alreadyPresent = event.messages.some((m) => m.includes(SELF_IMPROVEMENT_NOTE_PREFIX));
				if (alreadyPresent) return;
				event.messages.push(
					[
						SELF_IMPROVEMENT_NOTE_PREFIX,
						"- If anything was learned/corrected, log it now:",
						"  - .learnings/LEARNINGS.md (corrections/best practices)",
						"  - .learnings/ERRORS.md (failures/root causes)",
						"  - .learnings/FEATURE_REQUESTS.md (missing capability)",
						"- Distill reusable rules to AGENTS.md / SOUL.md / TOOLS.md.",
						"- If reusable across tasks, extract a new skill from the learning.",
						"- Reflect -> Store -> Inherit -> Derive -> Apply.",
						"- Then proceed with the new session.",
					].join("\n"),
				);
			} catch (err) {
				diagnosticLog.warn("Learning note injection failed", { error: err }, { event_name: "memory.learning_file_hooks.learning.note.injection.failed", file: "apps/mem-claw/src/hooks/learning-file-hooks.ts", function: "appendSelfImprovementNote", site_id: "operations.learning-file-hooks.appendSelfImprovementNote.f55023edef" });
			}
		};

		api.registerHook("command:new", appendSelfImprovementNote, {
			name: "mem-claw:self-improvement:command-new",
		});
		api.registerHook("command:reset", appendSelfImprovementNote, {
			name: "mem-claw:self-improvement:command-reset",
		});
	}
}
