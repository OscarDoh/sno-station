import { readJsonFile } from "./fs-utils.js";
import { uint64HashModulo } from "./hash.js";
import { getSnoProfileDir, type PathEnv } from "./paths.js";

interface SamplingConfig {
	tools?: {
		always?: string[];
		sample?: string[];
		off?: string[];
		sampleRate?: number;
	};
}

const defaultAlways = [
	"write",
	"delete",
	"bash",
	"exec",
	"curl",
	"fetch",
	"mcp",
	"permission",
	"git push",
];
const defaultOff: string[] = [];
const TOOLS_ALWAYS_ENV = "SNO_OBSERVE_TOOLS_ALWAYS";
const TOOLS_OFF_ENV = "SNO_OBSERVE_TOOLS_OFF";
const TOOL_SAMPLE_RATE_ENV = "SNO_OBSERVE_TOOL_SAMPLE_RATE";

export function shouldSampleTool(
	eventId: string,
	toolName = "",
	rate = 20,
	env: PathEnv & Record<string, string | undefined> = process.env,
): boolean {
	const config = readSamplingConfig(env);
	const normalized = toolName.toLowerCase();
	const always = csv(env[TOOLS_ALWAYS_ENV]) ?? config.tools?.always ?? defaultAlways;
	const off = csv(env[TOOLS_OFF_ENV]) ?? config.tools?.off ?? defaultOff;
	const sampleRate = Number(env[TOOL_SAMPLE_RATE_ENV] ?? config.tools?.sampleRate ?? rate);
	if (matchesTier(normalized, off)) {
		return false;
	}
	if (matchesTier(normalized, always)) {
		return true;
	}
	// sampleRate === 0 is an explicit opt-out: skip sampling entirely instead of
	// silently substituting the default denominator (~5%).
	if (Number.isFinite(sampleRate) && sampleRate === 0) {
		return false;
	}
	const denominator = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : 20;
	return uint64HashModulo(eventId, denominator) === 0;
}

function readSamplingConfig(env: PathEnv): SamplingConfig {
	return readJsonFile<SamplingConfig>(`${getSnoProfileDir(env)}/config.json`) ?? {};
}

function matchesTier(toolName: string, tier: string[]): boolean {
	return tier.some((entry) => toolName.includes(entry.toLowerCase()));
}

function csv(value: string | undefined): string[] | null {
	if (value === undefined) {
		return null;
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}
