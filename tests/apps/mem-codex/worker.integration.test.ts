import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect, type MemoryClient } from "@snoai/sno-station-mem/client";
import { afterEach, describe, expect, it } from "vitest";
import { acquirePidFileLock } from "../../../apps/mem-codex/src/files.js";
import { importDirectory, spoolDirectory, workerLockPath } from "../../../apps/mem-codex/src/paths.js";
import { runWorker, type WorkerDependencies } from "../../../apps/mem-codex/src/worker.js";

const previousProfile = process.env.SNO_PROFILE_DIR;
const roots: string[] = [];
const sidecarPids: number[] = [];
const repoRoot = resolve(import.meta.dirname, "../../..");

const remEnhancedInstallation = {
	mode: "rem-enhanced",
	retrieval: { rerank: "none", recallTopK: 7 },
	remEnhanced: { trigger: { tick: false } },
	remOperations: ["rem-replace"],
	memoryTelemetry: { enabled: false, currentKeyVersion: 1 },
	rerankKeyRef: "SNO_STATION_MEM_RERANK_API_KEY",
	embedding: { provider: "local-onnx", dimensions: 1024, dtype: "q8" },
};

async function profile(installation: Record<string, unknown> = remEnhancedInstallation): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "mem-codex-worker-"));
	roots.push(root);
	process.env.SNO_PROFILE_DIR = root;
	await mkdir(join(root, "station"), { recursive: true });
	await writeFile(join(root, "station/sno-station-mem-tester.config.json"), JSON.stringify({
		storePath: join(root, "memory.sqlite"),
		...installation,
	}));
	return root;
}

async function spool(name: string, turnId: string): Promise<string> {
	await mkdir(spoolDirectory(), { recursive: true });
	const path = join(spoolDirectory(), name);
	await writeFile(path, JSON.stringify({ sessionId: `session-${turnId}`, turnId, project: "/repo", childCwd: "/repo", user: `user-${turnId}`, assistant: `assistant-${turnId}`, at: 1, attempts: 0, state: "pending" }));
	return path;
}

function dependencies(options: {
	failCapture?: boolean;
	failuresBeforeSuccess?: number;
	childFailure?: boolean;
	onCapture?: (turnId: string) => Promise<void>;
} = {}) {
	const captures: string[] = [];
	let captureFailures = 0;
	let now = 1_000;
	const waits: number[] = [];
	let registration: Record<string, any> | undefined;
	let callbackStatus = 0;
	let callbackBody: unknown;
	const client = {
		principal: "tester",
		async init(_scope: unknown, value: Record<string, any>) { registration = value; return { degraded: false }; },
		async capture(turn: { turnId: string }) {
			captures.push(turn.turnId);
			await options.onCapture?.(turn.turnId);
			if (options.failCapture || captureFailures < (options.failuresBeforeSuccess ?? 0)) {
				captureFailures += 1;
				throw new Error("capture-failed");
			}
			const response = await fetch(`${registration?.model.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { authorization: `Bearer ${registration?.model.credential}`, "content-type": "application/json" },
				body: JSON.stringify({ model: "codex-exec", messages: [{ role: "system", content: "system" }, { role: "user", content: turn.turnId }] }),
			});
			callbackStatus = response.status;
			callbackBody = await response.json();
			return { degraded: false, committed: response.ok, turnId: turn.turnId };
		},
	} as unknown as MemoryClient;
	const deps: WorkerDependencies = {
		async connect() { return client; },
		now: () => now,
		async sleep(delayMs) { waits.push(delayMs); now += delayMs; },
		async runChild(prompt, cwd) {
			expect(cwd).toBe("/repo");
			expect(prompt).toContain("system: system");
			return options.childFailure
				? { kind: "error", category: "transport", message: "codex-exit-9" }
				: { kind: "ok", text: `child:${prompt.split("\n").at(-1)}` };
		},
	};
	return {
		deps,
		captures,
		waits,
		get now() { return now; },
		get registration() { return registration; },
		get callbackStatus() { return callbackStatus; },
		get callbackBody() { return callbackBody; },
	};
}

afterEach(async () => {
	for (const pid of sidecarPids.splice(0)) {
		try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
	}
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("mem-codex worker", () => {
	it.each([
		[{}, "agent-native"],
		[{ mode: "local-first" }, "local-first"],
	] as const)("registers installation %j with mode %s", async (installation, mode) => {
		await profile(installation);
		await spool("0001.json", mode);
		const fixture = dependencies();

		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.registration).toMatchObject({
			routing: { mode },
			model: { model: "codex-exec" },
		});
	});

	it("holds one lock, drains in filename order, registers installed routing, and deletes only after commit", async () => {
		await profile();
		const first = await spool("0002.json", "two");
		const second = await spool("0001.json", "one");
		const third = await spool("0003.json", "three");
		const fixture = dependencies();
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.captures).toEqual(["one", "two", "three"]);
		expect(existsSync(first)).toBe(false);
		expect(existsSync(second)).toBe(false);
		expect(existsSync(third)).toBe(false);
			expect(fixture.registration).toMatchObject({
			routing: { mode: "rem-enhanced", remEnhanced: { trigger: { tick: false } } },
			settings: { retrieval: { rerank: "none", recallTopK: 7, rerankApiKey: "${SNO_STATION_MEM_RERANK_API_KEY}" }, ambientLearning: true, autoRecall: true, captureAssistant: true, observe: { enabled: false }, scopes: { default: "global" } },
			model: { model: "codex-exec" },
		});
		expect(fixture.callbackBody).toMatchObject({ choices: [{ message: { role: "assistant", content: "child:user: three" } }] });
		expect(await readdir(spoolDirectory())).toEqual([]);

	});

	it("allows only one concurrent worker", async () => {
		await profile();
		const fixture = dependencies();
		let release: (() => void) | undefined;
		const held = new Promise<void>(resolve => { release = resolve; });
		const first = runWorker({ ...fixture.deps, async connect() { await held; return fixture.deps.connect(); } });
		for (let attempt = 0; attempt < 100 && !existsSync(workerLockPath()); attempt += 1) {
			await new Promise(resolve => setTimeout(resolve, 5));
		}
		expect(existsSync(workerLockPath())).toBe(true);
		expect(await runWorker(fixture.deps)).toBe("locked");
		release?.();
		expect(await first).toBe("drained");
	});

	it("reclaims a worker lock whose recorded process is gone", async () => {
		await profile();
		await mkdir(join(workerLockPath(), ".."), { recursive: true });
		await writeFile(workerLockPath(), "2147483647\n");
		await spool("0001.json", "after-crash");
		const fixture = dependencies();

		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.captures).toEqual(["after-crash"]);
		expect(existsSync(workerLockPath())).toBe(false);
	});

	it("grants one racing lock and does not reclaim an empty fresh lock", async () => {
		const root = await profile();
		const racePath = join(root, "race.lock");
		const locks = await Promise.all([
			acquirePidFileLock(racePath, 60_000),
			acquirePidFileLock(racePath, 60_000),
		]);
		const winners = locks.filter(lock => lock !== undefined);
		expect(winners).toHaveLength(1);
		await winners[0]?.release();

		const emptyPath = join(root, "empty.lock");
		await writeFile(emptyPath, "");
		expect(await acquirePidFileLock(emptyPath, 60_000)).toBeUndefined();
		expect(await readFile(emptyPath, "utf8")).toBe("");

		const deadPath = join(root, "dead.lock");
		await writeFile(deadPath, "2147483647 1\n");
		const reclaimed = await Promise.all([
			acquirePidFileLock(deadPath, 60_000),
			acquirePidFileLock(deadPath, 60_000),
		]);
		const reclaimWinners = reclaimed.filter(lock => lock !== undefined);
		expect(reclaimWinners).toHaveLength(1);
		await reclaimWinners[0]?.release();

		const staleReclaimPath = join(root, "stale-reclaim.lock");
		await writeFile(staleReclaimPath, "2147483647 1\n");
		await writeFile(`${staleReclaimPath}.reclaim`, "2147483647 1\n");
		const afterCrash = await acquirePidFileLock(staleReclaimPath, 60_000);
		expect(afterCrash).toBeDefined();
		await afterCrash?.release();
	});

	it("hands off a record enqueued between the final scan and lock release", async () => {
		await profile();
		const fixture = dependencies();
		let queued = false;
		const deps: WorkerDependencies = {
			...fixture.deps,
			async beforeLockRelease() {
				if (queued) return;
				queued = true;
				await spool("0001.json", "handoff");
			},
			async handoff() {
				expect(await runWorker(fixture.deps)).toBe("drained");
			},
		};

		expect(await runWorker(deps)).toBe("drained");
		expect(fixture.captures).toEqual(["handoff"]);
		expect(await readdir(spoolDirectory())).toEqual([]);
	});

	it("rescans before exit and drains a record appended during capture", async () => {
		await profile();
		await spool("0001.json", "one");
		let appended = false;
		const fixture = dependencies({ async onCapture(turnId) {
			if (turnId === "one" && !appended) { appended = true; await spool("0002.json", "two"); }
		} });
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.captures).toEqual(["one", "two"]);
		expect(await readdir(spoolDirectory())).toEqual([]);
	});

	it("keeps the head record, counts three failures, and never retries a terminal record", async () => {
		await profile();
		const path = await spool("0001.json", "one");
		const fixture = dependencies({ failCapture: true });
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ attempts: 3, state: "failed" });
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.captures).toEqual(["one", "one", "one"]);
	});

	it("commits the next record after the first exhausts its retries", async () => {
		await profile();
		const first = await spool("0001.json", "one");
		const second = await spool("0002.json", "two");
		const fixture = dependencies({ async onCapture(turnId) {
			if (turnId === "one") throw new Error("capture-failed");
		} });

		await runWorker(fixture.deps);

		expect(JSON.parse(await readFile(first, "utf8"))).toMatchObject({ attempts: 3, state: "failed" });
		expect(existsSync(second)).toBe(false);
	});

	it("persists retry deadlines and waits before the second and third attempts", async () => {
		await profile();
		const path = await spool("0001.json", "one");
		const observed: Array<{ attempts: number; retryAt: number }> = [];
		const fixture = dependencies({ failuresBeforeSuccess: 2 });
		let now = 1_000;
		fixture.deps.now = () => now;
		fixture.deps.sleep = async delayMs => {
			const record = JSON.parse(await readFile(path, "utf8"));
			observed.push({ attempts: record.attempts, retryAt: record.retryAt });
			fixture.waits.push(delayMs);
			now += delayMs;
		};

		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(observed).toEqual([
			{ attempts: 1, retryAt: 3_000 },
			{ attempts: 2, retryAt: 13_000 },
		]);
		expect(fixture.waits.slice(-2)).toEqual([2_000, 10_000]);
		expect(fixture.captures).toEqual(["one", "one", "one"]);
		expect(existsSync(path)).toBe(false);
	});

	it("relays a typed child transport failure with HTTP 503 and keeps the record", async () => {
		await profile();
		const path = await spool("0001.json", "one");
		const fixture = dependencies({ childFailure: true });
		expect(await runWorker(fixture.deps)).toBe("drained");
		expect(fixture.callbackStatus).toBe(503);
		expect(fixture.callbackBody).toEqual({ error: { kind: "error", category: "transport", message: "codex-exit-9" } });
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ attempts: 3, state: "failed" });
	});

	it("paces consecutive import children and records committed blocks", async () => {
		await profile();
		await mkdir(importDirectory(), { recursive: true });
		const receiptPath = join(importDirectory(), "receipt.json");
		await writeFile(receiptPath, JSON.stringify({ files: { "/note.md": { committed: 0, failures: 0 } } }));
		for (const [name, turn] of [["0001.json", "one"], ["0002.json", "two"]] as const) {
			const path = await spool(name, turn);
			const record = JSON.parse(await readFile(path, "utf8"));
			delete record.assistant;
			record.kind = "import";
			record.importReceipt = { path: receiptPath, file: "/note.md" };
			await writeFile(path, JSON.stringify(record));
		}
		const starts: number[] = [];
		const fixture = dependencies();
		const deps = { ...fixture.deps, async runChild() { starts.push(Date.now()); return { kind: "ok" as const, text: "ok" }; } };
		expect(await runWorker(deps)).toBe("drained");
		expect(starts).toHaveLength(2);
		expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(2_000);
		expect(JSON.parse(await readFile(receiptPath, "utf8")).files["/note.md"]).toMatchObject({ committed: 2, failures: 0 });
	}, 10_000);

	it("registers and captures through a real sidecar in a temporary profile", async () => {
		const root = await profile();
		const bind = spawnSync(process.execPath, [join(repoRoot, "packages/sno-station-mem/dist/cli.js"), "bind", join(root, "memory.sqlite")], {
			encoding: "utf8",
			env: { ...process.env, SNO_PROFILE_DIR: root, SNO_STATION_CORE_TESTING: "1" },
			input: JSON.stringify({ mode: "agent-native", retrieval: { rerank: "none" }, embedding: { provider: "local-onnx", dimensions: 1024, dtype: "q8" }, memoryTelemetry: { enabled: false, currentKeyVersion: 1 } }),
			timeout: 20_000,
		});
		expect(bind.status, bind.stderr).toBe(0);
		await spool("0001.json", "real-sidecar");
		const prompts: string[] = [];
		const deps: WorkerDependencies = {
			async connect() {
				const client = await connect({ skinId: "codex" });
				if (client.degraded) throw new Error(client.reason);
				sidecarPids.push(client.pid);
				return client;
			},
			async runChild(prompt) {
				prompts.push(prompt);
				return { kind: "ok", text: '{"claims_found":[],"decisions":[{"turn_index":0,"progress_only":false}],"facts":[]}' };
			},
		};
		expect(await runWorker(deps), prompts.join("\n---\n")).toBe("drained");
		expect(await readdir(spoolDirectory())).toEqual([]);
		const discovery = JSON.parse(await readFile(join(root, "station/sidecar.json"), "utf8"));
		expect(discovery.pid).toBe(sidecarPids.at(-1));
		expect((await fetch(`http://127.0.0.1:${discovery.port}/healthz`)).status).toBe(200);
	}, 30_000);
});
