import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installedRegistration } from "../../../apps/mem-claude/src/worker.js";

let root: string;
let previousProfile: string | undefined;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mem-claude-config-"));
	previousProfile = process.env.SNO_PROFILE_DIR;
	process.env.SNO_PROFILE_DIR = root;
});

afterEach(async () => {
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	await rm(root, { recursive: true, force: true });
});

async function registration(installed: Record<string, unknown>) {
	const station = join(root, "station");
	await mkdir(station, { recursive: true });
	await writeFile(join(station, "sno-station-mem-test-user.config.json"), JSON.stringify({
		storePath: join(root, "memory.sqlite"),
		...installed,
	}));
	return installedRegistration("test-user", "http://127.0.0.1:1234/v1", "test-credential");
}

describe("Claude worker installed configuration", () => {
	it("defaults an omitted mode to agent-native", async () => {
		const result = await registration({});

		expect(result).toMatchObject({
			skinId: "claude-code",
			routing: { mode: "agent-native", agentNative: { flavor: "subscription" } },
			model: { model: "claude-exec" },
		});
	});

	it.each(["local-first", "rem-enhanced"] as const)("preserves explicit %s routing", async mode => {
		const result = await registration({
			mode,
			...(mode === "rem-enhanced"
				? { remEnhanced: { occasions: { memoryExtract: "agent" } } }
				: {}),
		});

		expect(result.routing.mode).toBe(mode);
		if (mode === "rem-enhanced") {
			expect(result.routing.remEnhanced.occasions.memoryExtract).toBe("agent");
		}
	});
});
