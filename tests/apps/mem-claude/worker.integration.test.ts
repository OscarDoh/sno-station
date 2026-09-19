import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { connect, type MemoryClient, type Registration } from "@snoai/sno-station-mem/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquirePidFileLock } from "../../../apps/mem-claude/src/files.js";
import { spoolDirectory, workerLockPath } from "../../../apps/mem-claude/src/paths.js";
import { runWorker, type WorkerDependencies } from "../../../apps/mem-claude/src/worker.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const extraction = '{"claims_found":[],"decisions":[{"turn_index":0,"progress_only":false}],"facts":[]}';
let root: string;
let client: MemoryClient;
let previousProfile: string | undefined;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mem-claude-worker-"));
	previousProfile = process.env.SNO_PROFILE_DIR;
	process.env.SNO_PROFILE_DIR = root;
	const bind = spawnSync(process.execPath, [join(repoRoot, "packages/sno-station-mem/dist/cli.js"), "bind", join(root, "memory.sqlite")], {
		encoding: "utf8", timeout: 20_000,
		env: { ...process.env, SNO_STATION_CORE_TESTING: "1" },
		input: JSON.stringify({ mode: "agent-native", retrieval: { rerank: "none", recallTopK: 7 },
			embedding: { provider: "local-onnx", dimensions: 1024, dtype: "q8" },
			memoryTelemetry: { enabled: false, currentKeyVersion: 1 } }),
	});
	expect(bind.status, bind.stderr).toBe(0);
	const connected = await connect({ skinId: "claude-code" });
	if (connected.degraded) throw new Error(connected.reason);
	client = connected;
}, 30_000);

afterEach(async () => {
	if (client) {
		try { process.kill(client.pid, "SIGTERM"); }
		catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
	}
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	await rm(root, { recursive: true, force: true });
});

async function spool(name: string, turnId: string, at = Date.now()): Promise<string> {
	await mkdir(spoolDirectory(), { recursive: true });
	const path = join(spoolDirectory(), name);
	await writeFile(path, JSON.stringify({ sessionId: `session-${turnId}`, turnId, project: root,
		childCwd: root, user: `The probe for turn ${turnId} has no durable facts.`,
		assistant: "Acknowledged.", at, attempts: 0, state: "pending" }));
	return path;
}

function observeClient() {
	const captures: Array<{ turnId: string; at: number; committed?: boolean }> = [];
	let registration: Registration | undefined;
	const originalInit = client.init.bind(client);
	const originalCapture = client.capture.bind(client);
	client.init = async (scope, value) => {
		registration = value;
		return originalInit(scope, value);
	};
	client.capture = async (turn, scope) => {
		const record: (typeof captures)[number] = { turnId: turn.turnId, at: Date.now() };
		captures.push(record);
		const result = await originalCapture(turn, scope);
		record.committed = !result.degraded && result.committed;
		return result;
	};
	const deps: WorkerDependencies = {
		async connect() { return client; },
		async runChild(_prompt, cwd) {
			expect(cwd).toBe(join(root, "sno-mem-claude", "child"));
			return { kind: "ok", text: extraction };
		},
	};
	return { captures, deps, get registration() { return registration; } };
}

describe("Claude worker with a real sidecar", () => {
	it("admits one concurrent worker, registers installed routing, and drains three files in order", async () => {
		await spool("0002.json", "two");
		await spool("0001.json", "one");
		await spool("0003.json", "three");
		const fixture = observeClient();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const first = runWorker({ ...fixture.deps, async connect() {
			entered.resolve();
			await release.promise;
			return client;
		} });
		await entered.promise;
		try {
			expect(existsSync(workerLockPath())).toBe(true);
			expect(await runWorker(fixture.deps)).toBe("locked");
		} finally { release.resolve(); }
		expect(await first).toBe("drained");
		expect(fixture.captures.map(item => item.turnId)).toEqual(["one", "two", "three"]);
		expect(fixture.captures.every(item => item.committed === true)).toBe(true);
		expect(await readdir(spoolDirectory())).toEqual([]);
		expect(fixture.registration).toMatchObject({
			skinId: "claude-code", routing: { mode: "agent-native" },
			settings: { retrieval: { rerank: "none", recallTopK: 7 } }, model: { model: "claude-exec" },
		});
		const health = await fetch(`http://127.0.0.1:${client.port}/healthz`);
		expect(health.status).toBe(200);
		expect((await health.json()).status).toBe("ok");
		expect(existsSync(workerLockPath())).toBe(false);
	}, 90_000);

	it("reclaims a dead lock and drains a record arriving as the lock is released", async () => {
		await mkdir(dirname(workerLockPath()), { recursive: true });
		await writeFile(workerLockPath(), "2147483647 1\n");
		await spool("0001.json", "after-crash");
		const fixture = observeClient();
		let queued = false;
		await runWorker({ ...fixture.deps,
			async beforeLockRelease() {
				if (queued) return;
				queued = true;
				await spool("0002.json", "handoff");
			},
			async handoff() { expect(await runWorker(fixture.deps)).toBe("drained"); },
		});
		expect(fixture.captures.map(item => item.turnId)).toEqual(["after-crash", "handoff"]);
		expect(fixture.captures.every(item => item.committed === true)).toBe(true);
		expect(await readdir(spoolDirectory())).toEqual([]);
		expect(existsSync(workerLockPath())).toBe(false);
	}, 90_000);

	it("keeps a real rejected capture after three attempts spaced by two and ten seconds", async () => {
		// The sidecar contract rejects a negative message timestamp over the real HTTP route.
		const path = await spool("0001.json", "invalid-timestamp", -1);
		const fixture = observeClient();
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ attempts: 3, state: "failed" });
		expect(fixture.captures).toHaveLength(3);
		const [first, second, third] = fixture.captures;
		if (!first || !second || !third) throw new Error("three capture observations are required");
		expect(second.at - first.at).toBeGreaterThanOrEqual(2_000);
		expect(third.at - second.at).toBeGreaterThanOrEqual(10_000);
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.captures).toHaveLength(3);
	}, 30_000);

	it("paces real import callback requests while serving text and typed HTTP 503 errors", async () => {
		const path = await spool("0001.json", "callback");
		const record = JSON.parse(await readFile(path, "utf8"));
		record.kind = "import";
		delete record.assistant;
		await writeFile(path, JSON.stringify(record));
		const fixture = observeClient();
		const childStarts: number[] = [];
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const capture = client.capture.bind(client);
		client.capture = async (turn, scope) => { entered.resolve(); await release.promise; return capture(turn, scope); };
		const worker = runWorker({ ...fixture.deps, async runChild(prompt) {
			childStarts.push(Date.now());
			if (prompt.includes("CHILD_FAILURE_PROBE")) return { kind: "error", category: "transport", message: "child-exit-1" };
			return { kind: "ok", text: prompt.includes("CALLBACK_PROBE") ? "child answer" : extraction };
		} });
		await entered.promise;
		try {
			const model = fixture.registration?.model;
			if (!model) throw new Error("worker registration missing model");
			for (const [text, status] of [["CALLBACK_PROBE", 200], ["CHILD_FAILURE_PROBE", 503]] as const) {
				const response = await fetch(`${model.baseUrl}/chat/completions`, {
					method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${model.credential}` },
					body: JSON.stringify({ model: "claude-exec", messages: [{ role: "system", content: "system" }, { role: "user", content: text }] }),
				});
				expect(response.status).toBe(status);
				expect(await response.json()).toEqual(status === 200
					? { choices: [{ message: { role: "assistant", content: "child answer" } }] }
					: { error: { kind: "error", category: "transport", message: "child-exit-1" } });
			}
			expect(childStarts).toHaveLength(2);
			const [first, second] = childStarts;
			if (first === undefined || second === undefined) throw new Error("two child starts are required");
			expect(second - first).toBeGreaterThanOrEqual(2_000);
		} finally { release.resolve(); }
		expect(await worker).toBe("drained");
	}, 60_000);

	it.each(["exit-1", "is-error"])("relays an actual %s stub child through the production worker", async failure => {
		await spool("0001.json", `child-${failure}`);
		const bin = join(root, "bin");
		await mkdir(bin);
		const claude = join(bin, "claude");
		await writeFile(claude, `#!${process.execPath}\n${failure === "exit-1"
			? "process.exit(1);"
			: 'console.log(JSON.stringify({is_error:true,result:"refused",usage:{cache_creation_input_tokens:0}}));'}\n`);
		await chmod(claude, 0o700);
		const run = spawnSync(process.execPath, ["--import", "tsx", "apps/mem-claude/src/cli.ts", "worker"], {
			cwd: repoRoot, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
			encoding: "utf8", timeout: 90_000,
		});
		expect(run.status, run.stderr).toBe(0);
		expect(run.stdout).toMatch(/"event":"model-callback","model":"claude-exec","status":503/);
	}, 100_000);
});

describe("worker lock files", () => {
	it("admits one racer and recovers when a reclaim marker's owner is dead", async () => {
		const path = join(root, "race.lock");
		const locks = await Promise.all([acquirePidFileLock(path, 60_000), acquirePidFileLock(path, 60_000)]);
		const winners = locks.filter(lock => lock !== undefined);
		expect(winners).toHaveLength(1);
		await winners[0]?.release();
		await writeFile(path, "2147483647 1\n");
		await writeFile(`${path}.reclaim`, "2147483647 1\n");
		const reclaimed = await acquirePidFileLock(path, 60_000);
		expect(reclaimed).toBeDefined();
		await reclaimed?.release();
	});
});
