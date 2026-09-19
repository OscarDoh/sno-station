import { classifyWorkspaceMemoryPaths } from "./workspace-provenance";
import { listSnoStationMemProviderPublicArtifacts } from "./provider-public-artifacts";
import { getSnoStationMemStateDir } from "@snoai/sno-station-mem/internal/engine/operations/runtime-audit-log";
import { resolve } from "node:path";
import { ContractError } from "@snoai/sno-station-mem/client";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { AnyAgentTool, MemoryPluginCapability, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { jsonResult } from "openclaw/plugin-sdk/core";
import { readFiniteNumberParam, readPositiveIntegerParam, readStringParam } from "openclaw/plugin-sdk/param-readers";
import type { SnoStationMemMemoryCapability, SnoStationMemMemoryRuntime, SnoStationMemMemorySource } from "./openclaw-memory-contracts";
import type { MemoryConnection } from "../install/memory-connection";
import { APP_NAME } from "../constants";
type MemoryPromptSectionBuilder = NonNullable<MemoryPluginCapability["promptBuilder"]>;
const MEMORY_SEARCH_DESCRIPTION =
	"Mandatory recall step: semantically search MEMORY.md + memory/*.md before answering questions about prior work, decisions, dates, people, preferences, or todos. `corpus=memory` restricts hits to indexed memory files. `corpus=all` includes the mem-claw memory corpus; wiki and sessions are not owned by this provider and return disabled=true when requested directly. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.";
const MEMORY_GET_DESCRIPTION =
	"Safe exact excerpt read from MEMORY.md or memory/*.md. Defaults to a bounded excerpt when lines are omitted, includes truncation/continuation info when more content exists; wiki is not available from this provider.";
const MEMORY_SEARCH_PARAMETERS = {
	type: "object",
	properties: {
		query: { type: "string" },
		maxResults: { type: "integer", minimum: 1 },
		minScore: { type: "number" },
		corpus: { type: "string", enum: ["memory", "wiki", "all", "sessions"] },
	},
	required: ["query"],
	additionalProperties: false,
} as const;
const MEMORY_GET_PARAMETERS = {
	type: "object",
	properties: {
		path: { type: "string" },
		from: { type: "integer", minimum: 1 },
		lines: { type: "integer", minimum: 1 },
		corpus: { type: "string", enum: ["memory", "wiki", "all"] },
	},
	required: ["path"],
	additionalProperties: false,
} as const;
const SEARCH_CORPORA = new Set(["memory", "wiki", "all", "sessions"]);
const GET_CORPORA = new Set(["memory", "wiki", "all"]);

type ProviderToolContext = {
	agentId?: unknown;
	config?: OpenClawConfig;
	runtimeConfig?: OpenClawConfig;
	getRuntimeConfig?: () => OpenClawConfig | undefined;
};

function asToolParamsRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}













function createPromptBuilder(): MemoryPromptSectionBuilder {
	return ({ availableTools, citationsMode }) => {
		const hasMemorySearch = availableTools.has("memory_search");
		const hasMemoryGet = availableTools.has("memory_get");
		if (!hasMemorySearch && !hasMemoryGet) return [];
		let toolGuidance: string;
		if (hasMemorySearch && hasMemoryGet) {
			toolGuidance =
				"Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.";
		} else if (hasMemorySearch) {
			toolGuidance =
				"Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md and answer from the matching results. If low confidence after search, say you checked.";
		} else {
			toolGuidance =
				"Before answering anything about prior work, decisions, dates, people, preferences, or todos that already point to a specific memory file or note: run memory_get to pull only the needed lines. If low confidence after reading them, say you checked.";
		}
		const lines = ["## Memory Recall", toolGuidance];
		if (citationsMode === "off") {
			lines.push(
				"Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
			);
		} else {
			lines.push(
				"Citations: include Source: <path#line> when it helps the user verify memory snippets.",
			);
		}
		lines.push("");
		return lines;
	};
}

function createUnavailableResult(error: string) {
	return jsonResult({ disabled: true, unavailable: true, error });
}

function readOptionalCorpus(
	params: Record<string, unknown>,
	key: "corpus",
	allowed: ReadonlySet<string>,
): string | undefined {
	const corpus = readStringParam(params, key, { trim: true });
	if (corpus === undefined) return undefined;
	if (allowed.has(corpus)) return corpus;
	throw new Error(`Unsupported memory corpus: ${corpus}`);
}

function searchSourcesForCorpus(
	corpus: string | undefined,
): SnoStationMemMemorySource[] | undefined {
	if (corpus === "memory") return ["memory"];
	return undefined;
}

function readToolConfig(api: OpenClawPluginApi, ctx: ProviderToolContext): OpenClawConfig {
	return ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? api.config;
}

function readToolAgentId(cfg: OpenClawConfig, ctx: ProviderToolContext): string {
	if (typeof ctx.agentId === "string" && ctx.agentId.trim().length > 0) {
		return ctx.agentId.trim();
	}
	const configured = configuredAgents(cfg)
		.map((agent) => agent.id)
		.filter((agentId): agentId is string => typeof agentId === "string" && agentId.length > 0);
	const [onlyConfiguredAgentId] = configured;
	if (configured.length === 1 && onlyConfiguredAgentId) return onlyConfiguredAgentId;
	throw new Error("sno-mem-claw provider memory tools require an OpenClaw agent id");
}

function createProviderMemorySearchTool(params: {
	api: OpenClawPluginApi;
	runtime: SnoStationMemMemoryRuntime;
	ctx: ProviderToolContext;
}): AnyAgentTool {
	return {
		label: "Memory Search",
		name: "memory_search",
		description: MEMORY_SEARCH_DESCRIPTION,
		parameters: MEMORY_SEARCH_PARAMETERS as unknown as AnyAgentTool["parameters"],
		execute: async (_toolCallId, toolParams, signal) => {
			const cfg = readToolConfig(params.api, params.ctx);
			const agentId = readToolAgentId(cfg, params.ctx);
			const record = asToolParamsRecord(toolParams);
			const query = readStringParam(record, "query", {
				required: true,
				trim: true,
				allowEmpty: false,
			});
			const maxResults = readPositiveIntegerParam(record, "maxResults");
			const minScore = readFiniteNumberParam(record, "minScore");
			const corpus = readOptionalCorpus(record, "corpus", SEARCH_CORPORA);
			if (corpus === "wiki") {
				return createUnavailableResult("wiki corpus not available from this provider");
			}
			if (corpus === "sessions") {
				return createUnavailableResult("sessions corpus not available from this provider");
			}
			const managerResult = await params.runtime.getMemorySearchManager({ cfg, agentId });
			if (!managerResult.manager) {
				return createUnavailableResult(managerResult.error ?? "memory search unavailable");
			}
			const sources = searchSourcesForCorpus(corpus);
			return jsonResult(
				await managerResult.manager.search(query, {
					...(maxResults ? { maxResults } : {}),
					...(minScore !== undefined ? { minScore } : {}),
					...(sources ? { sources } : {}),
					...(signal ? { signal } : {}),
				}),
			);
		},
	};
}

function createProviderMemoryGetTool(params: {
	api: OpenClawPluginApi;
	runtime: SnoStationMemMemoryRuntime;
	ctx: ProviderToolContext;
}): AnyAgentTool {
	return {
		label: "Memory Get",
		name: "memory_get",
		description: MEMORY_GET_DESCRIPTION,
		parameters: MEMORY_GET_PARAMETERS as unknown as AnyAgentTool["parameters"],
		execute: async (_toolCallId, toolParams) => {
			const cfg = readToolConfig(params.api, params.ctx);
			const agentId = readToolAgentId(cfg, params.ctx);
			const record = asToolParamsRecord(toolParams);
			const relPath = readStringParam(record, "path", {
				required: true,
				trim: true,
				allowEmpty: false,
			});
			const from = readPositiveIntegerParam(record, "from");
			const lines = readPositiveIntegerParam(record, "lines");
			const corpus = readOptionalCorpus(record, "corpus", GET_CORPORA);
			if (corpus === "wiki") {
				return createUnavailableResult("wiki corpus not available from this provider");
			}
			const managerResult = await params.runtime.getMemorySearchManager({ cfg, agentId });
			if (!managerResult.manager) {
				return createUnavailableResult(managerResult.error ?? "memory get unavailable");
			}
			return jsonResult(
				await managerResult.manager.readFile({
					relPath,
					...(from ? { from } : {}),
					...(lines ? { lines } : {}),
				}),
			);
		},
	};
}




function configuredAgents(cfg: OpenClawConfig): Array<{ id: string; workspace?: string }> {
  const entries = cfg.agents?.entries;
  if (entries && Object.keys(entries).length) return Object.entries(entries).map(([id, entry]) => ({ id, workspace: entry.workspace }));
  return cfg.agents?.list ?? [];
}
function createHttpRuntime(connection: MemoryConnection): SnoStationMemMemoryRuntime {
  return {
    classifyWorkspaceMemoryPaths,
    resolveMemoryBackendConfig: () => ({ backend: "qmd" }),
    async getMemorySearchManager({ cfg, agentId }) {
      const workspace = configuredAgents(cfg).find(agent => agent.id === agentId)?.workspace ?? cfg.agents?.defaults?.workspace;
      if (!workspace) return { manager: null, error: "memory provider requires a configured workspace" };
      const scope = await connection.scope({ agentId, workspaceDir: resolve(workspace) });
      const client = await connection.ready();
      return { manager: {
        async search(query, options) {
          const result = await client.getRecall(query, scope, { source: "native", corpus: options?.sources?.includes("memory") ? "memory" : "all", limit: options?.maxResults, minScore: options?.minScore });
          if (result.degraded) throw new ContractError(result.reason);
          return result.nativeHits ?? [];
        },
        async readFile(params) {
          const result = await client.inspect({ op: "get", path: params.relPath, from: params.from, lines: params.lines }, scope);
          if (result.degraded) throw new ContractError(result.reason);
          if (result.result.op !== "get" || !result.result.file) throw new ContractError("engine-failed");
          return result.result.file;
        },
        status: () => ({ backend: "qmd", provider: APP_NAME, workspaceDir: resolve(workspace), dbPath: client.storePath }),
        async probeEmbeddingAvailability() { return { ok: false, checked: false, error: "Embedding availability is owned by the sidecar; this interface does not expose a probe." }; },
        async probeVectorAvailability() { return false; },
      } };
    },
  };
}
export function registerSnoStationMemProviderCapability(params: { api: OpenClawPluginApi; connection: MemoryConnection }): void {
  const runtime = createHttpRuntime(params.connection);
  const capability: SnoStationMemMemoryCapability = { promptBuilder: createPromptBuilder(), supportsPrivateTranscriptRecall: false, runtime, publicArtifacts: {
    async listArtifacts({ cfg }) {
      const artifacts = [];
      for (const agent of configuredAgents(cfg)) {
        const workspaceDir = agent.workspace ?? cfg.agents?.defaults?.workspace;
        if (!workspaceDir) continue;
        artifacts.push(...await listSnoStationMemProviderPublicArtifacts({ connection: params.connection, context: { agentId: agent.id, workspaceDir }, agentId: agent.id, workspaceDir, stateDir: getSnoStationMemStateDir() }));
      }
      return artifacts;
    },
  } };
  params.api.registerMemoryCapability(capability as MemoryPluginCapability);
  params.api.registerTool(ctx => createProviderMemorySearchTool({ api: params.api, runtime, ctx: ctx as ProviderToolContext }), { names: ["memory_search"] });
  params.api.registerTool(ctx => createProviderMemoryGetTool({ api: params.api, runtime, ctx: ctx as ProviderToolContext }), { names: ["memory_get"] });
}
