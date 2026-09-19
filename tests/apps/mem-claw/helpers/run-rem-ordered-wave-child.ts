import { runRemProductionOrderedWave } from "../../../../packages/sno-station-mem/src/sidecar/rem-batch-executor.ts";

const stateRoot = process.env["REM_ACC6_STATE_ROOT"];
const personaDbPath = process.env["REM_ACC6_PERSONA_DB_PATH"];
const configSource = process.env["REM_ACC6_CONFIG_SOURCE"];
const scope = process.env["REM_ACC6_SCOPE"];

if (!stateRoot || !personaDbPath || !configSource || !scope) {
	throw new Error("REM ACC-6 child input is incomplete");
}

const result = await runRemProductionOrderedWave({
	stateRoot,
	personaDbPath,
	configSource,
	scope,
	implementationVersion: "acc6-owner-decided-wave-v1",
});

process.stdout.write(`${JSON.stringify(result)}\n`);
