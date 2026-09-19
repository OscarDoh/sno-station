#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { bindStore } from "../engine/shared/paths";
import { installationInputSchema } from "../../config/installation-settings";
import { startSidecar } from "./start";
import { ContractError } from "./error";
import { getStartupLogPath } from "./profile";

const [command, argument, ...extra] = process.argv.slice(2);
try {
	if (command === "sidecar" && argument === "start" && extra.length === 0) {
		const discovery = await startSidecar();
		process.stdout.write(`Memory sidecar ready: pid=${discovery.pid} port=${discovery.port}\n`);
	} else if (command === "bind" && argument && extra.length === 0) {
		const input = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
		if (input.length > 65536) throw new ContractError("invalid-input");
		await bindStore(argument, installationInputSchema.parse(input.trim() ? JSON.parse(input) : {}));
		process.stdout.write("Store binding written.\n");
	} else {
		process.stderr.write("Usage: sno-station-mem bind <path> | sidecar start\n");
		process.exitCode = 2;
	}
} catch (error) {
	const exists = error instanceof Error && "code" in error && error.code === "EEXIST";
	if (command === "sidecar") {
		const reason = error instanceof ContractError ? error.reason : "storage-unavailable";
		process.stderr.write(`Memory sidecar failed to start or open its encrypted store: ${reason}. See ${getStartupLogPath()}\n`);
	} else process.stderr.write(exists ? "Store binding already exists.\n" : "Store binding failed.\n");
	process.exitCode = 1;
}
