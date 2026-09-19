/** @file download.ts
 * @purpose Fetch + extract + verify + smoke-test + atomic-swap the next staged
 *   version. The `current` symlink is the only commit point — every step
 *   before it is recoverable by next boot's GC.
 * @boundary POSIX filesystem only (v1). All errors propagate to the caller in
 *   `check.ts`, which silently swallows them.
 */

import { spawn } from "node:child_process";
import { downloadReleaseArchive } from "@snoai/sno-station-mem/release-download";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as tar from "tar";
import { writeEmergencyDiagnostic } from "@snoai/sno-station-mem/internal/engine/observability/early-diagnostics";
import type { Manifest } from "./check";
import { ensureLayoutDirs, getLayout, type SelfUpgradeLayout } from "./stage";
import { SELF_UPGRADE } from "../constants";

const SMOKE_ENV_KEYS = [
	"PATH",
	"Path",
	"HOME",
	"USERPROFILE",
	"SystemRoot",
	"WINDIR",
	"MEM_CLAW_DATA_DIR",
] as const;

/** Full download → verify → extract → smoke → swap pipeline. */
export async function downloadAndStage(manifest: Manifest, context?: { operation_id: string }): Promise<void> {
	const layout = ensureLayoutDirs();
	const versionDir = join(layout.versions, manifest.latest);
	if (existsSync(versionDir)) {
		await activateExistingUnlessCurrent(layout, manifest.latest, context);
		return;
	}

	const rand = randomSuffix();
	const stageName = `${manifest.latest}-${rand}`;
	const stageDir = join(layout.stage, stageName);
	const partialPath = join(layout.root, `${stageName}.tgz.partial`);

	mkdirSync(stageDir, { recursive: true });
	await downloadAndVerify(manifest, partialPath, context);
	await tar.x({ file: partialPath, cwd: stageDir, strip: 1 });
	symlinkSync(getHostNodeModulesPath(), join(stageDir, "node_modules"));

	await runSmokeTest(stageDir);

	if (existsSync(versionDir)) {
		rmSync(stageDir, { recursive: true, force: true });
		unlinkPartial(partialPath);
		await activateExistingUnlessCurrent(layout, manifest.latest, context);
		return;
	}
	renameSync(stageDir, versionDir);

	swapPrevious(layout.current, layout.previous);
	swapCurrent(layout.current, versionDir);
	writeEmergencyDiagnostic({
		level: "info", body: "Downloaded upgrade version activated", context,
		attributes: { outcome: "success", version: manifest.latest, activated: true },
		source: {
			event_name: "upgrade.download.activated",
			file: "apps/mem-claw/src/install/download.ts",
			function: "downloadAndStage",
			site_id: "upgrade.download.activated",
		},
	});

	unlinkPartial(partialPath);
}

/** Reactivate a `versions/<v>/` we already have on disk (rollback path). */
export async function activateExistingVersion(version: string, context?: { operation_id: string }): Promise<void> {
	const layout = getLayout();
	const versionDir = join(layout.versions, version);
	if (!preflightExistingVersion(versionDir)) {
		quarantineDir(versionDir);
		throw new Error(`pre-flight failed for ${versionDir}`);
	}
	await runSmokeTest(versionDir);
	swapPrevious(layout.current, layout.previous);
	swapCurrent(layout.current, versionDir);
	writeEmergencyDiagnostic({
		level: "info", body: "Existing upgrade version activated", context,
		attributes: { outcome: "success", version, activated: true },
		source: {
			event_name: "upgrade.existing.activated",
			file: "apps/mem-claw/src/install/download.ts",
			function: "activateExistingVersion",
			site_id: "upgrade.existing.activated",
		},
	});
}

async function downloadAndVerify(manifest: Manifest, partialPath: string, context?: { operation_id: string }): Promise<void> {
	if (!isAllowedTarballUrl(manifest.tarball)) {
		throw new Error("tarball URL origin is not allowed");
	}
	const actual = await downloadReleaseArchive(manifest.tarball, partialPath, SELF_UPGRADE.downloadTimeoutMs);
	const expected = manifest.integrity.replace(/^sha512-/, "");
	if (actual !== expected) {
		try {
			unlinkSync(partialPath);
		} catch (error) {
			writeEmergencyDiagnostic({
				level: "warn", body: "Rejected upgrade download cleanup failed", context, attributes: { error },
				source: {
					event_name: "upgrade.download.cleanup_failed",
					file: "apps/mem-claw/src/install/download.ts",
					function: "downloadAndVerify",
					site_id: "upgrade.download.cleanup_failed",
				},
			});
		}
		throw new Error("integrity mismatch");
	}
}

async function runSmokeTest(versionDir: string): Promise<void> {
	const stagedEntry = join(versionDir, "dist", "plugin", "openclaw-plugin-runtime.js");
	const tempDir = mkdtempSync(join(tmpdir(), "mem-claw-smoke-"));
	const tempDbPath = join(tempDir, "smoke.sqlite");
	try {
		const entryUrl = pathToFileURL(stagedEntry).href;
		const script =
			`const mod = await import(${JSON.stringify(entryUrl)});` +
			"if (typeof mod.registerRuntime !== 'function') {" +
			"  throw new Error('registerRuntime not exported');" +
			"}";
		await runChild(["--input-type=module", "-e", script]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function activateExistingUnlessCurrent(
	layout: SelfUpgradeLayout,
	version: string,
	context?: { operation_id: string },
): Promise<void> {
	const versionDir = join(layout.versions, version);
	if (linkPointsTo(layout.current, versionDir)) return;
	await activateExistingVersion(version, context);
}

function linkPointsTo(link: string, target: string): boolean {
	try {
		return resolve(dirname(link), readlinkSync(link)) === target;
	} catch {
		return false;
	}
}

function unlinkPartial(partialPath: string): void {
	try {
		unlinkSync(partialPath);
	} catch {
		// best-effort
	}
}

function runChild(args: string[]): Promise<void> {
	return new Promise((res, rej) => {
		const proc = spawn(process.execPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			timeout: SELF_UPGRADE.smokeTimeoutMs,
			env: buildSmokeEnv(),
		});
		const stderr: Buffer[] = [];
		proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		proc.on("error", rej);
		proc.on("exit", (code, signal) => {
			if (code === 0) {
				res();
				return;
			}
			rej(
				new Error(
					`smoke child exited code=${code} signal=${signal} stderr=${Buffer.concat(stderr).toString("utf8").slice(0, 500)}`,
				),
			);
		});
	});
}

function swapPrevious(currentLink: string, previousLink: string): void {
	let oldTarget: string;
	try {
		oldTarget = readlinkSync(currentLink);
	} catch {
		return;
	}
	const tmp = `${previousLink}.tmp`;
	try {
		unlinkSync(tmp);
	} catch {
		// best-effort
	}
	symlinkSync(oldTarget, tmp);
	renameSync(tmp, previousLink);
}

function swapCurrent(currentLink: string, versionDir: string): void {
	const tmp = `${currentLink}.tmp`;
	try {
		unlinkSync(tmp);
	} catch {
		// best-effort
	}
	symlinkSync(versionDir, tmp);
	renameSync(tmp, currentLink);
}

function preflightExistingVersion(versionDir: string): boolean {
	try {
		const pkg = join(versionDir, "package.json");
		const entry = join(versionDir, "dist", "plugin", "openclaw-plugin-runtime.js");
		const nm = join(versionDir, "node_modules");
		if (!existsSync(pkg) || !existsSync(entry)) return false;
		statSync(nm); // resolves through symlink; throws if broken
		return true;
	} catch (error) {
		writeEmergencyDiagnostic({
			level: "warn", body: "Staged upgrade preflight failed", attributes: { version_path: versionDir, error },
			source: {
				event_name: "upgrade.preflight.failed",
				file: "apps/mem-claw/src/install/download.ts",
				function: "preflightExistingVersion",
				site_id: "upgrade.preflight.failed",
			},
		});
		return false;
	}
}

function quarantineDir(versionDir: string): void {
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	try {
		renameSync(versionDir, `${versionDir}.bad-${ts}`);
	} catch (error) {
		writeEmergencyDiagnostic({
			level: "warn", body: "Invalid staged upgrade quarantine failed", attributes: { version_path: versionDir, error },
			source: {
				event_name: "upgrade.invalid_stage.quarantine_failed",
				file: "apps/mem-claw/src/install/download.ts",
				function: "quarantineDir",
				site_id: "upgrade.invalid_stage.quarantine_failed",
			},
		});
	}
}

function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 8);
}

/**
 * Walk up from this module's installed location to the host install's
 * `node_modules` directory. Used to symlink staged versions back at the host
 * native deps (better-sqlite3-multiple-ciphers, @snoai/sno-station-core-crypto, etc.).
 *
 * Layout assumption (host install, post-tsdown-bundle): `download.ts` is
 * inlined into the shim bundle, so `import.meta.url` resolves to
 *   <node_modules>/@snoai/mem-claw/dist/self-upgrade/entry-shim.js
 */
function getHostNodeModulesPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "../../../..");
}

function buildSmokeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const childEnv: NodeJS.ProcessEnv = {};
	for (const key of SMOKE_ENV_KEYS) {
		const value = env[key];
		if (value !== undefined) childEnv[key] = value;
	}
	return childEnv;
}

function isAllowedTarballUrl(
	tarballUrl: string,
	manifestUrl: string = process.env.MEM_CLAW_MANIFEST_URL?.trim() || SELF_UPGRADE.manifestUrl,
): boolean {
	try {
		const tarball = new URL(tarballUrl);
		if (tarball.protocol !== "https:" && tarball.protocol !== "http:") {
			return false;
		}
		if (
			tarball.protocol === "https:" &&
			(isSnoOwnedHostname(tarball.hostname) || tarball.hostname === SELF_UPGRADE.npmRegistryHostname)
		) {
			return true;
		}

		const manifest = new URL(manifestUrl);
		if (tarball.origin !== manifest.origin) return false;
		if (tarball.protocol === "https:") return true;
		return isLoopbackHostname(tarball.hostname);
	} catch {
		return false;
	}
}

function isSnoOwnedHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === "sno.ai" || normalized.endsWith(".sno.ai");
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export const __test__: {
	buildSmokeEnv: (env?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
	isAllowedTarballUrl: (tarballUrl: string, manifestUrl?: string) => boolean;
} = { buildSmokeEnv, isAllowedTarballUrl };
