#!/usr/bin/env node
import { writeEmergencyDiagnostic } from "../dist/diagnostic-encoder.js";
/* eslint-disable */
/**
 * mem-claw-install — npm-shipped install wrapper for @snoai/mem-claw.
 *
 * Coexistence with `openclaw plugins install`:
 *   This wrapper is purely additive. It does NOT replace, monkey-patch, or
 *   reimplement OpenClaw's install logic. It invokes `openclaw plugins
 *   install` as a subprocess and then writes the selected onboarding config
 *   atomically.
 *
 *
 * What it does:
 *   1. Confirms `openclaw` CLI is on PATH.
 *   2. Resolves `defaultK` and `leanK` from the package's own
 *      `openclaw.plugin.json` — the same manifest AC5 already pins.
 *   3. Optionally prompts for memory profile, embedder, LLM, rerank, K, and slot.
 *   4. Runs `openclaw [--profile X] plugins install <pluginPath>` when needed.
 *   5. Writes only selected config deltas into openclaw.json.
 *   6. Prints the Path A trade-off nudge and setup handoff.
 *
 * Flags:
 *   --profile <name>     Forwarded to all openclaw invocations.
	 *   --default            Skip prompt, apply default onboarding config.
 *   --lean               Skip prompt, set K = leanK.
 *   --rem-operations <v> Request both built REM operations (default), rem-update, or rem-replace.
 *   --no-slot            Skip auto-slot assignment.
 *   --non-interactive    Skip all prompts, all defaults (≡ plain install).
 *   --help, -h           Print usage and exit.
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime error (subprocess failed, manifest unreadable, etc.)
 *   2 — environment error (openclaw not on PATH, manifest format invalid)
 *   3 — user cancelled at prompt
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output, exit } from "node:process";
import { renderPathANudge } from "./_install-nudge-shared.js";
import {
	PLUGIN_ID,
	EMBEDDER_PRESETS,
	applyOnboardingConfig,
	applySlotConfig,
	buildHandoff,
	buildOnboardingSelection,
	detectSetupState,
	ensureMemClawEntry,
	findUnsatisfiedRequirements,
	formatStatus,
	hasMemClawEntry,
	listEmbedderPresets,
	parseInstallerArgs,
	readCurrentSlotFromConfig,
	readOnboardingEnvFile,
	readOpenClawConfig,
	DEFAULT_MODEL_MODE,
	PRODUCT_MODES,
	DEFAULT_EMBEDDER,
	resolveEnvRequirements,
	resolveOnboardingEnvFilePath,
	resolveOpenClawConfigPath,
	resolveSystemdDropInPath,
	writeOnboardingEnvFile,
	writeOpenClawConfigAtomic,
	writeSystemdDropIn,
} from "./_onboarding-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(__dirname, "..");
const manifestPath = resolve(pluginDir, "openclaw.plugin.json");

function fail(code, body, attributes, source) {
	writeEmergencyDiagnostic({ level: "error", body, attributes: { ...attributes, exit_code: code }, source });
	exit(code);
}

function loadManifestDefaults() {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	} catch (e) {
		fail(2, "Cannot read plugin manifest", { reason_code: "manifest_read_failed", error: e, manifest_path: manifestPath }, { event_name: "installer.manifest_read_failed", file: "apps/mem-claw/bin/mem-claw-install.js", function: "loadManifestDefaults", site_id: "installer.manifest_read_failed" });
	}
	const recall =
		manifest?.configSchema?.properties?.retrieval?.properties?.recallTopK;
	const defaultK = recall?.default;
	if (typeof defaultK !== "number" || !Number.isInteger(defaultK)) {
		fail(2, "Plugin manifest default recall count is invalid", { reason_code: "manifest_default_invalid" }, { event_name: "installer.manifest_default_invalid", file: "apps/mem-claw/bin/mem-claw-install.js", function: "loadManifestDefaults", site_id: "installer.manifest_default_invalid" });
	}
	const help = manifest?.uiHints?.["retrieval.recallTopK"]?.help;
	if (typeof help !== "string") {
		fail(2, "Plugin manifest recall help is missing", { reason_code: "manifest_help_missing" }, { event_name: "installer.manifest_help_missing", file: "apps/mem-claw/bin/mem-claw-install.js", function: "loadManifestDefaults", site_id: "installer.manifest_help_missing" });
	}
	const leanMatch = /\bLean (\d+)\b/.exec(help);
	if (!leanMatch) {
		fail(2, "Plugin manifest lean count hint is missing", { reason_code: "manifest_lean_hint_missing" }, { event_name: "installer.manifest_lean_hint_missing", file: "apps/mem-claw/bin/mem-claw-install.js", function: "loadManifestDefaults", site_id: "installer.manifest_lean_hint_missing" });
	}
	const leanK = Number(leanMatch[1]);
	if (!Number.isInteger(leanK)) {
		fail(2, "Plugin manifest lean count is invalid", { reason_code: "manifest_lean_count_invalid" }, { event_name: "installer.manifest_lean_count_invalid", file: "apps/mem-claw/bin/mem-claw-install.js", function: "loadManifestDefaults", site_id: "installer.manifest_lean_count_invalid" });
	}
	const mode = manifest?.configSchema?.properties?.mode;
	const defaultMode = mode?.default;
	if (
		defaultMode !== DEFAULT_MODEL_MODE ||
		!Array.isArray(mode?.enum) ||
		JSON.stringify(mode.enum) !== JSON.stringify(PRODUCT_MODES)
	) {
		fail(2, "Plugin manifest default memory mode is invalid", { reason_code: "manifest_mode_default_invalid" }, { event_name: "installer.manifest_mode_default_invalid", file: "apps/mem-claw/bin/mem-claw-install.js", function: "loadManifestDefaults", site_id: "installer.manifest_mode_default_invalid" });
	}
	return { defaultK, leanK };
}

function parseArgs(argv) {
	try {
		return parseInstallerArgs(argv);
	} catch (error) {
		fail(2, "Installer arguments are invalid. Run mem-claw-install --help.", { reason_code: "arguments_invalid", error }, { event_name: "installer.arguments_invalid", file: "apps/mem-claw/bin/mem-claw-install.js", function: "parseArgs", site_id: "installer.arguments_invalid" });
	}
}

function printUsage(defaultK, leanK) {
	output.write(
		`mem-claw — install + configure ${PLUGIN_ID} for OpenClaw

Usage: npx @snoai/mem-claw [flags]

Flags:
  --profile <name>     Forwarded to openclaw (e.g. sno-e2e, locomo).
  --memory-profile <p> local-active, capture-only, manual-only, or custom.
  --configure, --setup Force the setup wizard/config writer even if complete.
  --status             Print setup status without changing config.
  --embedder <preset>  Embedding preset (${listEmbedderPresets().join(", ")}).
  --mode <m>           Memory LLM mode: local-first (no LLM), agent-native
                       (host model or your own API key), rem-enhanced (top
                       tier: SNO-REM-MEM stack). Subsumes --llm.
  --llm <off|agent|openai|sno|openrouter|preset>
                       LLM choice; "agent" borrows the host agent's model.
  --llm-mode <mode>    off, extraction, or extraction+reflection.
  --llm-base-url <url> Optional Sno-compatible base URL override.
  --rerank <mode>      lightweight, none, or cross-encoder.
  --rerank-provider <provider>
                       voyage or siliconflow.
  --default            Skip prompt, set recallTopK=${defaultK} (~91% bench, default).
  --lean               Skip prompt, set recallTopK=${leanK} (~25% cheaper, ~5pp lower).
  --rem-operations <v> Request both built REM operations (default), rem-update, or rem-replace.
  --no-slot            Don't auto-assign ${PLUGIN_ID} to the memory slot.
  --non-interactive    No prompts; identical end state to plain
                       \`openclaw plugins install\` + restart.
  -h, --help           Show this help.

Coexistence: this wrapper is purely additive over \`openclaw plugins install\`.
Plain \`openclaw plugins install\` continues to work and yields the same
defaults as \`--non-interactive\`.
`,
	);
}

function checkOpenclawOnPath() {
	const r = spawnSync("openclaw", ["--version"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.error || r.status !== 0) {
		fail(2, "OpenClaw CLI is unavailable. Install it with npm i -g openclaw.", { reason_code: "openclaw_unavailable", error: r.error, status: r.status }, { event_name: "installer.openclaw_unavailable", file: "apps/mem-claw/bin/mem-claw-install.js", function: "checkOpenclawOnPath", site_id: "installer.openclaw_unavailable" });
	}
}

/**
 * Spawn `openclaw` with stdin closed when we are running non-interactively.
 *
 * `nonInteractive=true` ⇒ stdin = "ignore", so any prompt OpenClaw might
 * try to issue (config-conflict resolution, etc.) fails fast at EOF
 * instead of blocking CI. `nonInteractive=false` ⇒ stdin inherits, so
 * the user can answer OpenClaw's own prompts during interactive installs.
 */
function ocSpawn(args, profile, { nonInteractive = false } = {}) {
	const full = profile ? ["--profile", profile, ...args] : args;
	const stdinSetting = nonInteractive ? "ignore" : "inherit";
	const r = spawnSync("openclaw", full, {
		stdio: [stdinSetting, "inherit", "inherit"],
		encoding: "utf-8",
	});
	if (r.error) fail(1, "OpenClaw process could not start", { reason_code: "openclaw_spawn_failed", error: r.error }, { event_name: "installer.openclaw_spawn_failed", file: "apps/mem-claw/bin/mem-claw-install.js", function: "ocSpawn", site_id: "installer.openclaw_spawn_failed" });
	return r;
}

function hasUsableHostSubscription(profile) {
	const args = profile
		? ["--profile", profile, "models", "status", "--json"]
		: ["models", "status", "--json"];
	const result = spawnSync("openclaw", args, {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf-8",
		timeout: 10_000,
	});
	if (result.error || result.status !== 0) return false;
	try {
		const status = JSON.parse(result.stdout);
		const profiles = status?.auth?.oauth?.profiles;
		return (
			Array.isArray(profiles) &&
			profiles.some(
				(candidate) =>
					candidate?.provider === "openai" &&
					candidate?.type === "oauth" &&
					(candidate?.status === "ok" || candidate?.status === "expiring"),
			)
		);
	} catch {
		return false;
	}
}

async function runObserveOnboarding() {
	try {
		const { bootstrapObserveInstall } = await import("./_observe-onboarding.js");
		await bootstrapObserveInstall({ pluginDir });
	} catch (error) {
		writeEmergencyDiagnostic({ level: "warn", body: "Observe onboarding skipped", attributes: { error }, source: { event_name: "installer.observe.skipped", file: "apps/mem-claw/bin/mem-claw-install.js", function: "runObserveOnboarding", site_id: "installer.observe.skipped" } });
	}
}

async function promptKChoice(defaultK, leanK) {
	const rl = createInterface({ input, output });
	try {
		output.write(
			`\n[mem-claw-install] Memory recall depth — pick how many memories the agent sees per turn:\n`,
		);
		output.write(
			`  (D) Default — K=${defaultK}. ~91% answer correctness on LoCoMo conv0 bench. ~12M prompt tokens / 400Q.\n`,
		);
		output.write(
			`  (L) Lean    — K=${leanK}. 86.25% on the same bench. ~25% cheaper.\n`,
		);
		const ans = (
			await rl.question(`Choice [D/L, enter=Default]: `)
		).trim().toLowerCase();
		if (ans === "" || ans === "d" || ans === "default") return "default";
		if (ans === "l" || ans === "lean") return "lean";
		output.write(`[mem-claw-install] unrecognized; using default.\n`);
		return "default";
	} finally {
		rl.close();
	}
}

async function promptSlotConfirm() {
	const rl = createInterface({ input, output });
	try {
		const ans = (
			await rl.question(
				`[mem-claw-install] Memory slot is empty. Set ${PLUGIN_ID} as the memory plugin? [Y/n]: `,
			)
		).trim().toLowerCase();
		return ans === "" || ans === "y" || ans === "yes";
	} finally {
		rl.close();
	}
}

/**
 * Prompt for one secret with the typed characters suppressed so the key
 * never lands in the terminal scrollback or an E2E transcript. The label is
 * written to the real output first; the interface then renders line edits
 * into a sink, so the keystrokes are never echoed.
 */
async function promptSecret(rl, label) {
	output.write(`${label}: `);
	// Node 22+ readline does not expose `_writeToOutput`, so muting it is a
	// silent no-op. stdin is in raw mode, so the interface's own rendering is
	// the only echo path — redirect it to a sink for the duration of the read.
	const realOutput = rl.output;
	const sink = {
		write: () => true,
		end: () => {},
		cork: () => {},
		uncork: () => {},
		on: () => {},
		once: () => {},
		emit: () => {},
		removeListener: () => {},
	};
	rl.output = sink;
	try {
		return (await rl.question("")).trim();
	} finally {
		rl.output = realOutput;
		output.write("\n");
	}
}

async function collectMissingKeys(missing) {
	const rl = createInterface({ input, output });
	const collected = {};
	try {
		output.write(
			`\n[mem-claw-install] These cloud features need API keys not found in your environment.\n`,
		);
		output.write(
			`[mem-claw-install] Keys are saved to a local 0600 .env file; input is hidden.\n`,
		);
		for (const req of missing) {
			output.write(`  ${req.name} — ${req.purpose}\n`);
			const value = await promptSecret(rl, `  Enter ${req.name} (blank to skip)`);
			if (value) collected[req.name] = value;
		}
	} finally {
		rl.close();
	}
	return collected;
}

function reloadSystemdUserDaemon() {
	const r = spawnSync("systemctl", ["--user", "daemon-reload"], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	return !r.error && r.status === 0;
}

/**
 * Write collected keys to the per-profile onboarding .env file and a systemd
 * user drop-in so the gateway process loads them via `EnvironmentFile=`.
 */
function persistCredentials(collected, profile) {
	if (Object.keys(collected).length === 0) return undefined;
	const envFilePath = resolveOnboardingEnvFilePath(profile);
	writeOnboardingEnvFile(envFilePath, collected);
	const dropInPath = resolveSystemdDropInPath(profile);
	writeSystemdDropIn(dropInPath, envFilePath);
	const daemonReloaded = reloadSystemdUserDaemon();
	return { envFilePath, dropInPath, daemonReloaded };
}

async function promptWizardArgs(args, baseConfig) {
	const current = baseConfig?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
	const rl = createInterface({ input, output });
	try {
		output.write(`\n[mem-claw-install] Setup wizard\n`);
		const memoryProfile = await askChoice(rl, {
			label: "Memory profile",
			choices: [
				["1", "local-active"],
				["2", "capture-only"],
				["3", "manual-only"],
				["4", "custom"],
			],
			defaultValue: args.memoryProfile ?? inferMemoryProfile(current),
		});
		const embedder = await askText(rl, {
			label: "Embedder preset",
			defaultValue: args.embedder ?? inferEmbedderPreset(current),
		});
		output.write(
			"\nMemory LLM mode — local-first: no LLM, deterministic capture + full retrieval;\n" +
				"agent-native: your agent's own model or your own API key;\n" +
				"rem-enhanced: the SNO-REM-MEM memory model stack (top tier).\n",
		);
		const productMode = await askChoice(rl, {
			label: "Memory LLM mode",
			choices: [
				["1", "local-first"],
				["2", "agent-native"],
				["3", "rem-enhanced"],
			],
			defaultValue:
				args.mode ?? productModeForLlm(args.llm) ?? inferProductModeChoice(current),
		});
		let llm = "off";
		let llmMode = "off";
		let llmBaseURL = args.llmBaseURL;
		if (productMode === "agent-native") {
			if (hasUsableHostSubscription(args.profile)) {
				output.write(
					"\n[mem-claw-install] Using the existing ChatGPT/Codex OAuth subscription.\n",
				);
				llm = "agent";
			} else {
				output.write(
					"\n[mem-claw-install] No usable ChatGPT/Codex OAuth subscription found; choose an API key provider.\n",
				);
				const existingFlavor = inferAgentFlavorChoice(current);
				const keyProvider = await askChoice(rl, {
					label: "Agent-Native key provider",
					choices: [
						["1", "byok-openai"],
						["2", "byok-openrouter"],
					],
					defaultValue:
						existingFlavor === "byok-openrouter" ? "byok-openrouter" : "byok-openai",
				});
				llm = keyProvider === "byok-openrouter" ? "openrouter" : "openai";
			}
		} else if (productMode === "rem-enhanced") {
			llm = "sno";
			llmBaseURL = await askOptionalText(rl, {
				label: "Sno base URL (blank for default)",
				defaultValue: llmBaseURL ?? current.extraction?.llm?.baseURL,
			});
		}
		if (llm !== "off" && llm !== "agent") {
			llmMode = await askChoice(rl, {
				label: "LLM mode",
				choices: [
					["1", "extraction"],
					["2", "extraction+reflection"],
				],
				defaultValue: args.llmMode ?? inferLlmMode(current),
			});
		} else if (llm === "agent") {
			llmMode = "extraction";
		}
		const rerank = await askChoice(rl, {
			label: "Rerank",
			choices: [
				["1", "lightweight"],
				["2", "none"],
				["3", "cross-encoder"],
			],
			defaultValue: args.rerank ?? current.retrieval?.rerank ?? "lightweight",
		});
		let rerankProvider = args.rerankProvider ?? current.retrieval?.rerankProvider;
		if (rerank === "cross-encoder") {
			rerankProvider = await askText(rl, {
				label: "Rerank provider",
				defaultValue: rerankProvider ?? "voyage",
			});
		}
		return { memoryProfile, embedder, llm, llmMode, llmBaseURL, rerank, rerankProvider };
	} finally {
		rl.close();
	}
}

function inferMemoryProfile(config) {
	if (config.sessionStrategy === "none" || config.ambientLearning === false) return "manual-only";
	if (config.ambientLearning === true && config.autoRecall === false) return "capture-only";
	return "local-active";
}

function inferEmbedderPreset(config) {
	const embedding = config.embedding;
	if (!embedding || typeof embedding !== "object") return DEFAULT_EMBEDDER;
	for (const [name, preset] of Object.entries(EMBEDDER_PRESETS)) {
		if (
			embedding.provider === preset.provider &&
			embedding.model === preset.model &&
			embedding.dimensions === preset.dimensions
		) {
			return name;
		}
	}
	return DEFAULT_EMBEDDER;
}

function inferLlmChoice(config) {
	if (config.mode === "agent-native" && config.agentNative?.flavor === "subscription") {
		return "agent";
	}
	const preset = config.extraction?.llm?.preset;
	if (preset === "mem_claw/openai_gpt_5_nano") return "openai";
	if (preset === "mem_claw/sno_ai_extract") return "sno";
	if (preset === "mem_claw/openrouter_auto") return "openrouter";
	return "off";
}

function inferProductModeChoice(config) {
	if (config.mode === "local-first" || config.mode === "agent-native" || config.mode === "rem-enhanced") {
		return config.mode;
	}
	const llm = inferLlmChoice(config);
	if (llm === "sno") return "rem-enhanced";
	if (llm === "openai" || llm === "openrouter" || llm === "agent") return "agent-native";
	return DEFAULT_MODEL_MODE;
}

function productModeForLlm(llm) {
	if (llm === "sno") return "rem-enhanced";
	if (llm === "openai" || llm === "openrouter" || llm === "agent") return "agent-native";
	if (llm === "off") return "local-first";
	return undefined;
}

function inferAgentFlavorChoice(config) {
	const llm = inferLlmChoice(config);
	if (llm === "openai") return "byok-openai";
	if (llm === "openrouter") return "byok-openrouter";
	return "subscription";
}

function inferLlmMode(config) {
	if (config.sessionStrategy === "memoryReflection") return "extraction+reflection";
	return "extraction";
}

async function askText(rl, { label, defaultValue }) {
	const ans = (await rl.question(`${label} [${defaultValue}]: `)).trim();
	return ans || defaultValue;
}

async function askOptionalText(rl, { label, defaultValue }) {
	const suffix = defaultValue ? ` [${defaultValue}]` : "";
	const ans = (await rl.question(`${label}${suffix}: `)).trim();
	return ans || defaultValue || undefined;
}

async function askChoice(rl, { label, choices, defaultValue }) {
	const rendered = choices.map(([key, value]) => `${key}) ${value}`).join("  ");
	const ans = (await rl.question(`${label}: ${rendered} [${defaultValue}]: `)).trim();
	if (!ans) return defaultValue;
	const found = choices.find(([key, value]) => ans === key || ans === value);
	return found ? found[1] : defaultValue;
}

function hasExplicitOnboardingArgs(args) {
	return Boolean(
		args.forceConfigure ||
			args.choice ||
			args.memoryProfile ||
			args.embedder ||
			args.llm ||
			args.mode ||
			args.llmMode ||
			args.llmBaseURL ||
			args.remOperations ||
			args.rerank ||
			args.rerankProvider,
	);
}

async function main() {
	let args = parseArgs(process.argv.slice(2));
	const { defaultK, leanK } = loadManifestDefaults();

	if (args.help) {
		printUsage(defaultK, leanK);
		exit(0);
	}

	const configPath = resolveOpenClawConfigPath(args.profile);
	const beforeConfig = readOpenClawConfig(configPath);
	const setupState = detectSetupState(beforeConfig, {
		forceConfigure: args.forceConfigure,
	});

	if (args.status) {
		output.write(`${formatStatus(beforeConfig, setupState)}\n`);
		exit(0);
	}

	if (setupState.kind === "config-invalid") {
		fail(2, "OpenClaw configuration is invalid before installation", { reason_code: "config_invalid_before_install", error: setupState.error, config_path: configPath }, { event_name: "installer.config_invalid_before_install", file: "apps/mem-claw/bin/mem-claw-install.js", function: "main", site_id: "installer.config_invalid_before_install" });
	}

	if (setupState.kind === "marker-complete") {
		output.write(`${formatStatus(beforeConfig, setupState)}\n`);
		output.write(`[${PLUGIN_ID}] Reconfigure: npx @snoai/mem-claw --configure\n`);
		exit(0);
	}

	checkOpenclawOnPath();

	const isNonInteractive = args.nonInteractive || !input.isTTY;

	const shouldInstall =
		setupState.kind === "missing-plugin" ||
		(setupState.kind === "forced-reconfigure" && !hasMemClawEntry(beforeConfig));
	if (shouldInstall) {
		// Step 1: invoke plain install. This is the same path a user without
		// the wrapper would take. We pass our own package directory so npm
		// doesn't have to refetch.
		output.write(
			`\n[mem-claw-install] running: openclaw plugins install ${pluginDir}\n`,
		);
			const installResult = ocSpawn(
				["plugins", "install", pluginDir],
				args.profile,
				{ nonInteractive: isNonInteractive },
			);
		if (installResult.status !== 0) {
			fail(installResult.status ?? 1, "OpenClaw installation failed before configuration write", { reason_code: "openclaw_install_failed", status: installResult.status }, { event_name: "installer.openclaw_install_failed", file: "apps/mem-claw/bin/mem-claw-install.js", function: "main", site_id: "installer.openclaw_install_failed" });
		}
	}

	// Step 2: selected-delta config write. This is intentionally direct
	// and atomic so onboarding can write complete object subtrees while
	// preserving unrelated OpenClaw fields.
	const afterInstall = readOpenClawConfig(configPath);
	if (afterInstall.kind === "invalid") {
		fail(2, "OpenClaw configuration is invalid after installation", { reason_code: "config_invalid_after_install", error: afterInstall.error, config_path: configPath }, { event_name: "installer.config_invalid_after_install", file: "apps/mem-claw/bin/mem-claw-install.js", function: "main", site_id: "installer.config_invalid_after_install" });
	}
	if (isNonInteractive && !hasExplicitOnboardingArgs(args)) {
		output.write(`[${PLUGIN_ID}] Installed. Configure later: npx @snoai/mem-claw --configure\n`);
		exit(0);
	}
	const baseConfig = afterInstall.kind === "ok" ? afterInstall.config : {};
	ensureMemClawEntry(baseConfig);

	const shouldRunWizard = !args.nonInteractive && !args.choice && output.isTTY && input.isTTY;
	if (shouldRunWizard) {
		const explicitLlm = args.llm;
		args = {
			...args,
			...(await promptWizardArgs(args, baseConfig)),
			...(explicitLlm === undefined ? {} : { llm: explicitLlm }),
		};
	}

	// Resolve K choice.
	let chosen;
	if (args.choice === "lean") chosen = "lean";
	else if (args.choice === "default") chosen = "default";
	else if (args.nonInteractive || !output.isTTY || !input.isTTY)
		chosen = "default";
	else chosen = await promptKChoice(defaultK, leanK);
	const interactiveDefault =
		!isNonInteractive &&
		args.choice === undefined &&
		chosen === "default" &&
		output.isTTY &&
		input.isTTY;
	const selection = buildOnboardingSelection(
		{ ...args, choice: chosen },
		{ defaultK, leanK, interactive: !isNonInteractive },
	);

	// Probe the cloud selections for required env vars. Keys already saved to a
	// prior run's onboarding .env count as satisfied, so re-running --configure
	// does not re-prompt. When the wizard ran and a key is still absent, prompt
	// for it, persist it to the onboarding .env + systemd drop-in, and feed it
	// into applyOnboardingConfig so credential validation sees the value.
	const savedEnv = readOnboardingEnvFile(resolveOnboardingEnvFilePath(args.profile));
	let onboardingEnv = { ...process.env };
	for (const [key, value] of Object.entries(savedEnv)) {
		const live = onboardingEnv[key];
		if (typeof live !== "string" || live.trim() === "") {
			onboardingEnv[key] = value;
		}
	}
	if (shouldRunWizard) {
		const missing = findUnsatisfiedRequirements(resolveEnvRequirements(selection), onboardingEnv);
		if (missing.length > 0) {
			const collected = await collectMissingKeys(missing);
			const persisted = persistCredentials(collected, args.profile);
			if (persisted) {
				onboardingEnv = { ...onboardingEnv, ...collected };
				output.write(
					`[mem-claw-install] wrote ${Object.keys(collected).length} key(s) to ${persisted.envFilePath} (0600)\n`,
				);
				output.write(`[mem-claw-install] gateway env drop-in: ${persisted.dropInPath}\n`);
				if (!persisted.daemonReloaded) {
					output.write(
						`[mem-claw-install] run 'systemctl --user daemon-reload' before restarting the gateway.\n`,
					);
				}
			}
		}
	}

	let claimSlot = false;
	if (!args.noSlot && (interactiveDefault || args.choice === "lean")) {
		const currentSlot = readCurrentSlotFromConfig(baseConfig);
		if (currentSlot.kind === "empty") {
			claimSlot = args.choice === "lean" || (await promptSlotConfirm());
		} else if (currentSlot.plugin !== PLUGIN_ID) {
			output.write(
				`[mem-claw-install] memory slot is currently '${currentSlot.plugin}'. NOT changing it.\n`,
			);
		}
	}
	let setupResult;
	let slotted;
	try {
		setupResult = applyOnboardingConfig(baseConfig, selection, { env: onboardingEnv });
		slotted = applySlotConfig(setupResult.config, { claimSlot });
		writeOpenClawConfigAtomic(configPath, slotted.config, {
			expectedRaw: afterInstall.kind === "ok" ? afterInstall.raw : null,
		});
	} catch (error) {
		fail(1, "Onboarding configuration could not be written", { reason_code: "config_write_failed", error }, { event_name: "installer.config_write_failed", file: "apps/mem-claw/bin/mem-claw-install.js", function: "main", site_id: "installer.config_write_failed" });
	}

	// Step 3: bootstrap anonymous observe identity and print onboarding.
	await runObserveOnboarding();

	// Step 4: print the trade-off nudge and setup handoff.
	output.write(`\n${renderPathANudge({ defaultK, leanK, chosen })}\n`);
	output.write(`${buildHandoff(selection, setupResult, slotted.status, args.profile)}\n`);
	exit(0);
}

main().catch((e) => {
	fail(1, "Plugin installation failed unexpectedly", { reason_code: "unhandled_failure", error: e }, { event_name: "installer.unhandled_failure", file: "apps/mem-claw/bin/mem-claw-install.js", function: "<anonymous callback>", site_id: "installer.unhandled_failure" });
});
