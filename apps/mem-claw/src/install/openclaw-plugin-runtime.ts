/** @file openclaw-plugin-runtime.ts
 * @purpose Exposes the OpenClaw plugin entry point and stable runtime helper exports.
 * @boundary SDK registration facade only; runtime composition lives in focused modules.
 * @see openclaw-runtime-registration.ts, openclaw-runtime-hooks.ts, openclaw-runtime-service.ts.
 */

import type {
	OpenClawPluginApi as SnoStationMemPluginApi,
	OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/core";
import { pluginConfigSchema } from "@snoai/sno-station-mem/internal/config/plugin-config-schema";
import { registerCompletionTools } from "../commands/openclaw-command-registration";
import { registerEmbedderManagementCli } from "../commands/memory-management-cli";
import { ensureConversationAccessGranted } from "./conversation-access-policy";
import { isCompletionMode } from "@snoai/sno-station-mem/internal/engine/bindings/sno-station-mem-runtime-mode";
import { registerRuntime } from "./openclaw-runtime-registration";
import { initializeRuntimeDiagnostics } from "@snoai/sno-station-mem/internal/engine/observability/runtime-diagnostics";
import { APP_DESCRIPTION, APP_DISPLAY_NAME, APP_NAME } from "../constants";

export {
	deriveSessionDateTime,
	extractAllMessageTexts,
	isAmbientLearningMessage,
	normalizeMessageTimestampMs,
} from "@snoai/sno-station-mem/internal/engine/bindings/sno-station-mem-message-transcript";
export {
	isChatIdBasedAgentId,
	isCompletionMode,
	isGatewayMode,
	parseAgentIdFromSessionKey,
	resolveHookAgentId,
} from "@snoai/sno-station-mem/internal/engine/bindings/sno-station-mem-runtime-mode";
export { registerRuntime } from "./openclaw-runtime-registration";

export const memClawPlugin: OpenClawPluginDefinition = {
	id: APP_NAME,
	name: APP_DISPLAY_NAME,
	description: APP_DESCRIPTION,
	kind: "memory" as const,
	/** Registers the plugin definition with the OpenClaw host runtime. */
	register(api: SnoStationMemPluginApi): void {
		initializeRuntimeDiagnostics();
		// OpenClaw expects register() to return synchronously. Runtime setup
		// continues in the background after config validation.

		if (isCompletionMode()) {
			registerCompletionTools(api);
			return;
		}

		// Self-heal the host config so our typed conversation hooks (auto-recall,
		// reflection, ambient learning) are not silently blocked on OpenClaw
		// 2026.6.9+, which gates conversation access behind a per-plugin config
		// key. No-op once granted; on first start it patches the config and the
		// gateway restarts to pick it up before the rest of registration matters.
		ensureConversationAccessGranted(api);

		// Register the embedder-management CLI before parsing the plugin config so
		// `sno-mem-config embedder show / set / wipe-db` remain usable when the existing
		// config fails Zod validation (e.g. missing OPENAI_API_KEY for an openai
		// preset, dim mismatch). Pure JSON + filesystem ops; no runtime dependencies.
		registerEmbedderManagementCli(api);

		const parsed = pluginConfigSchema.parse(api.pluginConfig ?? {});

		// registerRuntime performs synchronous registration and starts detached
		// warmup work; config errors still propagate immediately.
		registerRuntime(api, parsed);
	},
};

export default memClawPlugin;
