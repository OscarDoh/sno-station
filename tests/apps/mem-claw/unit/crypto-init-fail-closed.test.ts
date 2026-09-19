/** @file crypto-init-fail-closed.test.ts
 * @purpose Ensures crypto init errors disable the plugin instead of crashing register().
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_resetDekCache,
	KEY_FILE_ENV,
	resolveConfigPaths,
} from "@snoai/sno-station-core-crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memClawPlugin } from "../../../../apps/mem-claw/src/install/openclaw-plugin-runtime.ts";
import { _resetSqliteRuntimeForTest } from "../../../../packages/sno-station-mem/src/store/sqlite-runtime.ts";
import { OpenClawPluginApiHarness } from "../helpers/openclaw-harness.ts";

const priorEnv = new Map<string, string | undefined>();
let tempDir: string;

function setEnv(name: string, value: string): void {
	if (!priorEnv.has(name)) priorEnv.set(name, process.env[name]);
	process.env[name] = value;
}

function restoreEnv(): void {
	for (const [name, value] of priorEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	priorEnv.clear();
}

beforeEach(() => {
	const operatorKeyFile = resolveConfigPaths().keyFile;
	tempDir = mkdtempSync(join(tmpdir(), "mem-claw-crypto-init-"));
	setEnv(KEY_FILE_ENV, operatorKeyFile);
	setEnv("XDG_CONFIG_HOME", tempDir);
	setEnv("SNO_STATION_CORE_KEYCHAIN_SERVICE", `ai.sno.sno-station-core.test-${Date.now()}`);
	_resetDekCache();
	_resetSqliteRuntimeForTest();
});

afterEach(() => {
	_resetDekCache();
	_resetSqliteRuntimeForTest();
	restoreEnv();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("plugin crypto init", () => {
	it("rejects service startup when the memory connection cannot become ready", async () => {
		setEnv("SNO_PROFILE_DIR", tempDir);
		mkdirSync(join(tempDir, "station"), { recursive: true });
		writeFileSync(join(tempDir, "station", "sidecar.json"), "{not-json");
		const harness = new OpenClawPluginApiHarness({
			mode: "local-first",
			embedding: { dimensions: 1024 },
		});

		memClawPlugin.register(harness);
		try {
			await expect(harness.startServices()).rejects.toThrow("sidecar-unreachable");
		} finally {
			await harness.stopServices();
		}
	});

	it("logs and returns when manifest recovery is required", () => {
		const { configDir, markerFile } = resolveConfigPaths();
		mkdirSync(configDir, { recursive: true });
		writeFileSync(markerFile, "");

		const harness = new OpenClawPluginApiHarness({
			dbPath: join(tempDir, "mem-claw.sqlite"),
			embedding: { dimensions: 1024 },
		});

		expect(() => memClawPlugin.register(harness)).not.toThrow();
		expect(harness.logMessages.error.join("\n")).toMatch(/crypto init failed/i);
		expect(harness.registeredServices).toHaveLength(0);
	});
});
