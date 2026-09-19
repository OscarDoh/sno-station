/** @file embedder-config-files.ts
 * @purpose Reads, writes, and wipes SnoStationMem embedder config state for CLI commands.
 * @boundary Filesystem/config helpers only; command registration lives elsewhere.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getInstallationConfigPath, getDefaultStorePath } from "../shared/paths";
import { installationSettingsSchema } from "../../../config/installation-settings";
import { FIXED_PROTOCOL_VALUE_74, FIXED_EXTRACTION_KEY_NAME } from "../../model/signed-registry-constants";
import { confirmDestructiveAction } from "./memory-cli-shared";
import { SnoStationMemError } from "../shared/errors";
import {
	getSnoStationMemDataDir,
	getDefaultDbPath,
	getInstallManifestPath,
} from "../../store/data-paths";
import { readInstallManifest, resolveDbPath } from "../../store/install-manifest";

export type ResolvePath = (input: string) => string;

export interface SnoStationMemPluginEntryConfig {
	dbPath?: string;
	embedding?: Record<string, unknown>;
	extraction?: { llm: { apiKey?: string } };
	mode?: "local-first" | "agent-native" | "rem-enhanced";
	retrieval?: Record<string, unknown>;
	memoryTelemetry?: { enabled: boolean; currentKeyVersion: number };
	autoRecallTimeoutMs?: number;
}

export interface SnoStationMemConfig {
	plugins?: {
		entries?: Record<string, { config?: SnoStationMemPluginEntryConfig } | undefined>;
	};
}

export const PLUGIN_ENTRY_KEY: typeof FIXED_PROTOCOL_VALUE_74 = FIXED_PROTOCOL_VALUE_74;

/** Returns the installation settings path for this OS principal and profile. */
export function resolveSnoStationMemConfigPath(): string {
	return getInstallationConfigPath();
}

/** Returns the SQLite DB path for the active profile. */
export function resolveSqliteDbPath(
	cfg: SnoStationMemConfig | undefined,
	resolvePath: ResolvePath,
): string {
	const configuredPath = cfg?.plugins?.entries?.[PLUGIN_ENTRY_KEY]?.config?.dbPath;
	if (configuredPath) {
		const resolved = resolvePath(configuredPath);
		if (path.isAbsolute(configuredPath) && path.isAbsolute(resolved)) {
			return resolved;
		}
	}
	const manifestPath = getInstallManifestPath();
	if (existsSync(manifestPath)) {
		return resolveDbPath(readInstallManifest(manifestPath), getSnoStationMemDataDir());
	}
	return getDefaultDbPath();
}

export function readSnoStationMemConfig(configPath: string): SnoStationMemConfig {
	if (!existsSync(configPath)) {
		throw new SnoStationMemError(
			"config_not_found",
			`Installation settings not found at ${configPath}; bind the store first.`,
		);
	}
	const raw = readFileSync(configPath, "utf-8");
	try {
		if ((statSync(configPath).mode & 0o777) !== 0o600) throw new Error("installation settings require mode 0600");
		const settings = installationSettingsSchema.parse(JSON.parse(raw));
		// Adapt configuration data for the unchanged REM callers, never a host API.
		return { plugins: { entries: { [PLUGIN_ENTRY_KEY]: { config: {
			dbPath: settings.storePath, embedding: settings.embedding, mode: settings.mode,
			...(settings.remOperations ? { remOperations: settings.remOperations } : {}),
			...(settings.remEnhanced ? { remEnhanced: settings.remEnhanced } : {}),
			retrieval: { ...settings.retrieval,
				...(settings.rerankKeyRef ? { rerankApiKey: process.env[settings.rerankKeyRef] } : {}) },
			...(settings.memoryTelemetry ? { memoryTelemetry: settings.memoryTelemetry } : {}),
			...(settings.autoRecallTimeoutMs ? { autoRecallTimeoutMs: settings.autoRecallTimeoutMs } : {}),
			...(settings.mode === "local-first" ? {} : { extraction: { llm: { apiKey: process.env[settings.extractionKeyRef] } } }),
		} } } } };
	} catch (err) {
		throw new SnoStationMemError(
			"config_invalid_json",
			`Installation settings at ${configPath} are invalid.`,
		);
	}
}

export function getCurrentEmbeddingBlock(cfg: SnoStationMemConfig): Record<string, unknown> | undefined {
	return cfg.plugins?.entries?.[PLUGIN_ENTRY_KEY]?.config?.embedding;
}

/** Atomic write — temp file + rename so a crash mid-write can't truncate the config. */
export function writeSnoStationMemConfigAtomic(configPath: string, cfg: SnoStationMemConfig): void {
	const config = cfg.plugins?.entries?.[PLUGIN_ENTRY_KEY]?.config;
	const previous = existsSync(configPath) ? installationSettingsSchema.parse(JSON.parse(readFileSync(configPath, "utf8"))) : {};
	const settings = installationSettingsSchema.parse({
		...previous,
		storePath: config?.dbPath ?? getDefaultStorePath(), embedding: config?.embedding ?? {},
		extractionKeyRef: FIXED_EXTRACTION_KEY_NAME,
	});
	const tmp = `${configPath}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
	renameSync(tmp, configPath);
}

interface DeploymentHints {
	cacheDir?: string;
	baseURL?: string;
}

function deploymentHintsPath(): string {
	return path.join(getSnoStationMemDataDir(), "embedder-hints.json");
}

export function readDeploymentHints(): DeploymentHints {
	const p = deploymentHintsPath();
	if (!existsSync(p)) return {};
	try {
		return JSON.parse(readFileSync(p, "utf-8")) as DeploymentHints;
	} catch {
		return {};
	}
}

export function writeDeploymentHints(hints: DeploymentHints): void {
	const p = deploymentHintsPath();
	mkdirSync(path.dirname(p), { recursive: true });
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(hints, null, 2)}\n`);
	renameSync(tmp, p);
}

export async function confirmWipeIfNeeded(skipPrompt: boolean | undefined): Promise<boolean> {
	if (skipPrompt === true) return true;
	const confirmed = await confirmDestructiveAction(
		"Delete sno-station-mem SQLite DB files? This cannot be undone. [y/N] ",
	);
	if (!confirmed) {
		console.log("Database wipe cancelled.");
		return false;
	}
	return true;
}

export function requireWipeForce(force: boolean | undefined): void {
	if (force === true) return;
	throw new SnoStationMemError(
		"force_required",
		"Refusing to wipe without --force. Stop the gateway first, then rerun with --force to confirm no process is using the DB files.",
	);
}

/** Removes DB files. Internal — only reached after confirmation and explicit `--force`. */
export function wipeDbFilesUnchecked(dbPath: string): number {
	let removed = 0;
	for (const suffix of ["", "-shm", "-wal"]) {
		const target = `${dbPath}${suffix}`;
		if (existsSync(target)) {
			rmSync(target);
			removed += 1;
			console.log(`Removed ${target}`);
		}
	}
	return removed;
}
