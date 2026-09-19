import { existsSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { hasExplicitKeyFile, resolveConfigPaths } from "./config.js";
import { openEncryptedDb } from "./db.js";
import { _persistPlainKeyState, _resetDekCache, getDek } from "./dek.js";
import { KeychainUnavailableError, ManifestCorrupted, WrongKeyError } from "./errors.js";
import { crashAfter, forceCanaryFailure } from "./fault-injection.js";
import { atomicReplaceSecretFile, readSecretFile, readSecretFileSync } from "./key-file.js";
import { liveKeychain } from "./keychain.js";
import { readManifestIfPresent } from "./manifest.js";
import {
	type Dek,
	type KdfParams,
	KEY_STATE_VERSION,
	type KeyStateFile,
	type KeyStateFilePlain,
	type KeyStateFileWrapped,
} from "./types.js";
import { unwrapDek, type WrappedDek, wrapDek } from "./wrap.js";

type ParsedKeyStateFile = {
	version?: unknown;
	mode?: unknown;
	dek?: unknown;
	wrappedDek?: unknown;
	wrapNonce?: unknown;
	wrapTag?: unknown;
	kdfParams?: unknown;
	salt?: unknown;
	createdAt?: unknown;
	host?: unknown;
};

type ParsedKdfParams = {
	algorithm?: unknown;
	memoryCost?: unknown;
	timeCost?: unknown;
	parallelism?: unknown;
	hashLength?: unknown;
	saltLength?: unknown;
};

function buildWrappedKeyState(wrapped: WrappedDek): KeyStateFileWrapped {
	return {
		version: KEY_STATE_VERSION,
		mode: "wrapped",
		dek: null,
		wrappedDek: wrapped.ciphertext,
		wrapNonce: wrapped.nonce,
		wrapTag: wrapped.tag,
		kdfParams: wrapped.kdfParams,
		salt: wrapped.salt,
		createdAt: new Date().toISOString(),
		host: hostname(),
	};
}

async function readKeyStateOrUndefined(): Promise<KeyStateFile | undefined> {
	const { keyFile } = resolveConfigPaths();
	if (!existsSync(keyFile)) return undefined;
	const buf = await readSecretFile(keyFile);
	return parseKeyStateFile(buf.toString("utf8"));
}

function parseKeyStateFile(content: string): KeyStateFile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (err) {
		throw new ManifestCorrupted("key state file is unparseable", {
			cause: err,
		});
	}
	if (!isRecord(parsed) || parsed.version !== KEY_STATE_VERSION) {
		throw new ManifestCorrupted("key state file has invalid version");
	}
	if (parsed.mode === "plain") {
		if (
			typeof parsed.dek !== "string" ||
			parsed.wrappedDek !== null ||
			parsed.wrapNonce !== null ||
			parsed.wrapTag !== null ||
			parsed.kdfParams !== null ||
			parsed.salt !== null ||
			typeof parsed.createdAt !== "string" ||
			typeof parsed.host !== "string"
		) {
			throw new ManifestCorrupted("plain key state file is malformed");
		}
		return {
			version: KEY_STATE_VERSION,
			mode: "plain",
			dek: parsed.dek,
			wrappedDek: null,
			wrapNonce: null,
			wrapTag: null,
			kdfParams: null,
			salt: null,
			createdAt: parsed.createdAt,
			host: parsed.host,
		};
	}
	if (parsed.mode === "wrapped") {
		const kdfParams = parsed.kdfParams;
		if (
			parsed.dek !== null ||
			typeof parsed.wrappedDek !== "string" ||
			typeof parsed.wrapNonce !== "string" ||
			typeof parsed.wrapTag !== "string" ||
			typeof parsed.salt !== "string" ||
			typeof parsed.createdAt !== "string" ||
			typeof parsed.host !== "string" ||
			!isKdfParams(kdfParams)
		) {
			throw new ManifestCorrupted("wrapped key state file is malformed");
		}
		return {
			version: KEY_STATE_VERSION,
			mode: "wrapped",
			dek: null,
			wrappedDek: parsed.wrappedDek,
			wrapNonce: parsed.wrapNonce,
			wrapTag: parsed.wrapTag,
			kdfParams,
			salt: parsed.salt,
			createdAt: parsed.createdAt,
			host: parsed.host,
		};
	}
	throw new ManifestCorrupted("key state file has invalid mode");
}

function isRecord(value: unknown): value is ParsedKeyStateFile {
	return typeof value === "object" && value !== null;
}

function isKdfParams(value: unknown): value is KdfParams {
	if (!isKdfParamsRecord(value)) return false;
	return (
		value.algorithm === "argon2id" &&
		typeof value.memoryCost === "number" &&
		typeof value.timeCost === "number" &&
		typeof value.parallelism === "number" &&
		typeof value.hashLength === "number" &&
		typeof value.saltLength === "number"
	);
}

function isKdfParamsRecord(value: unknown): value is ParsedKdfParams {
	return typeof value === "object" && value !== null;
}

function stateToWrapped(state: KeyStateFileWrapped): WrappedDek {
	return {
		version: state.version,
		salt: state.salt,
		kdfParams: state.kdfParams,
		nonce: state.wrapNonce,
		ciphertext: state.wrappedDek,
		tag: state.wrapTag,
	};
}

function canaryVerifyAgainstManifest(dek: Dek): void {
	if (forceCanaryFailure()) {
		throw new WrongKeyError("forced canary failure (test hook)");
	}
	const manifest = readManifestIfPresent();
	if (!manifest || manifest.dbs.length === 0) return;
	const entry = manifest.dbs[0];
	if (!entry) return;
	const handle = openEncryptedDb(entry.path, dek);
	handle.close();
}

async function rollbackKeyFile(keyFile: string, priorContent: string | null): Promise<void> {
	if (priorContent === null) {
		try {
			unlinkSync(keyFile);
		} catch {
			// best-effort
		}
		return;
	}
	await atomicReplaceSecretFile(keyFile, priorContent);
}

/**
 * Wraps the current DEK with a passphrase-derived KEK and atomically replaces
 * `~/.config/sno-station-core/key` with `mode: "wrapped"`. After the new state is
 * persisted, the keychain entry is deleted (two-phase commit per design D10).
 *
 * Test hooks: with SNO_STATION_CORE_TESTING=1, SNO_STATION_CORE_CRASH_AFTER ∈ {after-keygen,
 * after-wrap-write, before-keychain-delete}. Force canary failure:
 * SNO_STATION_CORE_FORCE_CANARY_FAIL=1.
 *
 * On any verify failure between the wrap-write and keychain-delete steps the
 * function rolls back the file state and re-throws the error.
 */
export async function setPassphrase(passphrase: Buffer): Promise<void> {
	const dek = await getDek();
	const { keyFile } = resolveConfigPaths();
	const priorContent = existsSync(keyFile) ? readSecretFileSync(keyFile).toString("utf8") : null;

	const wrapped = await wrapDek(dek, passphrase);
	// In-memory canary: unwrap the freshly-wrapped DEK with the same passphrase
	// before touching disk.
	const verify = await unwrapDek(wrapped, passphrase);
	if (!verify.equals(dek)) {
		verify.fill(0);
		throw new WrongKeyError("wrap/unwrap canary mismatch — refusing to upgrade");
	}
	verify.fill(0);

	crashAfter("after-keygen");

	const state = buildWrappedKeyState(wrapped);
	await atomicReplaceSecretFile(keyFile, JSON.stringify(state));

	crashAfter("after-wrap-write");

	try {
		// Read-back / parse / unwrap verification: confirm the persisted file is
		// fully durable and decrypts back to the original DEK BEFORE deleting the
		// prior keychain copy. Guards against short writes, fsync gaps, or storage
		// corruption causing irrecoverable DEK loss (codex review #6, high).
		const persisted = await readKeyStateOrUndefined();
		if (!persisted || persisted.mode !== "wrapped") {
			throw new WrongKeyError("persisted key file is not in wrapped mode after setPassphrase");
		}
		const roundTrip = await unwrapDek(stateToWrapped(persisted), passphrase);
		try {
			if (!roundTrip.equals(dek)) {
				throw new WrongKeyError(
					"persisted wrapped state does not unwrap to the original DEK — refusing to upgrade",
				);
			}
		} finally {
			roundTrip.fill(0);
		}

		// DB-level canary verify: open one registered DB with the unwrapped DEK
		// and confirm SQLCipher decrypts it correctly.
		canaryVerifyAgainstManifest(dek);

		crashAfter("before-keychain-delete");

		try {
			liveKeychain.delete();
		} catch (err) {
			if (!(err instanceof KeychainUnavailableError)) {
				throw err;
			}
		}
		_resetDekCache();
	} catch (err) {
		await rollbackKeyFile(keyFile, priorContent);
		throw err;
	}
}

/**
 * Reverts a passphrase-mode install back to keychain (or plain file-fallback)
 * mode. Two-phase commit per design D10. Test crash hooks with
 * SNO_STATION_CORE_TESTING=1: `SNO_STATION_CORE_CRASH_AFTER` ∈ {after-unwrap-before-keychain,
 * after-keychain-before-canary, after-canary-before-file-rewrite}.
 */
export async function removePassphrase(passphrase: Buffer): Promise<void> {
	const state = await readKeyStateOrUndefined();
	if (!state || state.mode !== "wrapped") {
		throw new WrongKeyError("not currently in passphrase mode");
	}
	const { keyFile } = resolveConfigPaths();
	const wrappedContent = readSecretFileSync(keyFile).toString("utf8"); // for rollback

	const dek = await unwrapDek(stateToWrapped(state), passphrase);
	try {
		crashAfter("after-unwrap-before-keychain");

		let usedKeychain = false;
		if (hasExplicitKeyFile()) {
			await _persistPlainKeyState(dek);
		} else {
			try {
				liveKeychain.set(dek.toString("hex"));
				usedKeychain = true;
			} catch (err) {
				if (!(err instanceof KeychainUnavailableError)) {
					throw err;
				}
				// File-fallback host: write a plain key state instead.
				await _persistPlainKeyState(dek);
			}
		}

		crashAfter("after-keychain-before-canary");

		try {
			canaryVerifyAgainstManifest(dek as unknown as Dek);
		} catch (err) {
			// Roll back: remove keychain (if we wrote one) and restore wrapped file.
			if (usedKeychain) {
				try {
					liveKeychain.delete();
				} catch {
					/* best-effort */
				}
			}
			await atomicReplaceSecretFile(keyFile, wrappedContent);
			throw err;
		}

		crashAfter("after-canary-before-file-rewrite");

		if (usedKeychain) {
			// Keychain is now authoritative — delete the wrapped file.
			try {
				unlinkSync(keyFile);
			} catch (err) {
				try {
					liveKeychain.delete();
				} catch {
					/* best-effort rollback */
				}
				throw err;
			}
		}
		_resetDekCache();
	} finally {
		dek.fill(0);
	}
}

export function isWrappedKeyState(s: KeyStateFile): s is KeyStateFileWrapped {
	return s.mode === "wrapped";
}

export function isPlainKeyState(s: KeyStateFile): s is KeyStateFilePlain {
	return s.mode === "plain";
}
