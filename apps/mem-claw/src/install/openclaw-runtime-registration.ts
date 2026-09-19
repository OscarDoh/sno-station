import { PluginObservability } from "@snoai/sno-station-mem/internal/engine/observability/adapter";
import { createRuntimeObservabilityController } from "../hooks/openclaw-observe-controller";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { PluginConfig } from "@snoai/sno-station-mem/internal/config/plugin-config-schema";
import { getSnoStationMemStateDir } from "@snoai/sno-station-mem/internal/engine/operations/runtime-audit-log";
import { createMemoryConnection, type MemoryConnection } from "./memory-connection";
import { registerAllMemoryTools } from "../tools/memory-tool-registration";
import { registerMemoryCli } from "../commands/memory-management-cli";
import { registerPluginCommands } from "../commands/openclaw-command-registration";
import { registerSnoStationMemProviderCapability } from "../tools/provider-registration";
import { registerRuntimeHooks } from "../hooks/openclaw-runtime-hooks";
import { APP_NAME, SKIN_ID } from "../constants";

const connections = new WeakMap<OpenClawPluginApi, MemoryConnection>();
export function registerRuntime(api: OpenClawPluginApi, config: PluginConfig): void {
  if (connections.has(api)) return;
  const connection = createMemoryConnection(api, config);
  connections.set(api, connection);
  const stateDir = getSnoStationMemStateDir();
  const observability = new PluginObservability(config, stateDir, api.logger);
  const observe = createRuntimeObservabilityController({ api, config, stateDir, observability });
  registerAllMemoryTools(observe.observedApi, { connection, stateDir, language: config.language, selfImprovementEnabled: config.selfImprovement.enabled });
  registerPluginCommands(api, { connection, stateDir });
  registerMemoryCli(api, { connection, stateDir }, config);
  registerRuntimeHooks(api, config, connection, observe, observability);
  if (api.config.plugins?.slots?.memory === APP_NAME) registerSnoStationMemProviderCapability({ api: observe.observedApi, connection });
  api.registerService({
    id: SKIN_ID,
    async start(): Promise<void> { await connection.ready(); },
    async stop(): Promise<void> { await connection.close(); await observability.shutdown(); connections.delete(api); },
  });
}
