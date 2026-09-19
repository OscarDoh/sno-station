import {
	HOST_MODEL_CALLBACK_HOST,
	HOST_MODEL_CALLBACK_PATH,
} from "@snoai/sno-station-mem/internal/config/skin-defaults";

export const APP_NAME: "sno-mem-claw" = "sno-mem-claw";
export const APP_DISPLAY_NAME: "Sno Memory for OpenClaw" = "Sno Memory for OpenClaw";
export const APP_DESCRIPTION: "SQLite + sqlite-vec long-term memory plugin" =
	"SQLite + sqlite-vec long-term memory plugin";
export const SKIN_ID: "mem-claw" = "mem-claw";
export const OPERATOR_SKIN_ID: "mem-claw-operator" = "mem-claw-operator";

export const HOST_REGISTRATION_SESSION_ID: "host-registration" = "host-registration";
export const HOST_COMMAND_SESSION_ID: "host-command" = "host-command";
export const HOST_MODEL_ID: "host-agent" = "host-agent";

export const MODEL_CALLBACK: {
	readonly host: typeof HOST_MODEL_CALLBACK_HOST;
	readonly path: typeof HOST_MODEL_CALLBACK_PATH;
	readonly maxBodyBytes: number;
	readonly timeoutMs: number;
} = {
	host: HOST_MODEL_CALLBACK_HOST,
	path: HOST_MODEL_CALLBACK_PATH,
	maxBodyBytes: 8 * 1024 * 1024,
	timeoutMs: 120_000,
} as const;

export const MEMORY_SUBCOMMANDS: readonly ["stats", "status", "clear", "search"] = [
	"stats",
	"status",
	"clear",
	"search",
];
export const MINIMUM_CONVERSATION_GATE_VERSION: readonly [2026, 6, 9] = [2026, 6, 9];

export const SELF_UPGRADE: {
	readonly manifestUrl: string;
	readonly manifestTimeoutMs: number;
	readonly downloadTimeoutMs: number;
	readonly smokeTimeoutMs: number;
	readonly stageRetentionMs: number;
	readonly npmRegistryHostname: string;
} = {
	manifestUrl: "https://www.sno.ai/api/v1/plugins/mem-claw/manifest.json",
	manifestTimeoutMs: 3_000,
	downloadTimeoutMs: 60_000,
	smokeTimeoutMs: 10_000,
	stageRetentionMs: 60 * 60 * 1_000,
	npmRegistryHostname: "registry.npmjs.org",
} as const;
