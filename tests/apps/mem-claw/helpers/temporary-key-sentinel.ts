import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
	basename,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";

const ownedTemporaryRoots = new Set<string>();

function assertOwnedTemporaryRoot(root: string): string {
	const candidate = resolve(root);
	const temporaryDirectory = resolve(tmpdir());
	const relativeCandidate = relative(temporaryDirectory, candidate);
	if (
		!relativeCandidate ||
		relativeCandidate === ".." ||
		relativeCandidate.startsWith(`..${sep}`) ||
		isAbsolute(relativeCandidate)
	) {
		throw new Error(`refusing non-temporary test root: ${candidate}`);
	}
	return candidate;
}

function findKeyArtifact(root: string): string | undefined {
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (!directory || !existsSync(directory)) continue;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = join(directory, entry.name);
			if (
				entry.name === "key" &&
				basename(directory) === "sno-station-core"
			) {
				return entryPath;
			}
			if (entry.isDirectory()) pending.push(entryPath);
		}
	}
	return undefined;
}

export function registerOwnedTemporaryRoot(root: string): void {
	ownedTemporaryRoots.add(assertOwnedTemporaryRoot(root));
}

export function releaseOwnedTemporaryRoot(root: string): void {
	const ownedRoot = assertOwnedTemporaryRoot(root);
	if (!ownedTemporaryRoots.has(ownedRoot)) {
		throw new Error(`refusing unowned temporary test root: ${ownedRoot}`);
	}
	let sentinelError: Error | undefined;
	const keyArtifact = findKeyArtifact(ownedRoot);
	if (keyArtifact) {
		sentinelError = new Error(
			`temporary sno-station-core/key artifact detected at ${keyArtifact}`,
		);
	}

	let cleanupError: unknown;
	try {
		rmSync(ownedRoot, { recursive: true, force: true });
	} catch (error) {
		cleanupError = error;
	} finally {
		ownedTemporaryRoots.delete(ownedRoot);
	}
	if (sentinelError) throw sentinelError;
	if (cleanupError) throw cleanupError;
}

export function releaseAllOwnedTemporaryRoots(): void {
	let firstError: unknown;
	for (const root of [...ownedTemporaryRoots]) {
		try {
			releaseOwnedTemporaryRoot(root);
		} catch (error) {
			firstError ??= error;
		}
	}
	if (firstError) throw firstError;
}
