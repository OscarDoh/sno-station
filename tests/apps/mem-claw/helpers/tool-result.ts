/**
 * ClawToolResult — the actual runtime result shape returned by mem-claw tools.
 *
 * The OpenClaw SDK types `execute()` as returning `AgentToolResult<unknown>`,
 * but our plugin tools return a concrete shape with `isError`, `content`, and
 * `details`. Use `asClawResult()` to cast the opaque SDK return type to this
 * concrete structure for test assertions.
 */

export type ClawToolResult = {
	isError?: boolean;
	content: ReadonlyArray<{ type: string; text?: string }>;
	details?: Record<string, unknown>;
};

/** Cast the opaque AgentToolResult to the concrete plugin result shape. */
export function asClawResult(r: unknown): ClawToolResult {
	return r as ClawToolResult;
}

/**
 * memory_recall now returns its structured payload in details.memories and a
 * human-readable wrapper in content[0].text. Fall back to the legacy JSON text
 * payload so older fixtures can still be parsed during migration.
 */
export function getRecallMemories<T>(result: ClawToolResult): T[] {
	const detailMemories = result.details?.["memories"];
	if (Array.isArray(detailMemories)) {
		return detailMemories as T[];
	}

	const text = result.content[0]?.text ?? "[]";
	return JSON.parse(text) as T[];
}
