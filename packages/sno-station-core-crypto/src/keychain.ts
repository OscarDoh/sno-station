import { Entry } from "@napi-rs/keyring";
import { resolveKeychainService } from "./config.js";
import { KeychainUnavailableError } from "./errors.js";
import { KEYCHAIN_ACCOUNT } from "./types.js";

/**
 * Wraps @napi-rs/keyring with consistent error mapping.
 *
 * On Linux without libsecret / dbus session, the underlying Rust crate
 * raises an error whose message contains "Platform secure storage failure"
 * or "No secret service" (varies by distro). We treat any such failure as
 * a `KeychainUnavailableError` so the DEK pipeline can route to the file
 * fallback per PRD §7.2.
 */

const FALLBACK_PATTERNS = [
	/no.*secret.*service/i,
	/platform.*(secure.*)?storage/i,
	/couldn.?t access (platform|secure)/i,
	/keychain.*unavailable/i,
	/dbus/i,
	/libsecret/i,
	/key[ _-]?revoked/i,
	/revoked.*key/i,
	/no backend/i,
	/quota.*exceeded/i,
];

function isFallbackTrigger(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return FALLBACK_PATTERNS.some((re) => re.test(err.message));
}

function makeEntry(): Entry {
	return new Entry(resolveKeychainService(), KEYCHAIN_ACCOUNT);
}

export interface KeychainBackend {
	get(): string | null;
	set(value: string): void;
	delete(): void;
}

export const liveKeychain: KeychainBackend = {
	get(): string | null {
		try {
			return makeEntry().getPassword();
		} catch (err) {
			if (isFallbackTrigger(err)) {
				throw new KeychainUnavailableError(
					`OS keychain unavailable: ${(err as Error).message}`,
				);
			}
			// Common case: entry not found surfaces as null on most backends; some
			// backends throw with a "no entry" / "not found" message, treat as miss.
			if (
				err instanceof Error &&
				/not.*found|no entry|no.*such/i.test(err.message)
			) {
				return null;
			}
			throw err;
		}
	},
	set(value: string): void {
		try {
			makeEntry().setPassword(value);
		} catch (err) {
			if (isFallbackTrigger(err)) {
				throw new KeychainUnavailableError(
					`OS keychain unavailable: ${(err as Error).message}`,
				);
			}
			throw err;
		}
	},
	delete(): void {
		try {
			makeEntry().deletePassword();
		} catch (err) {
			if (isFallbackTrigger(err)) {
				throw new KeychainUnavailableError(
					`OS keychain unavailable: ${(err as Error).message}`,
				);
			}
			if (
				err instanceof Error &&
				/not.*found|no entry|no.*such/i.test(err.message)
			) {
				return;
			}
			throw err;
		}
	},
};
