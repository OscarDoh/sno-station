/** @file entry-shim.ts
 * @purpose OpenClaw load entry. Kicks off background self-upgrade and re-exports
 *   the active plugin runtime surface unchanged.
 * @boundary OpenClaw loads this entry through its plugin loader, so exported
 *   hooks must match the bundled runtime surface exactly.
 */

import { pathToFileURL } from "node:url";
import { writeEmergencyDiagnostic } from "@snoai/sno-station-mem/internal/engine/observability/early-diagnostics";
import * as bundled from "./openclaw-plugin-runtime";
import { scheduleBackgroundUpgrade } from "./check";
import { quarantineActiveVersion, resolveActiveVersion } from "./stage";

type RuntimeModule = typeof bundled;
const FUNCTION_EXPORTS = [
	"registerRuntime",
	"deriveSessionDateTime",
	"extractAllMessageTexts",
	"isAmbientLearningMessage",
	"normalizeMessageTimestampMs",
	"isChatIdBasedAgentId",
	"isCompletionMode",
	"isGatewayMode",
	"parseAgentIdFromSessionKey",
	"resolveHookAgentId",
] as const;

const shimUrl = import.meta.url;
const real = await loadRuntime(shimUrl);

startBackgroundUpgrade(shimUrl);

async function loadRuntime(shimUrl: string): Promise<RuntimeModule> {
	try {
		const stagedEntry = resolveActiveVersion(shimUrl);
		if (!stagedEntry) return bundled;
		const candidate: unknown = await import(pathToFileURL(stagedEntry).href);
		if (isRuntimeModule(candidate)) return candidate;
		quarantineStagedRuntime(new Error("staged runtime export shape mismatch"));
		return bundled;
	} catch (error) {
		quarantineStagedRuntime(error);
		return bundled;
	}
}

function quarantineStagedRuntime(error: unknown): void {
	try {
		quarantineActiveVersion(error);
	} catch (quarantineError) {
		try {
			writeEmergencyDiagnostic({
				level: "warn", body: "Staged runtime quarantine failed",
				attributes: { load_error: error, quarantine_error: quarantineError },
				source: {
					event_name: "upgrade.runtime.quarantine_failed",
					file: "apps/mem-claw/src/install/entry-shim.ts",
					function: "quarantineStagedRuntime",
					site_id: "upgrade.runtime.quarantine_failed",
				},
			});
		} catch {
			// Loading the bundled runtime is more important than reporting cleanup failure.
		}
	}
}

function startBackgroundUpgrade(shimUrl: string): void {
	try {
		scheduleBackgroundUpgrade(shimUrl).catch(writeBackgroundUpgradeError);
	} catch (error) {
		writeBackgroundUpgradeError(error);
	}
}

function writeBackgroundUpgradeError(error: unknown): void {
	try {
		writeEmergencyDiagnostic({
			level: "warn", body: "Background self-upgrade failed", attributes: { error },
			source: {
				event_name: "upgrade.background.failed",
				file: "apps/mem-claw/src/install/entry-shim.ts",
				function: "writeBackgroundUpgradeError",
				site_id: "upgrade.background.failed",
			},
		});
	} catch {
		// Plugin startup must not depend on diagnostics being writable.
	}
}

function isRuntimeModule(value: unknown): value is RuntimeModule {
	if (!isRecord(value)) return false;
	if (!isPluginExport(value.default)) return false;
	if (!isPluginExport(value.memClawPlugin)) return false;
	for (const name of FUNCTION_EXPORTS) {
		if (typeof value[name] !== "function") return false;
	}
	return true;
}

function isPluginExport(value: unknown): boolean {
	return isRecord(value) && typeof value.id === "string" && typeof value.register === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const realDefault: RuntimeModule["default"] = real.default;
export default realDefault;
export const memClawPlugin: RuntimeModule["memClawPlugin"] = real.memClawPlugin;
export const registerRuntime: RuntimeModule["registerRuntime"] = real.registerRuntime;
export const deriveSessionDateTime: RuntimeModule["deriveSessionDateTime"] =
	real.deriveSessionDateTime;
export const extractAllMessageTexts: RuntimeModule["extractAllMessageTexts"] =
	real.extractAllMessageTexts;
export const isAmbientLearningMessage: RuntimeModule["isAmbientLearningMessage"] =
	real.isAmbientLearningMessage;
export const normalizeMessageTimestampMs: RuntimeModule["normalizeMessageTimestampMs"] =
	real.normalizeMessageTimestampMs;
export const isChatIdBasedAgentId: RuntimeModule["isChatIdBasedAgentId"] =
	real.isChatIdBasedAgentId;
export const isCompletionMode: RuntimeModule["isCompletionMode"] = real.isCompletionMode;
export const isGatewayMode: RuntimeModule["isGatewayMode"] = real.isGatewayMode;
export const parseAgentIdFromSessionKey: RuntimeModule["parseAgentIdFromSessionKey"] =
	real.parseAgentIdFromSessionKey;
export const resolveHookAgentId: RuntimeModule["resolveHookAgentId"] = real.resolveHookAgentId;
