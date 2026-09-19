import type { RuntimeObserveController } from "./openclaw-observe-controller";
import type { PluginObservability } from "@snoai/sno-station-mem/internal/engine/observability/adapter";
import { createLogger as createDiagnosticLogger } from "@snoai/utils/logger";
import { createHash } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { ContractError, type Message, type ScopeCtx } from "@snoai/sno-station-mem/client";
import type { PluginConfig } from "@snoai/sno-station-mem/internal/config/plugin-config-schema";
import { z } from "zod";
import type { MemoryConnection, HostMemoryContext } from "../install/memory-connection";
import { isPluginOwnedMessage, normalizeMessageTimestampMs } from "@snoai/sno-station-mem/internal/engine/bindings/sno-station-mem-message-transcript";
import { setupSelfImprovement } from "./learning-file-hooks";

const diagnosticLog = createDiagnosticLogger("mem-claw:openclaw-runtime-hooks");
/** Memory failures never leave a hook: the host turn continues without memory, and the reason is logged. */
async function contained<T>(hook: string, run: () => Promise<T>): Promise<T | undefined> {
  try { return await run(); }
  catch (error) {
    const reason = error instanceof ContractError ? error.reason : "engine-failed";
    diagnosticLog.warn("Memory hook skipped", { hook, reason, error }, { event_name: "memory.openclaw_runtime_hooks.hook.skipped", file: "apps/mem-claw/src/hooks/openclaw-runtime-hooks.ts", function: "contained", site_id: "hooks.openclaw-runtime-hooks.contained.memory-hook-skipped" });
    return undefined;
  }
}
const INPUT_TOKEN_KEYS = ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"] as const;
const OUTPUT_TOKEN_KEYS = ["output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"] as const;
/** The host reports token usage under several spellings; the first present numeric field wins per side. */
function hostUsage(value: unknown): { input: number; output: number } | undefined {
  const usage = z.record(z.string(), z.unknown()).safeParse(value);
  if (!usage.success) return undefined;
  const pick = (keys: readonly string[]): number | undefined => {
    for (const key of keys) { const raw = usage.data[key]; if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw); }
    return undefined;
  };
  const input = pick(INPUT_TOKEN_KEYS), output = pick(OUTPUT_TOKEN_KEYS);
  if (input === undefined && output === undefined) return undefined;
  return { input: input ?? 0, output: output ?? 0 };
}
const messageSchema = z.object({ role: z.enum(["system", "developer", "user", "assistant", "tool"]), content: z.json(), timestamp: z.union([z.number(), z.string()]).optional(), at: z.number().optional() });
function messages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    // A request this plugin sent to the host model is not a conversation turn; the contract carries no marker, so drop it here.
    if (isPluginOwnedMessage(item)) return [];
    const parsed = messageSchema.safeParse(item);
    if (!parsed.success) return [];
    const at = parsed.data.at ?? normalizeMessageTimestampMs(parsed.data.timestamp) ?? Date.now();
    return [{ role: parsed.data.role, content: parsed.data.content, at }];
  });
}
const customEvent = z.object({
  sessionKey: z.string(), action: z.enum(["new", "reset"]), timestamp: z.union([z.number(), z.date()]).optional(),
  context: z.object({ workspaceDir: z.string().optional(), previousSessionEntry: z.object({ sessionId: z.string().optional(), sessionFile: z.string().optional() }).optional() }).optional(),
});

export function registerRuntimeHooks(api: OpenClawPluginApi, config: PluginConfig, connection: MemoryConnection, observe: RuntimeObserveController, observability: PluginObservability): void {
  api.on("llm_output", async (event, context) => {
    // Context identity wins; an event that only carries its own sessionId still binds to the session.
    const lookup = context.sessionId || context.sessionKey ? context : { ...context, ...(event.sessionId ? { sessionId: event.sessionId } : {}) };
    const sessionUuid = observe.lookupActiveObserveSession(lookup);
    if (!sessionUuid) return;
    const usage = hostUsage(event.usage);
    if (!usage) return;
    await observability.trackBestEffort("host llm.call", async () => {
      await observability.emit({ eventType: "llm.call", sessionUuid, payload: { model: event.provider && event.model ? `${event.provider}:${event.model}` : event.model ?? event.provider ?? "openclaw:unknown", prompt_tokens: usage.input, completion_tokens: usage.output, latency_ms: 0, cache_read_tokens: 0, cache_write_tokens: 0, token_source: "host_agent_paid" } });
    });
  });
  api.on("gateway_start", async () => { await connection.ready(); });
  api.on("before_prompt_build", async (event, context) => {
    await observe.startObserveSession(context, event.prompt);
    return contained("before_prompt_build", async () => {
      const client = await connection.ready();
      const originalScope = await connection.scope(context);
      const scope = { ...originalScope, host: { ...originalScope.host, observeSessionUuid: observe.lookupActiveObserveSession(context) } };
      const recalled = await client.getRecall(event.prompt, scope, { source: "auto" });
      const block = await client.staticBlock(scope);
      for (const [part, result] of [["getRecall", recalled], ["staticBlock", block]] as const) {
        if (result.degraded) diagnosticLog.warn("Memory context degraded", { hook: "before_prompt_build", part, reason: result.reason }, { event_name: "memory.openclaw_runtime_hooks.context.degraded", file: "apps/mem-claw/src/hooks/openclaw-runtime-hooks.ts", function: "registerRuntimeHooks", site_id: "hooks.openclaw-runtime-hooks.registerRuntimeHooks.context-degraded" });
      }
      const prependContext = [block.contextText, recalled.contextText].filter(Boolean).join("\n\n");
      return prependContext ? { prependContext } : undefined;
    });
  });
  api.on("agent_end", async (event, context) => {
    // A failed run captures nothing, but its observe session still ends here.
    try {
      if (!event.success) return;
      await contained("agent_end", async () => {
        const client = await connection.ready();
        const originalScope = await connection.scope(context);
        const scope = { ...originalScope, host: { ...originalScope.host, observeSessionUuid: observe.lookupActiveObserveSession(context) } };
        const captured = messages(event.messages);
        const turnId = createHash("sha256").update(JSON.stringify({ session: scope.session, messages: event.messages })).digest("hex");
        await client.capture({ turnId, rewindEpoch: 0, messages: captured }, scope);
      });
    } finally { await observe.finalizeObserveSession(context, event.durationMs); }
  });
  api.on("before_reset", async (event, context) => {
    try {
      await contained("before_reset", async () => {
        const originalScope = await connection.scope(context);
        const scope = { ...originalScope, host: { ...originalScope.host, observeSessionUuid: observe.lookupActiveObserveSession(context) } };
        await (await connection.ready()).onSessionEnd(messages(event.messages), scope);
      });
    } finally { await observe.finalizeObserveSession(context); }
  });
  api.on("session_end", async (event, context) => {
    const sessionId = context.sessionId ?? event.sessionId;
    try {
      await contained("session_end", async () => {
        const scope = await connection.scope({ ...context, sessionId });
        await (await connection.ready()).onSessionEnd([], { ...scope, host: { ...scope.host, boundary: "session-end" } });
      });
    } finally { await observe.finalizeObserveSession({ sessionId }, event.durationMs); }
  });
  api.on("after_tool_call", async (event, context) => {
    if (config.sessionStrategy !== "memoryReflection") return;
    await contained("after_tool_call", async () => {
      const originalScope = await connection.scope(context);
      const scope = { ...originalScope, host: { ...originalScope.host, observeSessionUuid: observe.lookupActiveObserveSession(context) } };
      await (await connection.ready()).recordUsage(`tool:${event.toolName}:${Date.now()}`, {
        event: "tool-error", memoryIds: [], toolName: event.toolName,
        error: event.error === undefined ? undefined : z.json().parse(event.error),
        result: event.result === undefined ? undefined : z.json().parse(event.result), at: Date.now(),
      }, scope);
    });
  });
  if (config.sessionStrategy === "memoryReflection") {
    const onCommand = async (raw: unknown): Promise<void> => {
      const event = customEvent.parse(raw);
      await contained(`command:${event.action}`, async () => {
        const context: HostMemoryContext = { sessionKey: event.sessionKey, workspaceDir: event.context?.workspaceDir, ...event.context?.previousSessionEntry };
        const scope: ScopeCtx = await connection.scope(context);
        await (await connection.ready()).onSessionEnd([], { ...scope, host: { ...scope.host, boundary: event.action, at: event.timestamp instanceof Date ? event.timestamp.getTime() : event.timestamp } });
      });
    };
    api.registerHook("command:new", onCommand, { name: "mem-claw.memory-reflection.command-new", description: "Generate reflection log before /new" });
    api.registerHook("command:reset", onCommand, { name: "mem-claw.memory-reflection.command-reset", description: "Generate reflection log before /reset" });
  }
  if (config.selfImprovement.enabled) setupSelfImprovement(api, config.selfImprovement, session => typeof session === "string" && session.includes(":reflection:"));
}
