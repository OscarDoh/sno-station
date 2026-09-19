import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { encodeDiagnostic } from "../dist/diagnostic-encoder.js";

const OBSERVE_BASE_URL = "https://www.sno.ai";
const OBSERVE_AGENT_ID = "openclaw";
const INSTALL_TOOL_NAME = "mem-claw:install";

function observeDisabled(env) {
	const value = env.SNO_OBSERVE_ENABLED;
	return value === "false" || value === "0";
}

function commandExists(name, env = process.env) {
	const pathValue = env.PATH;
	if (!pathValue) return false;
	const extensions =
		process.platform === "win32"
			? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const dir of pathValue.split(delimiter)) {
		if (!dir) continue;
		for (const ext of extensions) {
			try {
				accessSync(join(dir, `${name}${ext}`), constants.X_OK);
				return true;
			} catch {
				// Continue scanning PATH without executing install-time binaries.
			}
		}
	}
	return false;
}

async function sampledEventId(observe) {
	const { v7: uuidv7 } = await import("uuid");
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const eventId = uuidv7().toLowerCase();
		if (observe.shouldSampleTool(eventId, INSTALL_TOOL_NAME)) return eventId;
	}
	return uuidv7().toLowerCase();
}

function writeOnboarding(output, _env, status) {
	if (!output.isTTY) {
		output.write("Sno Memory for OpenClaw installed\n");
		return;
	}
	output.write("Sno Memory for OpenClaw installed.\n\n");
	output.write(
		"Secure local memory for OpenClaw: long-term context, better continuity, observability, and memory context management.\n\n",
	);
	if (status === "disabled") {
		output.write("Sno Observe is off for this install.\n");
		return;
	}
	output.write("What changed:\n");
	output.write(
		"- Your agent can remember useful preferences, project context, and long-running work across sessions.\n",
	);
	output.write("- Memory stays local-first, with security-enhanced storage on this machine.\n");
	output.write(
		"- Sno Observe starts in metadata-only mode so you can inspect activity without sending raw memory text.\n",
	);
	output.write(
		"- Optional: run `sno account machine claim` to link this device to your Sno account for account-based Observe history and future multi-device memory features.\n\n",
	);
	output.write("Next, ask the user:\n");
	output.write("1. What should I remember about how you work and communicate?\n");
	output.write("2. Which language and tone should I use by default?\n");
	output.write("3. Should I optimize memory for richer context or lower token use?\n");
	if (!commandExists("sno", _env)) {
		output.write(
			"\nIf `sno` is not found, install the Sno CLI with: cargo install sno\n",
		);
	}
}

export async function bootstrapObserveInstall({
	pluginDir,
	env = process.env,
	output = process.stdout,
	error = process.stderr,
} = {}) {
	if (observeDisabled(env)) {
		writeOnboarding(output, env, "disabled");
		return;
	}
	let observe;
	try {
		const { createSnoObserve } = await import("@snoai/sno-observe");
		observe = createSnoObserve({
			cwd: pluginDir,
			env: {
				...env,
				SNO_OBSERVE_BASE_URL: env.SNO_OBSERVE_BASE_URL ?? OBSERVE_BASE_URL,
			},
			fetch: async () => new Response("postinstall egress disabled", { status: 503 }),
		});
		const eventId = await sampledEventId(observe);
		await observe.emit({
			event_id: eventId,
			event_type: "tool.call",
			agent_id: OBSERVE_AGENT_ID,
			lane: "memory",
			payload: {
				tool_name: INSTALL_TOOL_NAME,
				decision: "allow",
				input_hash: observe.hashRedactedText("mem-claw-install"),
				output_hash: observe.hashRedactedText("installed"),
				latency_ms: 0,
			},
		});
		writeOnboarding(output, env, "ready");
	} catch (bootstrapError) {
		try {
			error.write(`${encodeDiagnostic({ level: "warn", body: "Observe bootstrap skipped", attributes: { error: bootstrapError }, source: { event_name: "installer.observe.bootstrap.skipped", file: "apps/mem-claw/bin/_observe-onboarding.js", function: "bootstrapObserveInstall", site_id: "installer.observe.bootstrap.skipped" } })}\n`);
		} catch { /* Diagnostics do not change onboarding results. */ }
		writeOnboarding(output, env, "warning");
	} finally {
		try {
			await observe?.shutdown();
		} catch (shutdownError) {
			try {
				error.write(`${encodeDiagnostic({ level: "warn", body: "Observe shutdown failed", attributes: { error: shutdownError }, source: { event_name: "installer.observe.shutdown.failed", file: "apps/mem-claw/bin/_observe-onboarding.js", function: "bootstrapObserveInstall", site_id: "installer.observe.shutdown.failed" } })}\n`);
			} catch { /* Diagnostics do not change onboarding results. */ }
		}
	}
}
