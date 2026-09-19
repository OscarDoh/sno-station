import { safelyStringify } from "../errors.js";
import { writeEmergencyDiagnostic } from "@snoai/utils/log-encoder";
/** @file cli/lock.ts
 * @purpose `sno-station-core lock` subcommand handlers. Spec:
 *   `openspec/changes/add-local-aes-encryption/specs/sno-station-core-lock-cli/spec.md`.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolveConfigPaths } from "../config.js";
import { _readCanaryForRecovery } from "../db.js";
import {
	_getDekForRecovery,
	_provisionKey,
	_restoreKey,
	getDek,
} from "../dek.js";
import { KeychainUnavailableError, ManifestMissing } from "../errors.js";
import { readHiddenLineFromTty } from "../hidden-input.js";
import { liveKeychain } from "../keychain.js";
import {
	atomicWriteManifest,
	emptyManifest,
	isManifestPresent,
	isMarkerPresent,
	readManifestIfPresent,
} from "../manifest.js";
import { removePassphrase, setPassphrase } from "../passphrase.js";
import type { DbId, DekFingerprint, ManifestEntry } from "../types.js";
import { dekFingerprint } from "../wrap.js";

const ENV_PASSPHRASE_STDIN = "SNO_STATION_CORE_PASSPHRASE_STDIN";

// Pre-read every line of stdin once, then dispense them on demand. Avoids the
// "leftover bytes between two reads" pitfall when stdin closes immediately
// after the test feeds all its prompt answers.
let stdinLineQueue: string[] | undefined;

function ensureStdinLines(): void {
	if (stdinLineQueue !== undefined) return;
	if (process.stdin.isTTY) {
		stdinLineQueue = [];
		return;
	}
	let raw: string;
	try {
		raw = readFileSync(0, "utf8");
	} catch {
		raw = "";
	}
	stdinLineQueue = raw.split(/\r?\n/);
	if (
		stdinLineQueue.length > 0 &&
		stdinLineQueue[stdinLineQueue.length - 1] === ""
	) {
		stdinLineQueue.pop();
	}
}

async function readLineFromStdin(
	prompt: string,
	options: { hidden?: boolean } = {},
): Promise<string> {
	if (process.stdin.isTTY) {
		if (options.hidden) {
			return await readHiddenLineFromTty(prompt);
		}
		const rl = createInterface({
			input: process.stdin,
			output: process.stderr,
			terminal: true,
		});
		try {
			return await rl.question(prompt);
		} finally {
			rl.close();
		}
	}
	process.stderr.write(prompt);
	ensureStdinLines();
	const queue = stdinLineQueue ?? [];
	if (queue.length === 0) return "";
	return queue.shift() ?? "";
}

async function promptPassphraseTwice(): Promise<Buffer> {
	const a = await readLineFromStdin("Enter new sno-station-core passphrase: ", {
		hidden: true,
	});
	const b = await readLineFromStdin("Confirm passphrase: ", { hidden: true });
	if (a !== b) {
		throw new Error("passphrases do not match — aborting (no state changed)");
	}
	if (a.length === 0) {
		throw new Error("passphrase must not be empty");
	}
	const buf = Buffer.from(a, "utf8");
	return buf;
}

async function promptPassphraseOnce(label: string): Promise<Buffer> {
	const s = await readLineFromStdin(label, { hidden: true });
	return Buffer.from(s, "utf8");
}

function assertManifestRecoveryNotPending(): void {
	if (isMarkerPresent() && !isManifestPresent()) {
		throw new ManifestMissing();
	}
}

export async function runLockSetPassphrase(
	_flags: readonly string[],
): Promise<number> {
	assertManifestRecoveryNotPending();
	let passphrase: Buffer;
	try {
		passphrase = await promptPassphraseTwice();
	} catch (err) {
		writeEmergencyDiagnostic({ level: "error", body: `Passphrase confirmation failed: ${safelyStringify(err).slice(0, 400)}`, attributes: { error: err, exit_code: 1 }, source: {
			event_name: "crypto.passphrase_confirmation_failed",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockSetPassphrase",
			site_id: "crypto.passphrase_confirmation_failed",
		} });
		return 1;
	}
	try {
		await setPassphrase(passphrase);
	} catch (err) {
		writeEmergencyDiagnostic({ level: "error", body: `Setting passphrase failed: ${safelyStringify(err).slice(0, 400)}`, attributes: { error: err, exit_code: 1 }, source: {
			event_name: "crypto.passphrase_set_failed",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockSetPassphrase",
			site_id: "crypto.passphrase_set_failed",
		} });
		return 1;
	} finally {
		passphrase.fill(0);
	}
	process.stdout.write("sno-station-core lock: passphrase set\n");
	return 0;
}

export async function runLockRemovePassphrase(
	_flags: readonly string[],
): Promise<number> {
	assertManifestRecoveryNotPending();
	const passphrase = await promptPassphraseOnce(
		"Enter current sno-station-core passphrase: ",
	);
	try {
		await removePassphrase(passphrase);
	} catch (err) {
		writeEmergencyDiagnostic({ level: "error", body: `Removing passphrase failed: ${safelyStringify(err).slice(0, 400)}`, attributes: { error: err, exit_code: 1 }, source: {
			event_name: "crypto.passphrase_remove_failed",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockRemovePassphrase",
			site_id: "crypto.passphrase_remove_failed",
		} });
		return 1;
	} finally {
		passphrase.fill(0);
	}
	process.stdout.write("sno-station-core lock: passphrase removed\n");
	return 0;
}

export async function runLockProvisionKey(
	flags: readonly string[],
): Promise<number> {
	if (flags.length > 0) {
		writeEmergencyDiagnostic({ level: "error", body: "Key provisioning does not accept arguments", attributes: { reason_code: "invalid_arguments", exit_code: 2 }, source: {
			event_name: "crypto.provision_arguments_refused",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockProvisionKey",
			site_id: "crypto.provision_arguments_refused",
		} });
		return 2;
	}
	try {
		const keyFile = _provisionKey();
		process.stdout.write(
			`sno-station-core lock: operator key provisioned at ${keyFile}\n`,
		);
		return 0;
	} catch (err) {
		writeEmergencyDiagnostic({ level: "error", body: `Key provisioning failed: ${safelyStringify(err).slice(0, 400)}`, attributes: { error: err, exit_code: 1 }, source: {
			event_name: "crypto.provision_failed",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockProvisionKey",
			site_id: "crypto.provision_failed",
		} });
		return 1;
	}
}

export function runLockRestoreKey(
	flags: readonly string[],
): number {
	const recoveryKeyFile = flags[0];
	if (
		flags.length !== 1 ||
		!recoveryKeyFile ||
		recoveryKeyFile.startsWith("--")
	) {
		writeEmergencyDiagnostic({ level: "error", body: "Key restore requires one recovery key file", attributes: { reason_code: "invalid_arguments", exit_code: 2 }, source: {
			event_name: "crypto.restore_arguments_refused",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockRestoreKey",
			site_id: "crypto.restore_arguments_refused",
		} });
		return 2;
	}
	try {
		const keyFile = _restoreKey(recoveryKeyFile);
		process.stdout.write(
			`sno-station-core lock: operator key restored at ${keyFile}\n`,
		);
		return 0;
	} catch (err) {
		writeEmergencyDiagnostic({ level: "error", body: `Key restore failed: ${safelyStringify(err).slice(0, 400)}`, attributes: { error: err, exit_code: 1 }, source: {
			event_name: "crypto.restore_failed",
			file: "packages/sno-station-core-crypto/src/cli/lock.ts",
			function: "runLockRestoreKey",
			site_id: "crypto.restore_failed",
		} });
		return 1;
	}
}

function detectMode():
	| "keychain"
	| "passphrase"
	| "file-fallback"
	| "uninitialized" {
	const { keyFile } = resolveConfigPaths();
	let keychainHas = false;
	try {
		keychainHas = liveKeychain.get() !== null;
	} catch (err) {
		if (!(err instanceof KeychainUnavailableError)) throw err;
	}
	const fileExists = existsSync(keyFile);
	if (fileExists) {
		try {
			const parsed = JSON.parse(readFileSync(keyFile, "utf8")) as {
				mode?: string;
			};
			if (parsed.mode === "wrapped") return "passphrase";
			if (parsed.mode === "plain") return "file-fallback";
		} catch {
			// fall through
		}
	}
	if (keychainHas) return "keychain";
	if (!fileExists) return "uninitialized";
	return "file-fallback";
}

function manifestHealth(): "ok" | "missing" | "corrupted" {
	if (!isManifestPresent()) return "missing";
	try {
		readManifestIfPresent();
		return "ok";
	} catch {
		return "corrupted";
	}
}

export async function runLockStatus(
	_flags: readonly string[],
): Promise<number> {
	// Spec scenario "Other commands refuse when manifest is missing": every
	// `lock` subcommand other than `--rebuild-manifest` MUST throw
	// ManifestMissing when the manifest is absent.
	assertManifestRecoveryNotPending();
	const mode = detectMode();
	const health = manifestHealth();
	let fp = "????????";
	try {
		const dek = await getDek();
		fp = dekFingerprint(dek);
	} catch {
		// Could not unlock — leave fingerprint placeholder.
	}
	process.stdout.write(
		`mode: ${mode}\nfingerprint: ${fp}\nmanifest: ${health}\n`,
	);
	return 0;
}

function parseRebuildFlags(flags: readonly string[]): {
	paths: string[];
	resetMarker: boolean;
} {
	const paths: string[] = [];
	let resetMarker = false;
	for (const f of flags) {
		if (f === "--reset-marker") resetMarker = true;
		else if (!f.startsWith("--")) paths.push(f);
	}
	return { paths, resetMarker };
}

async function rebuildFromPaths(paths: readonly string[]): Promise<number> {
	// Recovery path: read the DEK while bypassing the marker-without-manifest
	// gate, since that is exactly the state we are recovering from.
	const dek = await _getDekForRecovery();
	const accepted: ManifestEntry[] = [];
	for (const path of paths) {
		if (!existsSync(path)) {
			writeEmergencyDiagnostic({ level: "info", body: "Manifest rebuild skipped a missing file", attributes: { file: path, reason_code: "file_missing", outcome: "skipped" }, source: {
				event_name: "crypto.rebuild_missing",
				file: "packages/sno-station-core-crypto/src/cli/lock.ts",
				function: "rebuildFromPaths",
				site_id: "crypto.rebuild_missing",
			} });
			continue;
		}
		let entry: ManifestEntry;
		try {
			const row = _readCanaryForRecovery(path, dek);
			if (!row) {
				writeEmergencyDiagnostic({ level: "warn", body: "Manifest rebuild skipped a file without a canary row", attributes: { file: path, reason_code: "canary_missing", outcome: "skipped" }, source: {
					event_name: "crypto.rebuild_canary_missing",
					file: "packages/sno-station-core-crypto/src/cli/lock.ts",
					function: "rebuildFromPaths",
					site_id: "crypto.rebuild_canary_missing",
				} });
				continue;
			}
			entry = {
				path,
				dbId: row.db_id as DbId,
				dekFingerprint: dekFingerprint(dek) as DekFingerprint,
			};
		} catch (err) {
			writeEmergencyDiagnostic({ level: "warn", body: `Manifest rebuild could not open a file: ${safelyStringify(err).slice(0, 400)}`, attributes: { file: path, error: err, outcome: "skipped" }, source: {
				event_name: "crypto.rebuild_open_failed",
				file: "packages/sno-station-core-crypto/src/cli/lock.ts",
				function: "rebuildFromPaths",
				site_id: "crypto.rebuild_open_failed",
			} });
			continue;
		}
		const answer = await readLineFromStdin(
			`add ${path} (db_id=${entry.dbId}) to manifest? [y/N] `,
		);
		if (answer.trim().toLowerCase().startsWith("y")) accepted.push(entry);
	}
	const base = emptyManifest();
	const manifest = { ...base, dbs: [...base.dbs, ...accepted] };
	await atomicWriteManifest(manifest);
	process.stdout.write(
		`sno-station-core lock: manifest rebuilt with ${accepted.length} entries\n`,
	);
	return 0;
}

async function resetMarker(): Promise<number> {
	const { markerFile, configDir } = resolveConfigPaths();
	if (!isMarkerPresent()) {
		process.stderr.write("sno-station-core lock --reset-marker: no marker present\n");
		return 1;
	}
	process.stderr.write(
		"WARNING: --reset-marker DELETES the manifest-rename-marker. Any partially-created encrypted DB on disk is FORFEIT.\nContinue? [y/N] ",
	);
	const answer = await readLineFromStdin("");
	if (!answer.trim().toLowerCase().startsWith("y")) {
		process.stderr.write("aborted\n");
		return 1;
	}
	mkdirSync(configDir, { recursive: true, mode: 0o700 });
	unlinkSync(markerFile);
	process.stdout.write("sno-station-core lock: marker cleared\n");
	return 0;
}

export async function runLockRebuildManifest(
	flags: readonly string[],
): Promise<number> {
	const { paths, resetMarker: doReset } = parseRebuildFlags(flags);
	if (doReset && paths.length === 0) {
		return resetMarker();
	}
	if (paths.length === 0) {
		throw new ManifestMissing();
	}
	return rebuildFromPaths(paths);
}

// ENV_PASSPHRASE_STDIN reserved for future tty-vs-stdin gating.
void ENV_PASSPHRASE_STDIN;
