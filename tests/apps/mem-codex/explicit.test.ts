import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = {
	principal: "lh",
	getRecall: vi.fn(),
	inspect: vi.fn(),
	mutate: vi.fn(),
};

vi.mock("../../../apps/mem-codex/src/memory-client.js", () => ({
	connectMemory: async () => client,
	isDegradedConnection: () => false,
}));
vi.mock("../../../apps/mem-codex/src/scope.js", () => ({
	repositoryRoot: async () => "/repo",
	manualScope: (project: string) => ({ principal: "lh", project, readable: [project, "global"], session: "explicit" }),
}));

const { correctCommand, getCommand, recallCommand, rememberCommand } = await import("../../../apps/mem-codex/src/explicit.js");

const previousProfile = process.env.SNO_PROFILE_DIR;
const profiles: string[] = [];

beforeEach(async () => {
	vi.clearAllMocks();
	const profile = await mkdtemp(join(tmpdir(), "mem-codex-explicit-"));
	profiles.push(profile);
	process.env.SNO_PROFILE_DIR = profile;
});

afterEach(async () => {
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	await Promise.all(profiles.splice(0).map(profile => rm(profile, { recursive: true, force: true })));
});

describe("explicit memory commands", () => {
	it("recalls five manual hits from repository and global scope with id, line, and body", async () => {
		client.getRecall.mockResolvedValue({ degraded: false, toolResult: { details: { memories: [{ id: "m1", text: "The durable full body remains available." }] } } });
		const result = await recallCommand("durable body");
		expect(client.getRecall).toHaveBeenCalledWith("durable body", { principal: "lh", project: "/repo", readable: ["/repo", "global"], session: "explicit" }, { source: "manual", limit: 5, includeMetadata: true });
		expect(result).toEqual({ ok: true, text: "m1\tThe durable full body remains available. [id:m1]\nThe durable full body remains available." });
	});

	it("gets one full entry", async () => {
		client.inspect.mockResolvedValue({ degraded: false, result: { op: "get", entry: { id: "m1", text: "full entry" } } });
		expect(await getCommand("m1")).toEqual({ ok: true, text: "m1\nfull entry" });
		expect(client.inspect).toHaveBeenCalledWith({ op: "get", id: "m1" }, expect.objectContaining({ readable: ["/repo", "global"] }));
	});

	it("stores an episodic memory and corrects by linking a new card without deletion", async () => {
		client.mutate
			.mockResolvedValueOnce({ degraded: false, result: { op: "store", details: { id: "m1" } } })
			.mockResolvedValueOnce({ degraded: false, result: { op: "update", details: {} } })
			.mockResolvedValueOnce({ degraded: false, result: { op: "store", details: { id: "m2" } } })
			.mockResolvedValueOnce({ degraded: false, result: { op: "update", details: {} } });
		expect(await rememberCommand("remember this")).toEqual({ ok: true, text: "m1" });
		client.inspect.mockResolvedValueOnce({ degraded: false, result: { op: "get", entry: { id: "m1", text: "old text", category: "episodic", metadata: { source: "test" } } } });
		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: true, text: "m2" });
		expect(client.mutate.mock.calls.map(call => call[0])).toEqual([
			{ op: "store", content: "remember this", category: "episodic" },
			expect.objectContaining({ op: "update", id: "m1", metadata: expect.objectContaining({ source: "test", supersededBy: expect.stringMatching(/^pending:/) }) }),
			expect.objectContaining({
				op: "store",
				content: "corrected text",
				category: "episodic",
				metadata: { correctionOf: "m1", correctionNonce: expect.any(String) },
			}),
			expect.objectContaining({ op: "update", id: "m1", metadata: expect.objectContaining({ source: "test", supersededBy: "m2" }) }),
		]);
	});

	it("refuses a concurrent correction while one successor is being stored", async () => {
		client.inspect.mockResolvedValue({ degraded: false, result: { op: "get", entry: { id: "m1", text: "old", category: "episodic", metadata: {} } } });
		let releaseStore: ((value: unknown) => void) | undefined;
		let storeStarted: (() => void) | undefined;
		const started = new Promise<void>(resolve => { storeStarted = resolve; });
		client.mutate.mockImplementation(async (operation: Record<string, unknown>) => {
			if (operation.op === "store") {
				storeStarted?.();
				return await new Promise(resolve => { releaseStore = resolve; });
			}
			return { degraded: false, result: { op: "update", details: {} } };
		});

		const first = correctCommand("m1", "first correction");
		await started;
		const second = await correctCommand("m1", "second correction");
		expect(second).toEqual({ ok: false, text: "correction-in-progress" });
		releaseStore?.({ degraded: false, result: { op: "store", details: { id: "m2" } } });
		expect(await first).toEqual({ ok: true, text: "m2" });
		expect(client.mutate.mock.calls.filter(call => call[0].op === "store")).toHaveLength(1);
	});

	it("reuses the persisted successor when the final pointer update is retried", async () => {
		let marker = "";
		let inspection = 0;
		let stores = 0;
		let finalUpdates = 0;
		client.inspect.mockImplementation(async () => ({
			degraded: false,
			result: {
				op: "get",
				entry: {
					id: "m1",
					text: "old",
					category: "episodic",
					metadata: inspection++ === 0 ? {} : { supersededBy: marker },
				},
			},
		}));
		client.mutate.mockImplementation(async (operation: Record<string, any>) => {
			if (operation.op === "store") {
				stores += 1;
				return { degraded: false, result: { op: "store", details: { id: "m2" } } };
			}
			if (typeof operation.metadata?.supersededBy === "string" && operation.metadata.supersededBy.startsWith("pending:")) {
				marker = operation.metadata.supersededBy;
				return { degraded: false, result: { op: "update", details: {} } };
			}
			finalUpdates += 1;
			return finalUpdates === 1
				? { degraded: false, result: { isError: true, details: { errorCode: "storage_error" } } }
				: { degraded: false, result: { op: "update", details: {} } };
		});

		expect(await correctCommand("m1", "corrected text")).toEqual({
			ok: false,
			text: "m1 m2 update_failed storage_error",
		});
		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: true, text: "m2" });
		expect(stores).toBe(1);
	});

	it("keeps pending recovery state when the marker update response is lost", async () => {
		let marker = "";
		let inspection = 0;
		client.inspect.mockImplementation(async () => ({
			degraded: false,
			result: {
				op: "get",
				entry: {
					id: "m1",
					text: "old",
					category: "episodic",
					metadata: inspection++ === 0 ? {} : { supersededBy: marker },
				},
			},
		}));
		client.mutate.mockImplementation(async (operation: Record<string, any>) => {
			if (operation.op === "update" && typeof operation.metadata?.supersededBy === "string" && operation.metadata.supersededBy.startsWith("pending:")) {
				marker = operation.metadata.supersededBy;
				return { degraded: true, reason: "connection-lost" };
			}
			if (operation.op === "store") return { degraded: false, result: { op: "store", details: { id: "m2" } } };
			return { degraded: false, result: { op: "update", details: {} } };
		});

		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: false, text: "connection-lost" });
		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: true, text: "m2" });
	});

	it("reuses a nonce-matched successor after the store response is lost", async () => {
		let marker = "";
		let inspection = 0;
		let stores = 0;
		client.inspect.mockImplementation(async () => ({
			degraded: false,
			result: {
				op: "get",
				entry: {
					id: "m1",
					text: "old",
					category: "episodic",
					metadata: inspection++ === 0 ? {} : { supersededBy: marker },
				},
			},
		}));
		client.mutate.mockImplementation(async (operation: Record<string, any>) => {
			if (operation.op === "update" && typeof operation.metadata?.supersededBy === "string" && operation.metadata.supersededBy.startsWith("pending:")) {
				marker = operation.metadata.supersededBy;
				return { degraded: false, result: { op: "update", details: {} } };
			}
			if (operation.op === "store") {
				stores += 1;
				return { degraded: true, reason: "connection-lost" };
			}
			return { degraded: false, result: { op: "update", details: {} } };
		});
		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: false, text: "connection-lost" });
		const nonce = marker.slice("pending:".length);
		client.getRecall.mockResolvedValueOnce({
			degraded: false,
			toolResult: { details: { memories: [{ id: "m2", text: "corrected text", metadata: { correctionOf: "m1", correctionNonce: nonce } }] } },
		});

		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: true, text: "m2" });
		expect(stores).toBe(1);
		expect(client.getRecall).toHaveBeenCalledWith("corrected text", expect.anything(), {
			source: "manual",
			limit: 5,
			includeMetadata: true,
		});
	});

	it("fails closed when the retry lookup returns a tool error", async () => {
		let marker = "";
		let inspection = 0;
		let stores = 0;
		client.inspect.mockImplementation(async () => ({
			degraded: false,
			result: {
				op: "get",
				entry: {
					id: "m1",
					text: "old",
					category: "episodic",
					metadata: inspection++ === 0 ? {} : { supersededBy: marker },
				},
			},
		}));
		client.mutate.mockImplementation(async (operation: Record<string, any>) => {
			if (operation.op === "update") {
				marker = operation.metadata.supersededBy;
				return { degraded: false, result: { op: "update", details: {} } };
			}
			stores += 1;
			return { degraded: true, reason: "connection-lost" };
		});
		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: false, text: "connection-lost" });
		client.getRecall.mockResolvedValueOnce({
			degraded: false,
			toolResult: { isError: true, details: { errorCode: "storage_error" } },
		});

		expect(await correctCommand("m1", "corrected text")).toEqual({ ok: false, text: "storage_error" });
		expect(stores).toBe(1);
	});

	it("returns closed failures for invalid input, missing entries, and sidecar degradation", async () => {
		expect(await rememberCommand(" ")).toEqual({ ok: false, text: "invalid-input" });
		expect(await correctCommand("m1", " ")).toEqual({ ok: false, text: "invalid-input" });
		client.inspect.mockResolvedValueOnce({ degraded: false, result: { op: "get", entry: null } });
		expect(await getCommand("missing")).toEqual({ ok: false, text: "not-found" });
		client.mutate.mockResolvedValueOnce({ degraded: true, reason: "engine-failed" });
		expect(await rememberCommand("fact")).toEqual({ ok: false, text: "engine-failed" });
		client.inspect.mockResolvedValueOnce({ degraded: false, result: { op: "get", entry: { id: "m1", text: "old", category: "episodic", metadata: {} } } });
		client.mutate.mockResolvedValueOnce({ degraded: false, result: { isError: true, details: { errorCode: "invalid-input" } } });
		expect(await correctCommand("m1", "fact")).toEqual({ ok: false, text: "invalid-input" });
	});
});
