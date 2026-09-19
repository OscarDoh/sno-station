#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(scriptDir, "..");
if (!existsSync(resolve(pluginDir, "dist/diagnostic-encoder.js"))) process.exit(0);

const { bootstrapObserveInstall } = await import("../bin/_observe-onboarding.js");

await bootstrapObserveInstall({
	pluginDir,
});
