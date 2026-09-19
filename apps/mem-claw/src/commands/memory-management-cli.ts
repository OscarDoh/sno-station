/** @file memory-management-cli.ts
 * @purpose Exposes memory and embedder-management CLI registration entry points.
 * @boundary Public CLI facade only; command bodies live in focused modules.
 * @see memory-command-registration.ts, embedder-command-registration.ts, backup.ts, store.ts, errors.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeLogger } from "@snoai/utils/logger";
import type { Command } from "commander";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";
import { registerEmbedderCommands } from "./embedder-command-registration";
import type { CliContext } from "./memory-command-registration";
import { registerCommands } from "./memory-command-registration";
import { createMemoryConnection } from "../install/memory-connection";
import type { PluginConfig } from "@snoai/sno-station-mem/internal/config/plugin-config-schema";
import { getStateDir } from "@snoai/sno-station-mem/internal/contract/profile";

export type { CliContext } from "./memory-command-registration";

/**
 * Registers memory CLI with host schemas and command registration policy checks kept
 * together.
 */
export function registerMemoryCli(api: OpenClawPluginApi, ctx: CliContext, config: PluginConfig): void {
	api.registerCli(
		({ program }) => {
			// The host supplies .openclaw[-profile]; installed Sno bindings use its sibling .sno[-profile].
			const stateDir = resolveStateDir();
			const profileDir = path.join(path.dirname(stateDir), path.basename(stateDir).replace(/^\.openclaw(?=-|$)/, ".sno"));
			registerCommands(program, { ...ctx, connection: createMemoryConnection(api, config, "mem-claw-cli") })
				.hook("preAction", () => {
					// CLI metadata loading requires an unchanged environment. Set this only when executing.
					// Explicit overrides win, and sidecar children inherit the same resolved directory.
					process.env.SNO_PROFILE_DIR = getStateDir(profileDir);
				});
		},
		{ commands: ["sno-mem"] },
	);
}

/**
 * Registers the embedder-management CLI under `sno-mem-config`. Intentionally separate
 * from the runtime memory CLI: it must remain available even when the runtime fails
 * to register (e.g. dim mismatch after a preset switch), so the user can still
 * inspect, change, or wipe the DB to recover. No runtime dependencies — only reads
 * and writes openclaw.json, and removes files in the state dir.
 */
export function registerEmbedderManagementCli(
	api: Pick<OpenClawPluginApi, "registerCli" | "resolvePath">,
): void {
	api.registerCli(
		({ program }) => {
			const root = program
				.command("sno-mem-config")
				.description("mem-claw configuration management (no runtime dependencies)");
			registerEmbedderCommands(root, (input) => api.resolvePath(input));
			registerEvalSnapshotCommand(root);
		},
		{ commands: ["sno-mem-config"] },
	);
}

/**
 * Registers `sno-mem-config eval-snapshot --dir <path>`. Writes
 * `config-snapshot.json` with the active retrieval-pipeline tunables and
 * prints the SHA-256 hash. Used by eval harness scripts (e.g.
 * `phase1-3run.sh`) to stamp the run dir with the config fingerprint
 * before launching the QA loop.
 */
function registerEvalSnapshotCommand(root: Command): void {
	root
		.command("eval-snapshot")
		.description("Write config-snapshot.json (PRD §11.2.2) for an eval run dir")
		.requiredOption("--dir <path>", "Run directory to write config-snapshot.json into")
		.action(async (options: { dir: string }) => {
			try {
				const { writeConfigSnapshot } = await import("@snoai/sno-station-mem/internal/engine/eval/trace");
				const hash = writeConfigSnapshot(options.dir);
				console.log(`Wrote config-snapshot.json to ${options.dir} (sha256=${hash})`);
			} finally {
				try { await closeLogger(); }
				catch { /* Diagnostic cleanup must not replace the command result or original error. */ }
			}
		});
}

/** Persists jsonl through the single slash-command registration write path. */
export function writeJsonl(filePath: string, lines: string[]): void {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${lines.join("\n")}\n`);
}
