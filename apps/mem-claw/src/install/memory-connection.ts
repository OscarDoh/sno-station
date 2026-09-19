import { DEFAULT_LOCALE } from "@snoai/sno-station-mem/internal/engine/i18n/locales";
import { connect, ContractError, type MemoryClient, type ScopeCtx } from "@snoai/sno-station-mem/client";
import { readDiscovery } from "@snoai/sno-station-mem/internal/contract/discovery";
import { MEMORY_RECONNECT_INTERVAL_MS } from "@snoai/sno-station-mem/internal/contract/routes";
import type { PluginConfig } from "@snoai/sno-station-mem/internal/config/plugin-config-schema";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { resolveAgentId } from "@snoai/sno-station-mem/internal/engine/bindings/memory-tool-access";
import { createScopePolicy } from "@snoai/sno-station-mem/internal/engine/security/memory-scope-policy";
import { bindStore } from "@snoai/sno-station-mem/internal/engine/shared/paths";
import { getBindingPath, getDefaultStorePath } from "@snoai/sno-station-mem/internal/contract/profile";
import { existsSync } from "node:fs";
import {
	HOST_COMMAND_SESSION_ID,
	HOST_REGISTRATION_SESSION_ID,
	SKIN_ID,
} from "../constants";
import { startModelCallback, type ModelCallback } from "./model-callback";
export type HostMemoryContext = {
  agentId?: string; sessionKey?: string; sessionId?: string;
  workspaceDir?: string; sessionTimezone?: string; sessionFile?: string;
  gatewayClientScopes?: string[];
};

export interface MemoryConnection {
  ready(): Promise<MemoryClient>;
  scope(context?: HostMemoryContext, project?: string): Promise<ScopeCtx>;
  close(): Promise<void>;
}

export function createMemoryConnection(api: OpenClawPluginApi, config: PluginConfig, skinId: string = SKIN_ID): MemoryConnection {
  let callback: ModelCallback | undefined;
  let opening: Promise<MemoryClient> | undefined;
  let client: MemoryClient | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let closed = false;
  const scopePolicy = createScopePolicy(config.scopes);
  const dropCallback = async (): Promise<void> => { const closing = callback; callback = undefined; await closing?.close(); };
  // A fresh install has no store binding yet; the first skin to start installs its own settings so the
  // sidecar boots with the same embedding the host config carries. A binding that appears concurrently wins.
  const bindFreshInstall = async (): Promise<void> => {
    if (existsSync(getBindingPath())) return;
    // Installation settings never carry credentials; the sidecar reads those from its own environment.
    const { apiKey: _embeddingKey, ...embedding } = config.embedding as Record<string, unknown>;
    const { rerankApiKey: _rerankKey, ...retrieval } = config.retrieval as Record<string, unknown>;
    // The sidecar re-reads the rerank key from its own environment under this name.
    if (typeof _rerankKey === "string" && _rerankKey.trim()) process.env.SNO_STATION_MEM_RERANK_API_KEY = _rerankKey;
    const { memoryTelemetry, autoRecallTimeoutMs, remOperations, remEnhanced, mode } = config;
    try {
      await bindStore(config.dbPath ?? getDefaultStorePath(), { embedding, retrieval, memoryTelemetry, autoRecallTimeoutMs, remOperations, remEnhanced, mode,
        ...(typeof _rerankKey === "string" && _rerankKey.trim() ? { rerankKeyRef: "SNO_STATION_MEM_RERANK_API_KEY" as const } : {}) });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
  };
  const open = async (): Promise<MemoryClient> => {
    await bindFreshInstall().catch(error => api.logger.error(`Memory installation settings could not be saved: ${error instanceof Error ? error.message : String(error)}`));
    const connected = await connect({ skinId, storePath: config.dbPath });
    if (connected.degraded) throw new ContractError(connected.reason);
    callback = await startModelCallback(api);
    if (closed) { await dropCallback(); throw new ContractError("sidecar-unreachable"); }
    const { mode, remEnhanced, agentNative, language, ...settings } = config;
    try {
      await connected.init({ principal: connected.principal, project: "global", session: HOST_REGISTRATION_SESSION_ID }, {
        skinId, settings, routing: { mode, remEnhanced, agentNative, language: language ?? DEFAULT_LOCALE }, model: callback.registration,
      });
    } catch (error) { await dropCallback(); throw error; }
    return connected;
  };
  const ready = async (): Promise<MemoryClient> => {
    if (closed) throw new ContractError("sidecar-unreachable");
    if (!opening) {
      opening = (async () => {
        // Discovery, callback cleanup and registration belong to the same attempt.
        if (client) {
          const current = await readDiscovery().catch(() => undefined);
          if (current && current.pid === client.pid && current.port === client.port) return client;
          client = undefined;
          await dropCallback();
        }
        const opened = await open();
        client = opened;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = undefined;
        return opened;
      })().catch((error: unknown) => {
        api.logger.error(`Memory registration failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!closed && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void ready().catch(() => undefined);
          }, MEMORY_RECONNECT_INTERVAL_MS);
          retryTimer.unref();
        }
        throw error;
      }).finally(() => { opening = undefined; });
    }
    return opening;
  };
  return {
    ready,
    async scope(context: HostMemoryContext = {}, project?: string): Promise<ScopeCtx> {
      const client = await ready();
      const agentId = resolveAgentId(context.agentId, context.sessionKey?.match(/^agent:([^:]+):/)?.[1]);
      const configuredAgent = agentId ? api.config.agents?.entries?.[agentId] ?? api.config.agents?.list?.find(agent => agent.id === agentId) : undefined;
      const workspace = context.workspaceDir ?? configuredAgent?.workspace ?? (agentId ? api.config.agents?.defaults?.workspace : undefined);
      // An explicit scope reads itself alone; an omitted one reads every scope the agent may access.
      return {
        principal: client.principal,
        project: project ?? workspace ?? scopePolicy.getDefaultScope(agentId),
        ...(project === undefined ? { readable: scopePolicy.getAccessibleScopes(agentId) } : {}),
        session: context.sessionKey ?? context.sessionId ?? HOST_COMMAND_SESSION_ID,
        host: { agentId, workspace, sessionKey: context.sessionKey, sessionId: context.sessionId,
          sessionTimezone: context.sessionTimezone, sessionFile: context.sessionFile,
          systemCaller: context.gatewayClientScopes?.includes("operator.admin") ?? false },
      };
    },
    async close(): Promise<void> {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (opening) await opening.catch(() => undefined);
      await dropCallback();
    },
  };
}
