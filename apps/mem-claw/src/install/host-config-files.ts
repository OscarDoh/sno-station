/** @file embedder-config-files.ts
 * @purpose Reads, writes, and wipes OpenClaw embedder config state for CLI commands.
 * @boundary Filesystem/config helpers only; command registration lives elsewhere.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { connect, ContractError } from "@snoai/sno-station-mem/client";
import { getSnoStationMemStateDir } from "@snoai/sno-station-mem/internal/engine/operations/runtime-audit-log";
import { confirmDestructiveAction } from "@snoai/sno-station-mem/internal/engine/bindings/memory-cli-shared";
import { SnoStationMemError } from "@snoai/sno-station-mem/internal/engine/shared/errors";
import { APP_NAME, OPERATOR_SKIN_ID } from "../constants";

export type ResolvePath = (input: string) => string;

export interface OpenClawPluginEntryConfig {
	dbPath?: string;
	embedding?: Record<string, unknown>;
}

export interface OpenClawConfig {
	plugins?: {
		entries?: Record<string, { config?: OpenClawPluginEntryConfig } | undefined>;
	};
}

/** Returns the openclaw.json path for the active profile (env-aware via OPENCLAW_STATE_DIR). */
export function resolveOpenClawConfigPath(): string {
	return path.join(process.env.OPENCLAW_STATE_DIR ?? path.join(homedir(), ".openclaw"), "openclaw.json");
}

/** Returns the SQLite DB path for the active profile. */
export async function resolveSqliteDbPath(cfg: OpenClawConfig | undefined, resolvePath: ResolvePath): Promise<string> {
  const configured = cfg?.plugins?.entries?.[APP_NAME]?.config?.dbPath;
  const client = await connect({ skinId: OPERATOR_SKIN_ID, storePath: configured ? resolvePath(configured) : undefined });
  if (client.degraded) throw new ContractError(client.reason);
  return client.storePath;
}

export function readOpenClawConfig(configPath: string): OpenClawConfig {
	if (!existsSync(configPath)) {
		throw new SnoStationMemError(
			"config_not_found",
			`openclaw.json not found at ${configPath}; set OPENCLAW_STATE_DIR or run 'openclaw init' first.`,
		);
	}
	const raw = readFileSync(configPath, "utf-8");
	try {
		return JSON.parse(raw) as OpenClawConfig;
	} catch (err) {
		throw new SnoStationMemError(
			"config_invalid_json",
			`openclaw.json at ${configPath} is not valid JSON: ${(err as Error).message}`,
		);
	}
}

export function getCurrentEmbeddingBlock(cfg: OpenClawConfig): Record<string, unknown> | undefined {
	return cfg.plugins?.entries?.[APP_NAME]?.config?.embedding;
}

/** Atomic write — temp file + rename so a crash mid-write can't truncate the config. */
export function writeOpenClawConfigAtomic(configPath: string, cfg: OpenClawConfig): void {
	const tmp = `${configPath}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`);
	renameSync(tmp, configPath);
}

interface DeploymentHints {
	cacheDir?: string;
	baseURL?: string;
}

function deploymentHintsPath(): string {
	return path.join(getSnoStationMemStateDir(), "embedder-hints.json");
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
		"Delete mem-claw SQLite DB files? This cannot be undone. [y/N] ",
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
export function wipeDbFilesUnchecked(_dbPath: string): never {
  throw new SnoStationMemError("sidecar_required", "Store-file reset is sidecar-required; stop the sidecar and use an authorized store maintenance workflow.");
}
