import { Command } from "commander";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, expect, it, vi } from "vitest";
import { registerMemoryCli } from "../../../../apps/mem-claw/src/commands/memory-management-cli";
import { pluginConfigSchema } from "../../../../packages/sno-station-mem/config/plugin-config-schema";

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "/tmp/explicit-memory-profile"])("executes the CLI with the host profile and override %s", async (override) => {
	vi.stubEnv("OPENCLAW_STATE_DIR", "/tmp/profile-home/.openclaw-sno-e2e");
	vi.stubEnv("SNO_PROFILE_DIR", override);
	const program = new Command();
	// The external host provides only CLI registration here; its runtime is unavailable in metadata mode.
	const api = {
		config: {},
		get runtime() { throw new Error("runtime unavailable during CLI metadata registration"); },
		registerCli(register: (context: { program: Command }) => void) { register({ program }); },
	} as unknown as OpenClawPluginApi;
	registerMemoryCli(api, {
		stateDir: "/tmp/unused-registration-state",
		connection: {
			async ready() { throw new Error("unused connection"); },
			async scope() { throw new Error("unused connection"); },
			async close() {},
		},
	}, pluginConfigSchema.parse({}));
	expect(program.commands.map(command => command.name())).toEqual(["sno-mem"]);
	// Metadata discovery must leave process state untouched. The selected command receives the directory.
	expect(process.env.SNO_PROFILE_DIR).toBe(override);
	program.commands[0]?.command("profile-check").action(() => {});
	await program.parseAsync(["sno-mem", "profile-check"], { from: "user" });
	expect(process.env.SNO_PROFILE_DIR).toBe(override === undefined ? "/tmp/profile-home/.sno-sno-e2e" : "/tmp/explicit-memory-profile");
});
