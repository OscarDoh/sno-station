import { safelyStringify } from "../errors.js";
import { writeEmergencyDiagnostic } from "@snoai/utils/log-encoder";
import { closeLogger } from "@snoai/utils/logger";
type CliRunner = (argv: string[]) => Promise<number>;

export function runMainIfDirect(meta: string | undefined, runCli: CliRunner): void {
	if (!meta) return;
	const argv1 = process.argv[1];
	if (!argv1) return;
	const fileFromUrl = meta.startsWith("file://") ? meta.slice("file://".length) : meta;
	if (fileFromUrl !== argv1 && !meta.endsWith(argv1)) return;
	runCli(process.argv).then(
		async (code) => { await closeLogger(); process.exit(code); },
		async (err: unknown) => {
			writeEmergencyDiagnostic({ level: "error", body: `Crypto command failed: ${safelyStringify(err).slice(0, 400)}`, attributes: { error: err, exit_code: 1 }, source: {
				event_name: "crypto.command_failed",
				file: "packages/sno-station-core-crypto/src/cli/main.ts",
				function: "runMainIfDirect",
				site_id: "crypto.command_failed",
			} });
			await closeLogger();
			process.exit(1);
		},
	);
}
