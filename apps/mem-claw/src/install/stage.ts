/** @file stage.ts
 * @purpose Resolve the active plugin version on the filesystem and provide
 *   boot-time self-healing for the self-upgrade stage tree.
 * @boundary POSIX filesystem only (v1). All errors are swallowed; this module
 *   never throws into the gateway boot path.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gt, valid } from "semver";
import { writeEmergencyDiagnostic } from "@snoai/sno-station-mem/internal/engine/observability/early-diagnostics";
import { getSelfUpgradeStageRoot } from "@snoai/sno-station-mem/installation-paths";
import { SELF_UPGRADE } from "../constants";

export interface SelfUpgradeLayout {
	root: string;
	current: string;
	previous: string;
	versions: string;
	stage: string;
}

/** Absolute paths for the per-install stage tree. */
export function getLayout(): SelfUpgradeLayout {
	const root = getSelfUpgradeStageRoot();
	return {
		root,
		current: join(root, "current"),
		previous: join(root, "previous"),
		versions: join(root, "versions"),
		stage: join(root, "stage"),
	};
}

/**
 * @deprecated Use `getSelfUpgradeStageRoot()` from `@/storage/data-paths`
 *   directly. Kept for one release for back-compat with consumers that
 *   imported this helper.
 */
export function getDataDir(): string {
	return dirname(getSelfUpgradeStageRoot());
}

/**
 * Returns the absolute path to the staged entry the shim should `import()`,
 * or `undefined` when the shim should fall back to its statically-bundled
 * runtime. `undefined` covers three normal cases:
 *   1. Fresh install — no `current` symlink yet.
 *   2. Staged dir present but missing its `dist/plugin/openclaw-plugin-runtime.js`.
 *   3. Host install was upgraded out from under us — stage tree gets wiped.
 *
 * Returning `undefined` lets the shim skip the try/catch + quarantine noise
 * that fires when there is no staged version to load in the first place.
 *
 * `shimUrl` is unused today but is part of the public signature so that
 * future variants (e.g. resolving a sibling bundled file) stay backward-
 * compatible.
 */
export function resolveActiveVersion(shimUrl: string): string | undefined {
	void shimUrl;
	const layout = getLayout();
	let target: string;
	try {
		target = readlinkSync(layout.current);
	} catch (error) {
		if (!isMissingEntry(error)) writeEmergencyDiagnostic({
			level: "warn", body: "Active staged version could not be resolved", attributes: { error },
			source: {
				event_name: "upgrade.active_version.read_failed",
				file: "apps/mem-claw/src/install/stage.ts",
				function: "resolveActiveVersion",
				site_id: "upgrade.active_version.read_failed",
			},
		});
		return undefined;
	}
	const stagedDir = resolve(dirname(layout.current), target);
	const stagedEntry = join(stagedDir, "dist", "plugin", "openclaw-plugin-runtime.js");
	if (!existsSync(stagedEntry)) return undefined;
	if (hostInstallNewerThanStage(stagedDir)) {
		try {
			rmSync(layout.root, { recursive: true, force: true });
		} catch (error) {
			writeEmergencyDiagnostic({
				level: "warn", body: "Obsolete staged version cleanup failed", attributes: { error },
				source: {
					event_name: "upgrade.obsolete_stage.cleanup_failed",
					file: "apps/mem-claw/src/install/stage.ts",
					function: "resolveActiveVersion",
					site_id: "upgrade.obsolete_stage.cleanup_failed",
				},
			});
		}
		return undefined;
	}
	return stagedEntry;
}

/** Rename failed staged version to `.bad-<ts>` and unlink `current`. */
export function quarantineActiveVersion(err: unknown): void {
	const layout = getLayout();
	let target: string;
	try {
		target = readlinkSync(layout.current);
	} catch (error) {
		if (!isMissingEntry(error)) writeEmergencyDiagnostic({
			level: "warn", body: "Failed staged version could not be found for quarantine", attributes: { error },
			source: {
				event_name: "upgrade.quarantine.read_failed",
				file: "apps/mem-claw/src/install/stage.ts",
				function: "quarantineActiveVersion",
				site_id: "upgrade.quarantine.read_failed",
			},
		});
		return;
	}
	const stagedDir = resolve(dirname(layout.current), target);
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	let renamed = false;
	let linkRemoved = false;
	let renameError: unknown;
	let unlinkError: unknown;
	try {
		renameSync(stagedDir, `${stagedDir}.bad-${ts}`);
		renamed = true;
	} catch (error) {
		renameError = error;
	}
	try {
		unlinkSync(layout.current);
		linkRemoved = true;
	} catch (error) {
		unlinkError = error;
	}
	writeEmergencyDiagnostic({
		level: "warn", body: "Staged version quarantine finished",
		attributes: { outcome: renamed && linkRemoved ? "success" : "partial", renamed, link_removed: linkRemoved, load_error: err, rename_error: renameError, unlink_error: unlinkError },
		source: {
			event_name: "upgrade.quarantine.completed",
			file: "apps/mem-claw/src/install/stage.ts",
			function: "quarantineActiveVersion",
			site_id: "upgrade.quarantine.completed",
		},
	});
}

/**
 * Sweep orphaned scratch from prior interrupted runs. Runs as the first step
 * of `scheduleBackgroundUpgrade()`. Idempotent. Cheap. Always safe.
 */
export function runBootGc(): void {
	const layout = getLayout();
	if (!existsSync(layout.root)) return;
	const keep = new Set<string>();
	for (const link of [layout.current, layout.previous]) {
		try {
			const target = readlinkSync(link);
			keep.add(resolve(dirname(link), target));
		} catch (error) {
			if (!isMissingEntry(error)) writeEmergencyDiagnostic({
				level: "warn", body: "Upgrade cleanup could not read a retained version link", attributes: { error },
				source: {
					event_name: "upgrade.gc.link_read_failed",
					file: "apps/mem-claw/src/install/stage.ts",
					function: "runBootGc",
					site_id: "upgrade.gc.link_read_failed",
				},
			});
		}
	}
	gcVersions(layout.versions, keep);
	gcStaleEntries(layout.stage, SELF_UPGRADE.stageRetentionMs);
	gcStalePartials(layout.root, SELF_UPGRADE.stageRetentionMs);
}

function gcVersions(versionsDir: string, keep: Set<string>): void {
	if (!existsSync(versionsDir)) return;
	for (const entry of safeReaddir(versionsDir)) {
		const abs = join(versionsDir, entry);
		if (keep.has(abs)) continue;
		safeRm(abs);
	}
}

function gcStaleEntries(stageDir: string, maxAgeMs: number): void {
	if (!existsSync(stageDir)) return;
	const cutoff = Date.now() - maxAgeMs;
	for (const entry of safeReaddir(stageDir)) {
		const abs = join(stageDir, entry);
		try {
			if (statSync(abs).mtimeMs < cutoff) safeRm(abs);
		} catch {
			safeRm(abs);
		}
	}
}

function gcStalePartials(root: string, maxAgeMs: number): void {
	const cutoff = Date.now() - maxAgeMs;
	for (const entry of safeReaddir(root)) {
		if (!entry.endsWith(".partial")) continue;
		const abs = join(root, entry);
		try {
			if (statSync(abs).mtimeMs < cutoff) unlinkSync(abs);
		} catch {
			try {
				unlinkSync(abs);
			} catch {
				// best-effort
			}
		}
	}
}

function safeReaddir(path: string): string[] {
	try {
		return readdirSync(path);
	} catch (error) {
		if (!isMissingEntry(error)) writeEmergencyDiagnostic({
			level: "warn", body: "Upgrade cleanup directory could not be read", attributes: { directory_path: path, error },
			source: {
				event_name: "upgrade.gc.directory_read_failed",
				file: "apps/mem-claw/src/install/stage.ts",
				function: "safeReaddir",
				site_id: "upgrade.gc.directory_read_failed",
			},
		});
		return [];
	}
}

function safeRm(path: string): void {
	try {
		rmSync(path, { recursive: true, force: true });
	} catch (error) {
		if (!isMissingEntry(error)) writeEmergencyDiagnostic({
			level: "warn", body: "Upgrade cleanup entry could not be removed", attributes: { entry_path: path, error },
			source: {
				event_name: "upgrade.gc.remove_failed",
				file: "apps/mem-claw/src/install/stage.ts",
				function: "safeRm",
				site_id: "upgrade.gc.remove_failed",
			},
		});
	}
}

function isMissingEntry(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** The installed plugin's own version: the release manifest is pinned to @snoai/mem-claw, not the engine package. */
export function readMemClawPackageVersion(): string | undefined {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < 10; depth += 1) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) {
			try {
				const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown; version?: unknown };
				if (parsed.name === "@snoai/mem-claw" && typeof parsed.version === "string" && parsed.version.trim()) return parsed.version.trim();
			} catch { return undefined; }
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

function hostInstallNewerThanStage(stagedDir: string): boolean {
	const hostVersion = readMemClawPackageVersion();
	const stagedVersion = readStagedVersion(stagedDir);
	if (!hostVersion || !stagedVersion) return false;
	const normalizedHost = valid(hostVersion);
	const normalizedStage = valid(stagedVersion);
	if (!normalizedHost || !normalizedStage) return false;
	return gt(normalizedHost, normalizedStage);
}

function readStagedVersion(stagedDir: string): string | undefined {
	try {
		const pkgPath = join(stagedDir, "package.json");
		if (!existsSync(pkgPath)) return undefined;
		const raw = readFileSync(pkgPath, "utf8");
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version.trim() : undefined;
	} catch {
		return undefined;
	}
}

/** Ensure the layout dirs exist (non-destructive). Used by downloader. */
export function ensureLayoutDirs(): SelfUpgradeLayout {
	const layout = getLayout();
	mkdirSync(layout.versions, { recursive: true });
	mkdirSync(layout.stage, { recursive: true });
	return layout;
}
