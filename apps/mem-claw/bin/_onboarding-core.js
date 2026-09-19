import { createRequire } from "node:module";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	DEFAULT_MODEL_MODE,
	PRODUCT_MODES,
} from "@snoai/sno-station-mem/internal/config/skin-defaults";

export { DEFAULT_MODEL_MODE, PRODUCT_MODES };

const require = createRequire(import.meta.url);

export const PLUGIN_ID = "sno-mem-claw";
export const ONBOARDING_VERSION = 1;
export const DEFAULT_PROFILE = "local-active";
export const DEFAULT_EMBEDDER = "local-pplx";
export const DEFAULT_LLM_SCOPE = "off";
export const DEFAULT_RERANK_MODE = "lightweight";
export const DEFAULT_REM_OPERATIONS = ["rem-replace", "rem-update"];

function envPlaceholder(name) {
	return ["$", "{", name, "}"].join("");
}

export const EMBEDDER_PRESETS = {
	"local-pplx": {
		provider: "local-onnx",
		model: "tss-deposium/pplx-embed-v1-0.6b-onnx-int8-standard",
		revision: "a18fdffe7480e6ea5643acb7757142b33838817a",
		nativeDim: 1024,
		dimensions: 1024,
		dtype: "q8",
		pooling: "mean",
	},
};

export const LLM_PRESETS = {
	openai: {
		preset: "mem_claw/openai_gpt_5_nano",
		requiredEnv: "OPENAI_API_KEY",
	},
	sno: {
		preset: "mem_claw/sno_ai_extract",
		requiredEnv: "SNO_MEM_CLAW_LLM_API_KEY",
		alternateEnv: "SNO_MEM_CLAW_LLM_INTERNAL_KEY",
	},
	openrouter: {
		preset: "mem_claw/openrouter_auto",
		requiredEnv: "OPENROUTER_API_KEY",
	},
	"mem_claw/openai_gpt_5_nano": {
		preset: "mem_claw/openai_gpt_5_nano",
		requiredEnv: "OPENAI_API_KEY",
	},
	"mem_claw/sno_ai_extract": {
		preset: "mem_claw/sno_ai_extract",
		requiredEnv: "SNO_MEM_CLAW_LLM_API_KEY",
		alternateEnv: "SNO_MEM_CLAW_LLM_INTERNAL_KEY",
	},
	"mem_claw/openrouter_auto": {
		preset: "mem_claw/openrouter_auto",
		requiredEnv: "OPENROUTER_API_KEY",
	},
};

export const RERANK_PROVIDERS = {
	voyage: {
		rerankProvider: "voyage",
		rerankModel: "rerank-2",
		rerankApiKey: envPlaceholder("MEM_CLAW_EMBEDDING_API_KEY"),
		requiredEnv: "MEM_CLAW_EMBEDDING_API_KEY",
	},
	siliconflow: {
		rerankProvider: "siliconflow",
		rerankModel: "BAAI/bge-reranker-v2-m3",
		rerankApiKey: envPlaceholder("SILICONFLOW_API_KEY"),
		requiredEnv: "SILICONFLOW_API_KEY",
	},
};

export function listEmbedderPresets() {
	return Object.keys(EMBEDDER_PRESETS);
}

export function resolveOpenClawConfigPath(profile, env = process.env) {
	if (env.OPENCLAW_CONFIG_PATH) return env.OPENCLAW_CONFIG_PATH;
	if (env.OPENCLAW_STATE_DIR) return resolve(env.OPENCLAW_STATE_DIR, "openclaw.json");
	const home = env.HOME ?? process.env.HOME;
	if (!home) throw new Error("$HOME not set");
	const stateDir = profile ? `.openclaw-${profile}` : ".openclaw";
	return resolve(home, stateDir, "openclaw.json");
}

export function readOpenClawConfig(configPath) {
	if (!existsSync(configPath)) return { kind: "missing", configPath };
	try {
		const raw = readFileSync(configPath, "utf-8");
		return { kind: "ok", configPath, raw, config: JSON.parse(raw) };
	} catch (error) {
		return { kind: "invalid", configPath, error };
	}
}

export function writeOpenClawConfigAtomic(configPath, cfg, options = {}) {
	mkdirSync(dirname(configPath), { recursive: true });
	const tmp = `${configPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
	try {
		writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		if (Object.hasOwn(options, "expectedRaw")) {
			const currentRaw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
			if (currentRaw !== options.expectedRaw) {
				throw new Error(`openclaw config changed while ${PLUGIN_ID} onboarding was running; retry setup`);
			}
		}
		renameSync(tmp, configPath);
	} catch (error) {
		try {
			unlinkSync(tmp);
		} catch {
			// best-effort cleanup
		}
		throw error;
	}
}

export function ensureMemClawEntry(cfg) {
	cfg.plugins ??= {};
	cfg.plugins.entries ??= {};
	const entry = cfg.plugins.entries[PLUGIN_ID] ?? {};
	entry.config ??= {};
	cfg.plugins.entries[PLUGIN_ID] = entry;
	return entry;
}

export function getMemClawConfig(cfg) {
	return cfg?.plugins?.entries?.[PLUGIN_ID]?.config;
}

export function hasMemClawEntry(cfgState) {
	return cfgState.kind === "ok" && Boolean(cfgState.config?.plugins?.entries?.[PLUGIN_ID]);
}

export function getOnboardingMarker(cfg) {
	const marker = getMemClawConfig(cfg)?.onboarding;
	if (!marker || typeof marker !== "object") return undefined;
	if (marker.version !== ONBOARDING_VERSION || typeof marker.completedAt !== "string") {
		return undefined;
	}
	return marker;
}

export function detectSetupState(cfgState, { forceConfigure = false } = {}) {
	if (cfgState.kind === "missing") return { kind: "missing-plugin" };
	if (cfgState.kind !== "ok") return { kind: "config-invalid", error: cfgState.error };
	if (forceConfigure) return { kind: "forced-reconfigure" };
	if (!cfgState.config?.plugins?.entries?.[PLUGIN_ID]) return { kind: "missing-plugin" };
	if (getOnboardingMarker(cfgState.config)) return { kind: "marker-complete" };
	return { kind: "installed-without-marker" };
}

export function parseInstallerArgs(argv) {
	const args = {
		profile: undefined,
		memoryProfile: undefined,
		choice: undefined,
		noSlot: false,
		nonInteractive: false,
		help: false,
		forceConfigure: false,
		status: false,
		embedder: undefined,
		llm: undefined,
		llmMode: undefined,
		llmBaseURL: undefined,
		remOperations: undefined,
		rerank: undefined,
		rerankProvider: undefined,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--profile") {
			args.profile = argv[++i];
			if (!args.profile) throw new Error("--profile requires a value");
		} else if (a === "--memory-profile") {
			args.memoryProfile = readValue(argv, ++i, "--memory-profile");
		} else if (a === "--default") args.choice = "default";
		else if (a === "--lean") args.choice = "lean";
		else if (a === "--no-slot") args.noSlot = true;
		else if (a === "--non-interactive") args.nonInteractive = true;
		else if (a === "--configure" || a === "--setup") args.forceConfigure = true;
		else if (a === "--status") args.status = true;
		else if (a === "--embedder") args.embedder = readValue(argv, ++i, "--embedder");
		else if (a === "--llm") args.llm = readValue(argv, ++i, "--llm");
		else if (a === "--mode") args.mode = readValue(argv, ++i, "--mode");
		else if (a === "--llm-mode") args.llmMode = readValue(argv, ++i, "--llm-mode");
		else if (a === "--llm-base-url") args.llmBaseURL = readValue(argv, ++i, "--llm-base-url");
		else if (a === "--rem-operations") {
			args.remOperations = readValue(argv, ++i, "--rem-operations");
		}
		else if (a === "--rerank") args.rerank = readValue(argv, ++i, "--rerank");
		else if (a === "--rerank-provider") args.rerankProvider = readValue(argv, ++i, "--rerank-provider");
		else if (a === "--help" || a === "-h") args.help = true;
		else throw new Error(`unknown flag: ${a}`);
	}
	return args;
}

function readValue(argv, index, flag) {
	const value = argv[index];
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
	return value;
}

export function buildOnboardingSelection(
	args,
	{ defaultK, leanK, defaultMode = DEFAULT_MODEL_MODE, interactive = false } = {},
) {
	const profile = normalizeProfile(args.memoryProfile);
	const embedder = args.embedder ?? DEFAULT_EMBEDDER;
	assertKnown(embedder, EMBEDDER_PRESETS, "embedder preset");
	const recallChoice = args.choice === "lean" ? "lean" : "default";
	const recallTopK = recallChoice === "lean" ? leanK : defaultK;
	const profileSpecified = args.memoryProfile !== undefined;
	const llmSpecified =
		args.llm !== undefined || args.mode !== undefined || args.llmMode !== undefined;
	const llmChoice = llmChoiceFromMode(args.mode ?? defaultMode, args.llm);
	const llmMode = normalizeLlmMode(args.llmMode, llmChoice);
	const llmPreset = normalizeLlmPreset(llmChoice);
	const rerankMode = normalizeRerankMode(args.rerank);
	const rerankProvider = args.rerankProvider ?? "voyage";
	const remOperations = normalizeRemOperations(args.remOperations);
	if (rerankMode === "cross-encoder") assertKnown(rerankProvider, RERANK_PROVIDERS, "rerank provider");
	return {
		profile,
		profileSpecified,
		embedder,
		recallChoice,
		recallTopK,
		llmSpecified,
		llmChoice: llmChoice ?? "off",
		llmMode,
		llmPreset,
		llmBaseURL: args.llmBaseURL,
		rerankMode,
		rerankProvider,
		remOperations,
		remOperationsSpecified: args.remOperations !== undefined,
		interactive,
		claimSlot: false,
	};
}

function getExistingOnboardingProfile(config) {
	const profile = config.onboarding?.profile;
	if (
		profile === "local-active" ||
		profile === "capture-only" ||
		profile === "manual-only" ||
		profile === "custom"
	) {
		return profile;
	}
	// Markerless legacy install: infer the profile from the persisted capture
	// settings so a reconfiguration cannot silently re-enable capture that the
	// operator had turned off.
	if (config.ambientLearning === false) return "manual-only";
	if (config.ambientLearning === true && config.autoRecall === false) return "capture-only";
	return undefined;
}

function normalizeProfile(profile) {
	if (profile === undefined || profile === null || profile === "") return DEFAULT_PROFILE;
	if (
		profile === "local-active" ||
		profile === "capture-only" ||
		profile === "manual-only" ||
		profile === "custom"
	) {
		return profile;
	}
	// A mistyped restrictive profile must never silently become the
	// capture-enabled default.
	throw new Error(
		`unknown memory profile: ${profile} (expected local-active | capture-only | manual-only | custom)`,
	);
}

function normalizeLlmMode(llmMode, llm) {
	const raw = llmMode ?? (llm && llm !== "off" ? "extraction" : DEFAULT_LLM_SCOPE);
	if (raw === "off" || raw === "none") return "off";
	if (raw === "extraction" || raw === "extract" || raw === "reflection" || raw === "extraction+reflection") {
		const normalized = raw === "extraction" || raw === "extract" ? "extraction" : "extraction+reflection";
		// An LLM scope without an LLM choice would silently default to the
		// OpenAI preset downstream — reject the contradiction instead.
		if (!llm || llm === "off" || llm === "none") {
			throw new Error(
				`--llm-mode ${normalized} requires an LLM selection (--llm or --mode agent-native/rem-enhanced); the selected mode has no LLM`,
			);
		}
		return normalized;
	}
	throw new Error(`unknown LLM mode: ${raw}`);
}

function normalizeLlmPreset(llm) {
	const raw = llm ?? "off";
	if (raw === "off" || raw === "none") return undefined;
	// The host agent's own model has no LLMIx preset; the plugin borrows it in-process.
	if (raw === "agent") return undefined;
	assertKnown(raw, LLM_PRESETS, "LLM preset");
	return LLM_PRESETS[raw].preset;
}

/**
 * Maps a product mode (tier 1 local-first / tier 2 agent-native / tier 3
 * rem-enhanced) to the LLM choice the selection pipeline consumes. --llm wins
 * when both are given; bare "--mode agent-native" means the subscription flavor.
 */
function llmChoiceFromMode(mode, llm) {
	if (llm) return llm;
	if (mode === undefined) return undefined;
	if (mode === "local-first") return "off";
	if (mode === "agent-native") return "agent";
	if (mode === "rem-enhanced") return "sno";
	throw new Error(`unknown mode: ${mode} (expected local-first | agent-native | rem-enhanced)`);
}

function normalizeRerankMode(rerank) {
	const raw = rerank ?? DEFAULT_RERANK_MODE;
	if (raw === "lightweight" || raw === "none" || raw === "cross-encoder") return raw;
	throw new Error(`unknown rerank mode: ${raw}`);
}

function normalizeRemOperations(choice) {
	if (choice === undefined || choice === "both") return [...DEFAULT_REM_OPERATIONS];
	if (choice === "rem-update" || choice === "rem-replace") return [choice];
	throw new Error(
		`unknown REM operation choice: ${choice} (expected both | rem-update | rem-replace)`,
	);
}

function assertKnown(value, catalog, label) {
	if (!(value in catalog)) {
		throw new Error(`unknown ${label}: ${value}. Available: ${Object.keys(catalog).join(", ")}`);
	}
}

export function applyOnboardingConfig(cfg, selection, { now = new Date(), env = process.env } = {}) {
	const next = cloneJson(cfg ?? {});
	const entry = ensureMemClawEntry(next);
	const config = entry.config;
	const requiredEnv = [];
	const warnings = [];
	assertSupportedExtractionConfig(config);

	// Runs without the corresponding flags preserve the existing deployment's
	// choices instead of resetting them: the memory profile keeps its capture
	// restrictions, and the LLM setup keeps its product mode and preset. A bare
	// --llm-base-url counts as an endpoint change on top of the preserved setup.
	const existingProfile = getExistingOnboardingProfile(config);
	const effectiveProfile =
		selection.profileSpecified || existingProfile === undefined
			? selection.profile
			: existingProfile;
	let effectiveSelection = selection.llmSpecified || config.mode === undefined
		? selection
		: { ...selection, ...inferExistingLlmSelection(config) };
	if (!selection.llmSpecified && selection.llmBaseURL !== undefined) {
		effectiveSelection = { ...effectiveSelection, llmBaseURL: selection.llmBaseURL };
	}
	if (
		effectiveSelection.llmBaseURL !== undefined &&
		(effectiveSelection.llmChoice === "off" || effectiveSelection.llmChoice === "agent")
	) {
		throw new Error(
			"--llm-base-url requires an LLM selection that uses a remote preset (--llm sno / --mode rem-enhanced)",
		);
	}
	if (effectiveProfile === "manual-only" && effectiveSelection.llmMode === "extraction+reflection") {
		throw new Error(
			"manual-only memory profile contradicts extraction+reflection (reflection processes sessions automatically); pick a capture-enabled profile or --llm-mode extraction",
		);
	}
	if (
		effectiveSelection.llmChoice === "agent" &&
		effectiveSelection.llmMode === "extraction+reflection"
	) {
		throw new Error(
			"Agent Native subscription does not support reflection mode; use --llm-mode extraction or choose REM Enhanced",
		);
	}

	validateLlmCredentials(effectiveSelection, env);
	applyProfileConfig(config, effectiveProfile);
	applyEmbedderConfig(config, selection, env);
	applyLlmConfig(config, effectiveSelection, requiredEnv);
	applyRerankConfig(config, selection, requiredEnv, warnings, env);
	applyRecallConfig(config, selection);
	if (selection.remOperationsSpecified || config.remOperations === undefined) {
		config.remOperations = [...selection.remOperations];
	}
	normalizeLegacySessionMemory(config);

	config.onboarding = {
		version: ONBOARDING_VERSION,
		completedAt: now.toISOString(),
		profile: effectiveProfile,
	};

	return {
		config: next,
		requiredEnv: unique(requiredEnv),
		warnings,
		// What was actually applied (preserved settings included) — the handoff
		// must render this, never the pre-inference selection defaults.
		effective: {
			profile: effectiveProfile,
			llmChoice: effectiveSelection.llmChoice,
			llmMode: effectiveSelection.llmMode,
			llmPreset: effectiveSelection.llmPreset,
			llmBaseURL: effectiveSelection.llmBaseURL,
		},
	};
}

function assertSupportedExtractionConfig(config) {
	const extraction = config.extraction;
	if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return;
	if (Object.hasOwn(extraction, "mode")) {
		throw new Error("removed extraction selector is not accepted; use the product mode");
	}
	if (extraction.llm !== undefined && config.mode === undefined) {
		throw new Error("extraction.llm requires an explicit product mode");
	}
	if (extraction.llm !== undefined && config.mode === "local-first") {
		throw new Error("local-first cannot include extraction.llm; rerun the installer");
	}
}

function applyProfileConfig(config, profile) {
	if (profile === "manual-only") {
		config.ambientLearning = false;
		config.autoRecall = false;
		config.sessionStrategy = "none";
		return;
	}
	if (profile === "capture-only") {
		config.ambientLearning = true;
		config.autoRecall = false;
		config.sessionStrategy = "systemSessionMemory";
		return;
	}
	if (profile === "custom") return;
	config.ambientLearning = true;
	config.autoRecall = true;
	config.sessionStrategy = "systemSessionMemory";
}

function applyEmbedderConfig(config, selection, env) {
	const preset = EMBEDDER_PRESETS[selection.embedder];
	const currentDim =
		typeof config.embedding?.dimensions === "number" ? config.embedding.dimensions : undefined;
	const dbPath = resolveSqliteDbPath(config, env);
	const persistedDim = readChunkVecTableDimension(dbPath);
	const oldDim = persistedDim ?? currentDim;
	if (oldDim !== undefined && oldDim !== preset.dimensions) {
		const source = persistedDim !== undefined ? `DB on disk at ${dbPath}` : "previous config";
		throw new Error(
			`Embedding dimension switch blocked (${oldDim} -> ${preset.dimensions}, source: ${source}). Run 'openclaw sno-mem-config embedder wipe-db --confirm --force' before changing dimensions.`,
		);
	}
	config.embedding = cloneJson(preset);
}

function validateLlmCredentials(selection, env) {
	if (selection.llmMode === "off") return;
	// The subscription flavor borrows the host agent's live credential in-process; no env key exists.
	if (selection.llmChoice === "agent") return;
	const preset = selection.llmPreset ?? LLM_PRESETS.openai.preset;
	if (selection.llmBaseURL && preset !== LLM_PRESETS.sno.preset) {
		throw new Error("--llm-base-url is only supported with the Sno LLMIx preset");
	}
	if (selection.llmBaseURL) {
		if (env.SNO_MEM_CLAW_LLM_API_KEY) return;
		throw new Error("Sno custom baseURL requires SNO_MEM_CLAW_LLM_API_KEY");
	}
	const llmInfo = LLM_PRESETS[preset];
	if (env[llmInfo.requiredEnv]) return;
	if (llmInfo.alternateEnv && env[llmInfo.alternateEnv]) return;
	throw new Error(`LLM mode ${selection.llmMode} requires ${llmInfo.requiredEnv}`);
}

/** Reconstructs the effective LLM selection from an existing validated config. */
function inferExistingLlmSelection(config) {
	const preset = config.extraction?.llm?.preset;
	const llmMode =
		config.sessionStrategy === "memoryReflection" ? "extraction+reflection" : "extraction";
	if (config.mode === "agent-native" && config.agentNative?.flavor === "subscription") {
		return { llmChoice: "agent", llmMode: "extraction", llmPreset: undefined, llmBaseURL: undefined };
	}
	if (preset && LLM_PRESETS[preset]) {
		const choice =
			preset === LLM_PRESETS.sno.preset
				? "sno"
				: preset === LLM_PRESETS.openrouter.preset
					? "openrouter"
					: "openai";
		return {
			llmChoice: choice,
			llmMode,
			llmPreset: LLM_PRESETS[preset].preset,
			llmBaseURL: config.extraction?.llm?.baseURL,
		};
	}
	return { llmChoice: "off", llmMode: "off", llmPreset: undefined, llmBaseURL: undefined };
}

function applyLlmConfig(config, selection, requiredEnv) {
	if (selection.llmChoice === "off" || selection.llmMode === "off") {
		config.mode = "local-first";
		delete config.agentNative;
		delete config.extraction;
		if (config.sessionStrategy === "memoryReflection") config.sessionStrategy = "systemSessionMemory";
		return;
	}
	if (selection.llmChoice === "agent") {
		// Subscription flavor: the plugin borrows the host agent's model in-process.
		config.mode = "agent-native";
		config.agentNative = { flavor: "subscription" };
		delete config.extraction;
		if (config.sessionStrategy === "memoryReflection") config.sessionStrategy = "systemSessionMemory";
		return;
	}
	const preset = selection.llmPreset ?? LLM_PRESETS.openai.preset;
	const llmInfo = LLM_PRESETS[preset];
	requiredEnv.push(llmInfo.requiredEnv);
	if (selection.llmMode === "extraction+reflection") config.sessionStrategy = "memoryReflection";
	if (preset === LLM_PRESETS.sno.preset) {
		config.mode = "rem-enhanced";
		delete config.agentNative;
	} else {
		config.mode = "agent-native";
		config.agentNative = { flavor: "byok" };
	}
	config.extraction = {
		llm: {
			preset,
			...(selection.llmBaseURL ? { baseURL: selection.llmBaseURL } : {}),
		},
	};
}

function applyRerankConfig(config, selection, requiredEnv, warnings, env) {
	config.retrieval ??= {};
	config.retrieval.rerank = selection.rerankMode;
	if (selection.rerankMode !== "cross-encoder") {
		delete config.retrieval.rerankApiKey;
		delete config.retrieval.rerankProvider;
		delete config.retrieval.rerankModel;
		delete config.retrieval.rerankEndpoint;
		return;
	}
	const provider = RERANK_PROVIDERS[selection.rerankProvider];
	if (!env[provider.requiredEnv]) {
		config.retrieval.rerank = "lightweight";
		warnings.push(
			`Cross-encoder rerank needs ${provider.requiredEnv}; wrote lightweight rerank instead.`,
		);
		return;
	}
	requiredEnv.push(provider.requiredEnv);
	delete config.retrieval.rerankEndpoint;
	Object.assign(config.retrieval, {
		rerank: "cross-encoder",
		rerankProvider: provider.rerankProvider,
		rerankModel: provider.rerankModel,
		rerankApiKey: provider.rerankApiKey,
	});
}

function applyRecallConfig(config, selection) {
	config.retrieval ??= {};
	if (selection.recallChoice === "lean") {
		config.retrieval.recallTopK = selection.recallTopK;
	} else {
		delete config.retrieval.recallTopK;
	}
}

function normalizeLegacySessionMemory(config) {
	if (config.sessionStrategy && config.sessionMemory && typeof config.sessionMemory === "object") {
		delete config.sessionMemory.enabled;
		if (Object.keys(config.sessionMemory).length === 0) delete config.sessionMemory;
	}
}

export function readCurrentSlotFromConfig(cfg) {
	const slot = cfg?.plugins?.slots?.memory;
	if (typeof slot === "string" && slot.length > 0) return { kind: "set", plugin: slot };
	return { kind: "empty" };
}

export function applySlotConfig(cfg, { claimSlot = false } = {}) {
	const next = cloneJson(cfg ?? {});
	next.plugins ??= {};
	next.plugins.slots ??= {};
	const slot = readCurrentSlotFromConfig(next);
	if (slot.kind === "set" && slot.plugin !== PLUGIN_ID) return { config: next, status: "owned-by-other" };
	if (slot.kind === "set") return { config: next, status: "already-sno-mem-claw" };
	if (!claimSlot) return { config: next, status: "left-empty" };
	next.plugins.slots.memory = PLUGIN_ID;
	return { config: next, status: "claimed" };
}

export function formatStatus(cfgState, setupState) {
	if (cfgState.kind === "invalid") return `config invalid: ${cfgState.error.message}`;
	if (cfgState.kind === "missing") return `config missing at ${cfgState.configPath}`;
	const marker = getOnboardingMarker(cfgState.config);
	const slot = readCurrentSlotFromConfig(cfgState.config);
	return [
		`setup: ${setupState.kind}`,
		`marker: ${marker ? `v${marker.version} ${marker.profile}` : "missing"}`,
		`memory slot: ${slot.kind === "set" ? slot.plugin : "empty"}`,
	].join("\n");
}

export function buildHandoff(selection, result, slotStatus, profile) {
	const envText = result.requiredEnv.length ? result.requiredEnv.join(", ") : "none";
	// Preserved settings can make the applied configuration differ from the
	// raw selection; report what was persisted.
	const applied = result.effective ?? selection;
	return [
		`[${PLUGIN_ID}] Setup complete.`,
		`Profile: ${applied.profile}`,
		`Embedder: ${selection.embedder}`,
		`LLM: ${applied.llmMode}${applied.llmPreset ? ` (${applied.llmPreset})` : ""}`,
		`Rerank: ${selection.rerankMode}`,
		`Memory slot: ${slotStatus}`,
		`Required env: ${envText}`,
		`Restart: systemctl --user restart openclaw-gateway${profile ? `-${profile}` : ""}.service`,
		`Reconfigure: npx @snoai/mem-claw --configure`,
		...result.warnings.map((warning) => `Warning: ${warning}`),
	].join("\n");
}

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

export function resolveEnvRequirements(selection) {
	const reqs = [];
	// The subscription flavor borrows the host agent's live credential in-process — no env key.
	if (selection.llmMode !== "off" && selection.llmChoice !== "agent") {
		const preset = selection.llmPreset ?? LLM_PRESETS.openai.preset;
		if (selection.llmBaseURL) {
			reqs.push({ name: "SNO_MEM_CLAW_LLM_API_KEY", purpose: "Sno custom-baseURL LLM extraction" });
		} else {
			const llmInfo = LLM_PRESETS[preset];
			reqs.push({
				name: llmInfo.requiredEnv,
				...(llmInfo.alternateEnv ? { alternateName: llmInfo.alternateEnv } : {}),
				purpose: `LLM extraction (${preset})`,
			});
		}
	}
	if (selection.rerankMode === "cross-encoder") {
		const provider = RERANK_PROVIDERS[selection.rerankProvider];
		if (provider) {
			reqs.push({
				name: provider.requiredEnv,
				purpose: `cross-encoder rerank (${selection.rerankProvider})`,
			});
		}
	}
	const seen = new Set();
	return reqs.filter((req) => {
		if (seen.has(req.name)) return false;
		seen.add(req.name);
		return true;
	});
}

export function findUnsatisfiedRequirements(reqs, env = process.env) {
	return reqs.filter((req) => {
		if (env[req.name]?.trim()) return false;
		if (req.alternateName && env[req.alternateName]?.trim()) return false;
		return true;
	});
}

export function resolveOnboardingEnvFilePath(profile, env = process.env) {
	const configPath = resolveOpenClawConfigPath(profile, env);
	return join(dirname(configPath), PLUGIN_ID, "onboarding.env");
}

function parseEnvFile(text) {
	const out = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
	}
	return out;
}

export function readOnboardingEnvFile(envFilePath) {
	if (!existsSync(envFilePath)) return {};
	return parseEnvFile(readFileSync(envFilePath, "utf-8"));
}

export function writeOnboardingEnvFile(envFilePath, values) {
	mkdirSync(dirname(envFilePath), { recursive: true });
	const merged = { ...readOnboardingEnvFile(envFilePath), ...values };
	const body = Object.entries(merged)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	writeFileSync(envFilePath, `${body}\n`, { mode: 0o600 });
	chmodSync(envFilePath, 0o600);
}

export function resolveGatewayUnitName(profile) {
	return profile ? `openclaw-gateway-${profile}.service` : "openclaw-gateway.service";
}

export function resolveSystemdDropInPath(profile, env = process.env) {
	const home = env.HOME ?? process.env.HOME;
	if (!home) throw new Error("$HOME not set");
	const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
	const unit = resolveGatewayUnitName(profile);
	return join(configHome, "systemd", "user", `${unit}.d`, "mem-claw-onboarding.conf");
}

export function writeSystemdDropIn(dropInPath, envFilePath) {
	mkdirSync(dirname(dropInPath), { recursive: true });
	writeFileSync(dropInPath, `[Service]\nEnvironmentFile=-${envFilePath}\n`);
}

export function resolveMemClawDataDir(env = process.env) {
	const root = env.MEM_CLAW_DATA_DIR_ROOT?.trim();
	if (root) return resolve(root, "data");
	const home = env.HOME ?? process.env.HOME;
	if (!home) throw new Error("$HOME not set");
	return resolve(home, ".snoai", "sno-station-core", "mem-claw", "data");
}

export function resolveSqliteDbPath(config, env = process.env) {
	const dataDir = resolveMemClawDataDir(env);
	const manifestPath = join(dataDir, "install.json");
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		if (typeof manifest.dbPath === "string" && manifest.dbPath.length > 0) {
			return isAbsolute(manifest.dbPath) ? manifest.dbPath : join(dataDir, manifest.dbPath);
		}
	}
	const configuredPath = config?.dbPath;
	if (typeof configuredPath === "string" && isAbsolute(configuredPath)) return configuredPath;
	return join(dataDir, "mem-claw.sqlite");
}

export function readChunkVecTableDimension(dbPath) {
	if (!existsSync(dbPath)) return undefined;
	let db;
	let sql;
	try {
		const Database = require("better-sqlite3");
		db = new Database(dbPath, { readonly: true, fileMustExist: true });
		// Startup performs the namespace rename after onboarding can run. Prefer the current
		// name, but keep the pre-migration name readable until startup completes that move.
		const row = db
			.prepare(
				`SELECT sql
				 FROM sqlite_master
				 WHERE type = 'table'
				   AND name IN ('nodix_memory_chunk_vectors', 'vec_mem_claw_chunks')
				 ORDER BY CASE name WHEN 'nodix_memory_chunk_vectors' THEN 0 ELSE 1 END
				 LIMIT 1`,
			)
			.get();
		sql = row?.sql;
	} catch {
		return undefined;
	} finally {
		try {
			db?.close();
		} catch {
			// best-effort close
		}
	}
	if (!sql) return undefined;
	return parseVecTableDimension(sql);
}

export function parseVecTableDimension(sql) {
	if (!/create\s+virtual\s+table/i.test(sql) || !/using\s+vec0/i.test(sql)) {
		throw new Error(`nodix_memory_chunk_vectors exists but is not a sqlite-vec virtual table: ${sql}`);
	}
	const token = sql.match(/embedding\s+float\[(\d+)\]/i)?.[1];
	if (!token) throw new Error(`Could not parse embedding dimension from nodix_memory_chunk_vectors DDL: ${sql}`);
	const dim = Number.parseInt(token, 10);
	if (!Number.isFinite(dim) || dim <= 0) {
		throw new Error(`Invalid persisted vector dimension '${token}' in nodix_memory_chunk_vectors DDL`);
	}
	return dim;
}
