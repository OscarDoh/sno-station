import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { pluginConfigSchema } from "../../../../packages/sno-station-mem/config/plugin-config-schema.ts";

const cli = resolve(import.meta.dirname, "../../../../packages/sno-station-mem/dist/cli.js");
const ownedProfiles = new Map<string, string>();
const discoverySchema = z.object({ pid: z.number().int().positive() });
const bindingSchema = z.object({ principal: z.string(), storePath: z.string() });

/** Use the same installation command and immutable store binding as a real host. */
export function bindTestMemory(profileRoot: string, dbPath: string, input: unknown): void {
	const bindingPath = join(profileRoot, "station", `sno-station-mem-${userInfo().username}.binding.json`);
	if (existsSync(bindingPath)) {
		const binding = bindingSchema.parse(JSON.parse(readFileSync(bindingPath, "utf8")));
		if (binding.principal !== userInfo().username || binding.storePath !== resolve(dbPath)) {
			throw new Error(`test profile is already bound to another store: ${profileRoot}`);
		}
	} else {
		const config = pluginConfigSchema.parse(input);
		execFileSync(process.execPath, [cli, "bind", dbPath], {
			env: { ...process.env, SNO_PROFILE_DIR: profileRoot },
			input: JSON.stringify({
				mode: config.mode,
				embedding: config.embedding,
				retrieval: config.retrieval,
				memoryTelemetry: config.memoryTelemetry,
				autoRecallTimeoutMs: config.autoRecallTimeoutMs,
				remOperations: config.remOperations,
				remEnhanced: config.remEnhanced,
			}),
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 20_000,
		});
	}
	ownedProfiles.set(profileRoot, resolve(dbPath));
}

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
		throw error;
	}
}

/** Synchronous fixture cleanup must stop the daemon before its SQLite files are removed. */
export function stopTestMemory(dbPath?: string): void {
	for (const [profileRoot, storePath] of ownedProfiles) {
		if (dbPath !== undefined && storePath !== resolve(dbPath)) continue;
		const discoveryPath = join(profileRoot, "station", "sidecar.json");
		if (existsSync(discoveryPath)) {
			const { pid } = discoverySchema.parse(JSON.parse(readFileSync(discoveryPath, "utf8")));
			if (alive(pid)) {
				const environment = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
				if (!environment.includes(`SNO_PROFILE_DIR=${profileRoot}`)) {
					throw new Error(`refusing to stop a foreign sidecar: ${pid}`);
				}
				process.kill(pid, "SIGTERM");
				const deadline = Date.now() + 10_000;
				const sleeper = new Int32Array(new SharedArrayBuffer(4));
				while (alive(pid) && Date.now() < deadline) Atomics.wait(sleeper, 0, 0, 20);
				if (alive(pid)) throw new Error(`owned test sidecar did not stop: ${pid}`);
			}
		}
		ownedProfiles.delete(profileRoot);
	}
}
