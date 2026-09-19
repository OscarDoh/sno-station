/** @file memory-tool-registration.ts
 * @purpose Public memory tool registration entrypoint and grouped tool exports.
 * @boundary Composition only; individual tool logic lives in focused modules.
 */

import { registerMemoryForget } from "./memory-forget-tool";
import { registerMemoryList } from "./memory-list-tool";
import { registerMemoryRecall } from "./memory-recall-tool";
import { registerMemoryReflectionResolve } from "./memory-reflection-resolve-tool";
import { registerMemoryStats } from "./memory-stats-tool";
import { registerMemorySave } from "./memory-store-tool";
import type { SnoStationMemPluginApi } from "./memory-tool-dependencies";
import type { ToolContext } from "./memory-tool-schemas";
import { registerMemoryUpdate } from "./memory-update-tool";
import { registerSelfImprovementExtractSkill } from "./self-improvement-extract-skill-tool";
import { registerSelfImprovementLog } from "./self-improvement-log-tool";
import { registerSelfImprovementReview } from "./self-improvement-review-tool";

export * from "./memory-forget-tool";
export * from "./memory-list-tool";
export * from "./memory-recall-tool";
export * from "./memory-stats-tool";
export * from "./memory-store-tool";
export * from "./memory-tool-schemas";
export * from "./memory-update-tool";

/** Installs the complete memory tool surface on the host plugin API. */
export function registerAllMemoryTools(api: SnoStationMemPluginApi, ctx: ToolContext): void {
	registerMemoryRecall(api, ctx);
	registerMemorySave(api, ctx);
	registerMemoryForget(api, ctx);
	registerMemoryUpdate(api, ctx);
	registerMemoryStats(api, ctx);
	registerMemoryList(api, ctx);
	registerMemoryReflectionResolve(api, ctx);

	// Guard guard condition here so the remaining tool execution path works with normalized inputs.
	if (ctx.selfImprovementEnabled) {
		registerSelfImprovementLog(api, ctx);
		registerSelfImprovementExtractSkill(api, ctx);
		registerSelfImprovementReview(api, ctx);
	}
}
