import { readFileSync, writeFileSync } from "node:fs";

const configPath = process.env["REM_TEST_DYNAMIC_CONFIG_PATH"];
const appliedPath = process.env["REM_TEST_DYNAMIC_CONFIG_APPLIED_PATH"];

if (!configPath || !appliedPath) {
	throw new Error("dynamic REM config preload requires config and applied paths");
}

let applied = "";
function applyCurrentConfig() {
	const current = readFileSync(configPath, "utf8");
	if (current === applied) return;
	process.env["SNO_REM_CONFIG_JSON"] = current;
	writeFileSync(appliedPath, current);
	applied = current;
}

applyCurrentConfig();
setInterval(applyCurrentConfig, 5).unref();
