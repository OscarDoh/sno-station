/** Real LLM API required. No mocking. Missing keys = FAIL. */

/**
 * Environment helpers for mem-claw test suite.
 * No conditional skips. Missing keys throw immediately.
 */

export function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(
			`[mem-claw tests] Required environment variable '${key}' is not set. ` +
				`Tests require real API credentials. Set ${key} and re-run.`,
		);
	}
	return value;
}

export function requireOpenRouterKey(): string {
	return requireEnv("OPENROUTER_API_KEY");
}

export function requireVoyageApiKey(): string {
	return requireEnv("MEM_CLAW_EMBEDDING_API_KEY");
}
