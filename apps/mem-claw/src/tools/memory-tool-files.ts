/** @file memory-tool-files.ts
 * @purpose Resolves safe workspace paths and serializes learning-file writes.
 * @boundary Filesystem safety helpers for self-improvement tools.
 */

import {
	basename,
	dirname,
	SnoStationMemError,
	existsSync,
	homedir,
	join,
	Mutex,
	readFile,
	realpathSync,
	resolve,
	sep,
} from "./memory-tool-dependencies";

export function pathIsWithin(basePath: string, candidatePath: string): boolean {
	// Centralize the tool execution fallback value at the boundary of this helper.
	return candidatePath === basePath || candidatePath.startsWith(`${basePath}${sep}`);
}

export function realpathNativeOrSync(targetPath: string): string {
	// Centralize the tool execution fallback value at the boundary of this helper.
	return typeof realpathSync.native === "function"
		? realpathSync.native(targetPath)
		: realpathSync(targetPath);
}

export function validateWorkspacePath(candidate: string): string {
	const resolved = resolve(candidate);
	// Compute the normalized home once so later tool execution checks use one value.
	const home = realpathNativeOrSync(homedir());

	// Isolate the tool execution operation that can fail because of runtime I/O or input shape.
	try {
		// Compute the normalized real resolved once so later tool execution checks use one value.
		const realResolved = realpathNativeOrSync(resolved);
		// Keep identity and boundary checks ahead of any privileged operation.
		if (!pathIsWithin(home, realResolved)) {
			// Surface this invalid tool execution state as an explicit typed failure.
			throw new SnoStationMemError(
				"invalid_workspace",
				`Workspace path escapes user home directory: ${candidate}`,
			);
		}
		// Centralize the tool execution fallback value at the boundary of this helper.
		return realResolved;
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		// Guard err.code here so the remaining tool execution path works with normalized inputs.
		if (err.code !== "ENOENT") {
			// Surface this invalid tool execution state as an explicit typed failure.
			throw error;
		}
	}

	const suffixParts: string[] = [];
	let current = resolved;
	while (!existsSync(current)) {
		const parent = dirname(current);
		// Guard parent here so the remaining tool execution path works with normalized inputs.
		if (parent === current) {
			// Surface this invalid tool execution state as an explicit typed failure.
			throw new SnoStationMemError(
				"invalid_workspace",
				`Workspace path escapes user home directory: ${candidate}`,
			);
		}
		suffixParts.unshift(basename(current));
		current = parent;
	}

	// Compute the normalized real existing once so later tool execution checks use one value.
	const realExisting = realpathNativeOrSync(current);
	const rebuilt = resolve(realExisting, ...suffixParts);
	// Keep identity and boundary checks ahead of any privileged operation.
	if (!pathIsWithin(home, rebuilt)) {
		// Surface this invalid tool execution state as an explicit typed failure.
		throw new SnoStationMemError(
			"invalid_workspace",
			`Workspace path escapes user home directory: ${candidate}`,
		);
	}
	// Centralize the tool execution fallback value at the boundary of this helper.
	return rebuilt;
}

export function resolveWorkspaceDir(toolCtx: unknown, fallback?: string): string {
	const runtime = toolCtx as Record<string, unknown> | undefined;
	const runtimePath = typeof runtime?.workspaceDir === "string" ? runtime.workspaceDir.trim() : "";
	// Guard this branch early so the remaining tool execution path works with normalized inputs.
	if (runtimePath) return validateWorkspacePath(runtimePath);
	// Guard this branch early so the remaining tool execution path works with normalized inputs.
	if (fallback?.trim()) return validateWorkspacePath(fallback);
	// Centralize the tool execution fallback value at the boundary of this helper.
	return join(homedir(), ".openclaw", "workspace");
}

export function todayYmd(): string {
	// Centralize the tool execution fallback value at the boundary of this helper.
	return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

export function escapeRegExp(input: string): string {
	// Centralize the tool execution fallback value at the boundary of this helper.
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type FileWriteMutexEntry = {
	mutex: Mutex;
	pendingUsers: number;
};
export const fileWriteMutexes: Map<string, FileWriteMutexEntry> = new Map<string, FileWriteMutexEntry>();

export function acquireFileWriteMutex(filePath: string): FileWriteMutexEntry {
	let entry = fileWriteMutexes.get(filePath);
	// Isolate the tool execution operation that can fail because of runtime I/O or input shape.
	if (!entry) {
		entry = {
			mutex: new Mutex(),
			pendingUsers: 0,
		};
		fileWriteMutexes.set(filePath, entry);
	}
	entry.pendingUsers += 1;
	// Isolate the tool execution operation that can fail because of runtime I/O or input shape.
	return entry;
}

export async function withFileWriteQueue<T>(
	filePath: string,
	action: () => Promise<T>,
): Promise<T> {
	const entry = acquireFileWriteMutex(filePath);
	// Isolate the tool execution operation that can fail because of runtime I/O or input shape.
	try {
		// Await the tool execution dependency before deriving downstream state.
		return await entry.mutex.runExclusive(action);
	} finally {
		entry.pendingUsers = Math.max(0, entry.pendingUsers - 1);
		// Guard this branch early so the remaining tool execution path works with normalized inputs.
		if (
			entry.pendingUsers === 0 &&
			!entry.mutex.isLocked() &&
			fileWriteMutexes.get(filePath) === entry
		) {
			fileWriteMutexes.delete(filePath);
		}
	}
}

export async function nextLearningId(
	filePath: string,
	prefix: "LRN" | "ERR" | "FEAT",
): Promise<string> {
	const date = todayYmd();
	let maxSuffix = 0;
	// Isolate the tool execution operation that can fail because of runtime I/O or input shape.
	try {
		// Await the tool execution dependency before deriving downstream state.
		const content = await readFile(filePath, "utf-8");
		const re = new RegExp(`\\[${prefix}-${date}-(\\d{3})\\]`, "g");
		// Iterate deterministically so tool execution output order remains stable.
		for (const m of content.matchAll(re)) {
			const n = Number.parseInt(m[1] ?? "0", 10);
			// Guard this branch early so the remaining tool execution path works with normalized inputs.
			if (Number.isFinite(n) && n > maxSuffix) maxSuffix = n;
		}
	} catch {
		// A missing file means this is the first entry for the day.
	}
	// Centralize the tool execution fallback value at the boundary of this helper.
	return `${prefix}-${date}-${String(maxSuffix + 1).padStart(3, "0")}`;
}
