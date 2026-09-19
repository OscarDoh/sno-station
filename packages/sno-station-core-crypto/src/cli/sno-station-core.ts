#!/usr/bin/env node
import { writeEmergencyDiagnostic } from "@snoai/utils/log-encoder";
import { configureLogger } from "@snoai/utils/logger";
import catalog from "@snoai/utils/log-site-catalog.json" with { type: "json" };
import { readFileSync } from "node:fs";
/** @file cli/sno-station-core.ts
 * @purpose `sno-station-core` CLI binary entry — dispatches to `lock` / `export` /
 *   `import` subcommands. Spec:
 *   `openspec/changes/add-local-aes-encryption/specs/sno-station-core-lock-cli/spec.md`.
 */

import { exportEncrypted } from "../export.js";
import { importEncrypted } from "../import.js";
import { runMainIfDirect } from "./main.js";
import {
	runLockProvisionKey,
	runLockRebuildManifest,
	runLockRemovePassphrase,
	runLockRestoreKey,
	runLockSetPassphrase,
	runLockStatus,
} from "./lock.js";

const HELP_TEXT = `sno-station-core — local AES-256 encryption tool for SNO Station Core plugins

USAGE:
  sno-station-core <command> [options]

COMMANDS:
  lock --provision-key             Explicitly create the one durable operator key
  lock --restore-key <path>        Restore a missing primary from an operator-held copy
  lock --set-passphrase            Upgrade DEK to passphrase-protected mode
  lock --remove-passphrase         Revert to keychain or file-fallback mode
  lock --status                    Print current DEK protection mode + fingerprint
  lock --rebuild-manifest [paths]  Recreate manifest from canary rows (interactive)
  lock --rebuild-manifest --reset-marker
                                   Recover from orphan-marker crash (destructive)
  export <out.sno-station-core>               Encrypted bundle of all registered DBs
  import <in.sno-station-core>                Decrypt a .sno-station-core bundle into the local DB dir

  --help                           Print this help and exit 0
`;

function parseArgs(argv: string[]): {
	command: string | undefined;
	rest: string[];
} {
	const args = argv.slice(2);
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		return { command: "--help", rest: [] };
	}
	const [first, ...rest] = args;
	return { command: first, rest };
}

function isLockSubcommand(rest: readonly string[]): {
	subcommand:
		| "provision-key"
		| "restore-key"
		| "set-passphrase"
		| "remove-passphrase"
		| "status"
		| "rebuild-manifest"
		| undefined;
	flags: readonly string[];
} {
	const known: Record<
		string,
		| "provision-key"
		| "restore-key"
		| "set-passphrase"
		| "remove-passphrase"
		| "status"
		| "rebuild-manifest"
	> = {
		"--provision-key": "provision-key",
		"--restore-key": "restore-key",
		"--set-passphrase": "set-passphrase",
		"--remove-passphrase": "remove-passphrase",
		"--status": "status",
		"--rebuild-manifest": "rebuild-manifest",
	};
	const idx = rest.findIndex((a) => a in known);
	if (idx === -1) return { subcommand: undefined, flags: rest };
	const flag = rest[idx] as keyof typeof known;
	const flags = [...rest.slice(0, idx), ...rest.slice(idx + 1)];
	return { subcommand: known[flag], flags };
}

export async function runCli(argv: string[]): Promise<number> {
	const packageMetadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
	configureLogger({ app: "sno-station-core", serviceVersion: packageMetadata.version, buildId: catalog.build_id, catalog });
	const { command, rest } = parseArgs(argv);
	if (command === "--help") {
		process.stdout.write(HELP_TEXT);
		return 0;
	}
	if (command === "lock") {
		const { subcommand, flags } = isLockSubcommand(rest);
		if (subcommand === "provision-key")
			return runLockProvisionKey(flags);
		if (subcommand === "restore-key")
			return runLockRestoreKey(flags);
		if (subcommand === "set-passphrase") return runLockSetPassphrase(flags);
		if (subcommand === "remove-passphrase")
			return runLockRemovePassphrase(flags);
		if (subcommand === "status") return runLockStatus(flags);
		if (subcommand === "rebuild-manifest") return runLockRebuildManifest(flags);
		writeEmergencyDiagnostic({ level: "error", body: "Lock command requires a subcommand. Run sno-station-core --help.", attributes: { reason_code: "missing_subcommand", exit_code: 2 }, source: {
			event_name: "crypto.lock_missing_subcommand",
			file: "packages/sno-station-core-crypto/src/cli/sno-station-core.ts",
			function: "runCli",
			site_id: "crypto.lock_missing_subcommand",
		} });
		return 2;
	}
	if (command === "export") {
		const target = rest[0];
		if (!target) {
			writeEmergencyDiagnostic({ level: "error", body: "Export requires an output file", attributes: { reason_code: "missing_output_path", exit_code: 2 }, source: {
				event_name: "crypto.export_missing_path",
				file: "packages/sno-station-core-crypto/src/cli/sno-station-core.ts",
				function: "runCli",
				site_id: "crypto.export_missing_path",
			} });
			return 2;
		}
		await exportEncrypted(target);
		return 0;
	}
	if (command === "import") {
		const source = rest[0];
		if (!source) {
			writeEmergencyDiagnostic({ level: "error", body: "Import requires an input file", attributes: { reason_code: "missing_input_path", exit_code: 2 }, source: {
				event_name: "crypto.import_missing_path",
				file: "packages/sno-station-core-crypto/src/cli/sno-station-core.ts",
				function: "runCli",
				site_id: "crypto.import_missing_path",
			} });
			return 2;
		}
		await importEncrypted(source);
		return 0;
	}
	writeEmergencyDiagnostic({ level: "error", body: "Unknown crypto command. Run sno-station-core --help.", attributes: { command_value: command, reason_code: "unknown_command", exit_code: 2 }, source: {
		event_name: "crypto.unknown_command",
		file: "packages/sno-station-core-crypto/src/cli/sno-station-core.ts",
		function: "runCli",
		site_id: "crypto.unknown_command",
	} });
	return 2;
}

runMainIfDirect((import.meta as { url?: string }).url, runCli);
