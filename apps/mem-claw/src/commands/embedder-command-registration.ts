/** @file embedder-command-registration.ts
 * @purpose Registers sno-mem-config embedder show, set, and wipe-db commands.
 * @boundary Embedder command wiring only; config filesystem helpers live in embedder-config-files.ts.
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import {
	confirmWipeIfNeeded,
	getCurrentEmbeddingBlock,
	type ResolvePath,
	readDeploymentHints,
	readOpenClawConfig,
	requireWipeForce,
	resolveOpenClawConfigPath,
	resolveSqliteDbPath,
	wipeDbFilesUnchecked,
	writeDeploymentHints,
	writeOpenClawConfigAtomic,
} from "../install/host-config-files";
import { APP_NAME, OPERATOR_SKIN_ID } from "../constants";
import {
	DEFAULT_PRESET,
	EMBEDDER_PRESETS,
	type EmbedderPresetName,
	isPresetName,
	listPresets,
} from "./embedding-provider-presets";
import { SnoStationMemError } from "@snoai/sno-station-mem/internal/engine/shared/errors";
import { connect, ContractError } from "@snoai/sno-station-mem/client";

async function readSidecarDimension(storePath: string): Promise<number | undefined> {
  const client = await connect({ skinId: OPERATOR_SKIN_ID, storePath });
  if (client.degraded) throw new ContractError(client.reason);
  const result = await client.inspect({ op: "storage" }, { principal: client.principal, project: "global", session: "embedding-config", host: { systemCaller: true } });
  if (result.degraded) throw new ContractError(result.reason);
  if (result.result.op !== "storage") throw new ContractError("engine-failed");
  return result.result.dimension ?? undefined;
}
function sidecarRequired(): never {
  throw new SnoStationMemError("sidecar_required", "Offline store migration is sidecar-required; this host command cannot open or reset the store.");
}

export function registerEmbedderCommands(memory: Command, resolvePath: ResolvePath): void {
	const embedder = memory
		.command("embedder")
		.description("Inspect or switch the embedding model preset");

	embedder
		.command("show")
		.description("Print the current embedding configuration")
		.action(async () => {
			const configPath = resolveOpenClawConfigPath();
			const cfg = readOpenClawConfig(configPath);
			const current = getCurrentEmbeddingBlock(cfg);
			console.log(
				JSON.stringify(
					{
						configPath,
						embedding: current ?? null,
						availablePresets: listPresets(),
						defaultPreset: DEFAULT_PRESET,
					},
					null,
					2,
				),
			);
		});

	embedder
		.command("set [preset]")
		.description(
			`Rewrite plugins.entries["${APP_NAME}"].config.embedding with a named preset (default: ${DEFAULT_PRESET}).`,
		)
		.option(
			"--cache-dir <path>",
			"Override cacheDir for the new embedding block (only meaningful for local-onnx presets). Persisted to embedder-hints.json so future switches recover it.",
		)
		.option(
			"--wipe",
			"After rewriting, also wipe the SQLite DB files. Use this when the preset changes the vector dim — the vec table is locked at first init, so a non-empty DB at the old dim will refuse to register.",
		)
		.option("--yes", "Bypass the confirmation prompt for --wipe")
		.option(
			"--force",
			"Required with --wipe; confirms the gateway is stopped before deleting DB files.",
		)
		.action(
			async (
				presetArg: string | undefined,
				options: {
					cacheDir?: string;
					wipe?: boolean;
					yes?: boolean;
					force?: boolean;
				},
			) => {
				const presetName = (presetArg ?? DEFAULT_PRESET) as string;
				if (!isPresetName(presetName)) {
					throw new SnoStationMemError(
						"invalid_preset",
						`Unknown embedder preset "${presetName}". Available: ${listPresets().join(", ")}`,
					);
				}
				const preset = EMBEDDER_PRESETS[presetName as EmbedderPresetName];

				const configPath = resolveOpenClawConfigPath();
				const cfg = readOpenClawConfig(configPath);

				const oldBlock = getCurrentEmbeddingBlock(cfg);
				// Read the dim that's actually locked on disk — the config block
				// may be missing or stale (manual edit, fresh init, partial recovery)
				// so trusting it alone can leave a 1024-d DB paired with a 3072-d
				// preset that refuses to register on next boot. The DB DDL is the
				// only authoritative source.
				const dbPath = await resolveSqliteDbPath(cfg, resolvePath);
				const configDim = typeof oldBlock?.dimensions === "number" ? oldBlock.dimensions : null;
				const newDim = preset.dimensions;

				// Codex 2026-04-30 (batch-A H1): validate every wipe precondition
				// BEFORE mutating openclaw.json. The earlier order — write config,
				// then ask for confirmation, then `requireWipeForce` — could leave
				// a non-empty old-dim DB paired with a new-dim config block when
				// `--wipe` was passed without `--force`, which then refuses to
				// register on next gateway boot. Confirmation prompt and force
				// guard now run first; if either fails we abort before any disk
				// state is touched.
				if (options.wipe) sidecarRequired();
				if (options.wipe) {
					requireWipeForce(options.force);
					if (!(await confirmWipeIfNeeded(options.yes))) return;
				}
				const persistedDim = options.wipe ? undefined : await readSidecarDimension(dbPath);
				const oldDim = persistedDim ?? configDim;

				// Preserve the deployment-specific model cache directory.
				const hints = readDeploymentHints();
				if (oldBlock) {
					if (typeof oldBlock.cacheDir === "string") hints.cacheDir = oldBlock.cacheDir;
				}
				if (options.cacheDir) {
					hints.cacheDir = options.cacheDir;
				}
				writeDeploymentHints(hints);
				const carry: Record<string, unknown> = {};
				if (typeof hints.cacheDir === "string") {
					carry.cacheDir = hints.cacheDir;
				}
				cfg.plugins ??= {};
				cfg.plugins.entries ??= {};
				const entry = cfg.plugins.entries[APP_NAME] ?? {};
				entry.config ??= {};
				entry.config.embedding = { ...carry, ...preset };
				cfg.plugins.entries[APP_NAME] = entry;
				writeOpenClawConfigAtomic(configPath, cfg);

				const finalEmbedding = entry.config.embedding as Record<string, unknown>;
				console.log(`Set mem-claw embedder preset → ${presetName}`);
				console.log(JSON.stringify(finalEmbedding, null, 2));

				const dimChanged = oldDim !== undefined && oldDim !== newDim;
				if (dimChanged) {
					console.log("");
					const dimSource = persistedDim !== undefined ? "DB on disk" : "previous config";
					console.log(
						`! Vector dimension changed (${oldDim} → ${newDim}, source: ${dimSource}). The vec table is locked at first init,`,
					);
					console.log("  so the existing DB will refuse to register at the new dim.");
				} else if (oldDim === undefined) {
					console.log(
						"\nNo prior dim found in config or DB — gateway can boot fresh on next restart.",
					);
				} else {
					console.log("\nDim unchanged. Restart the gateway to pick up the new model.");
				}

				if (options.wipe) {
					// Preconditions (--force, confirmation prompt) already validated
					// above before the config write. Reaching here means the user
					// authorized the wipe; just execute the file removal.
					console.log("");
					const wiped = wipeDbFilesUnchecked(dbPath);
					if (wiped === 0) {
						console.log("(--wipe set, but no DB files were present.)");
					} else {
						console.log(
							`(--wipe set: removed ${wiped} DB file(s). Restart the gateway and re-import.)`,
						);
					}
				} else if (dimChanged) {
					console.log(
						"  Run 'openclaw sno-mem-config embedder wipe-db --confirm --force' (or pass --wipe --yes --force to 'set')",
					);
					console.log("  before restarting the gateway, then re-import / re-capture memories.");
				}
			},
		);

	embedder
		.command("wipe-db")
		.description(
			"Delete the mem-claw SQLite database files. Required after switching presets that change dim.",
		)
		.option("--confirm", "Required — guards against accidental data loss")
		.option("--force", "Required — confirms the gateway is stopped before deleting DB files.")
		.action(async (options: { confirm?: boolean; force?: boolean }) => {
			if (!options.confirm) {
				throw new SnoStationMemError(
					"confirmation_required",
					"Refusing to wipe without --confirm. This permanently deletes the SQLite database file.",
				);
			}
			requireWipeForce(options.force);
			const configPath = resolveOpenClawConfigPath();
			const cfg = existsSync(configPath) ? readOpenClawConfig(configPath) : undefined;
			const dbPath = await resolveSqliteDbPath(cfg, resolvePath);
			const removed = wipeDbFilesUnchecked(dbPath);
			if (removed === 0) {
				console.log(`Nothing to remove — no DB files at ${dbPath}*`);
			} else {
				console.log(
					`\nWiped ${removed} file(s). Restart the gateway; the vec table will be recreated at the configured dim on next boot.`,
				);
			}
		});

	memory
		.command("memory-kinds-migrate")
		.description("Run the one-time offline memory-kinds foundation cutover migrator.")
		.action(async () => {
			const configPath = resolveOpenClawConfigPath();
			const cfg = existsSync(configPath) ? readOpenClawConfig(configPath) : undefined;
			const dbPath = await resolveSqliteDbPath(cfg, resolvePath);
			sidecarRequired();
		});

	memory
		.command("memory-kinds-reset-db")
		.description(
			"Delete the mem-claw SQLite database files after an explicit memory-kinds hard-cut reset decision.",
		)
		.option("--scope <scope>", "Store scope being reset for operator audit logs", "all")
		.option("--confirm", "Required — guards against accidental data loss")
		.option("--force", "Required — confirms the gateway is stopped before deleting DB files.")
		.action(async (options: { scope?: string; confirm?: boolean; force?: boolean }) => {
			if (!options.confirm) {
				throw new SnoStationMemError(
					"confirmation_required",
					"Refusing to reset without --confirm. This permanently deletes the SQLite database file.",
				);
			}
			requireWipeForce(options.force);
			const configPath = resolveOpenClawConfigPath();
			const cfg = existsSync(configPath) ? readOpenClawConfig(configPath) : undefined;
			const dbPath = await resolveSqliteDbPath(cfg, resolvePath);
			sidecarRequired();
		});
}
