import { afterEach, describe, expect, it } from "vitest";
import { memClawPlugin } from "../../../../apps/mem-claw/src/install/openclaw-plugin-runtime.ts";
import { resolveSnoStationMemDbPath } from "../../../../packages/sno-station-mem/src/engine/shared/paths.ts";
import { OpenClawPluginApiHarness } from "../helpers/openclaw-harness.ts";

describe("runtime compatibility switches", () => {
	const prevDisabled = process.env.SNO_STATION_MEM_DISABLED;

	afterEach(() => {
		if (prevDisabled === undefined) {
			delete process.env.SNO_STATION_MEM_DISABLED;
		} else {
			process.env.SNO_STATION_MEM_DISABLED = prevDisabled;
		}
	});

	it("skips all plugin registration when SNO_STATION_MEM_DISABLED=true", () => {
		process.env.SNO_STATION_MEM_DISABLED = "true";
		const harness = new OpenClawPluginApiHarness({
			embedding: { dimensions: 1024 },
			ambientLearning: false,
			autoRecall: false,
			sessionStrategy: "none",
		});

		memClawPlugin.register(harness);

		expect(harness.registeredTools).toHaveLength(0);
		expect(harness.registeredCommands).toHaveLength(0);
		expect(harness.registeredServices).toHaveLength(0);
		expect(harness.registeredOnHooks).toHaveLength(0);
		expect(harness.registeredCli).toHaveLength(0);
		expect(harness.logMessages.warn).toContain(
			"sno-mem-claw disabled via SNO_STATION_MEM_DISABLED env var",
		);
	});

	it("uses the OpenClaw state dir DB path when no DB path is configured", () => {
		expect(
			resolveSnoStationMemDbPath(
				"configured.sqlite",
				(input) => `resolved:${input}`,
			),
		).toBe("resolved:configured.sqlite");
		expect(
			resolveSnoStationMemDbPath(undefined, (input) => `resolved:${input}`),
		).toMatch(/sno-station-mem\/[^/]+\/memory\.sqlite$/);
	});
});
