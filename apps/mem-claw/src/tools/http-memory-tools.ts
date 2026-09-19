import { serializeMemory } from "@snoai/sno-station-mem/internal/engine/bindings/memory-tool-formatting";
import { ContractError, type ScopeCtx } from "@snoai/sno-station-mem/client";
import { z } from "zod";
import { RetrievalError, SnoStationMemError } from "@snoai/sno-station-mem/internal/engine/shared/errors";
import { resolveAgentId } from "@snoai/sno-station-mem/internal/engine/bindings/memory-tool-access";
import { recallParamsSchema, storeParamsSchema, forgetParamsSchema, updateParamsSchema, statsParamsSchema, listParamsSchema } from "@snoai/sno-station-mem/internal/engine/bindings/memory-tool-schemas";
import { readEstimatedSpendToday } from "@snoai/sno-station-mem/internal/engine/operations/daily-spend-estimator";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@snoai/sno-station-mem/internal/config/index";
import type { HostMemoryContext } from "../install/memory-connection";
import type { ToolContext, ToolResult } from "./memory-tool-schemas";

export function toolHostContext(value: unknown): HostMemoryContext {
  const source = z.object({ agentId: z.string().optional(), sessionKey: z.string().optional(), sessionId: z.string().optional(), workspaceDir: z.string().optional(), sessionTimezone: z.string().optional(), gatewayClientScopes: z.array(z.string()).optional() }).parse(value ?? {});
  return source;
}
export async function executeMemoryRecallTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown, _options?: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = recallParamsSchema.parse(params), client = await ctx.connection.ready();
    const result = await client.getRecall(input.query, await toolScope(ctx, access, input.scope), {
      source: "manual", limit: input.top_k, minScore: input.min_score, category: input.category,
      includeMetadata: input.include_metadata, includeHistory: input.include_history, includeRefused: input.include_refused,
      tokenBudget: input.token_budget, aggregation: input.aggregation,
      externalReference: input.external_reference, externalReferenceVisibility: input.external_reference_visibility,
  });
  if (result.degraded) throw new ContractError(result.reason);
  if (!result.toolResult) throw new ContractError("engine-failed");
  return result.toolResult;
  });
}
export async function executeMemorySaveTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = storeParamsSchema.parse(params), client = await ctx.connection.ready();
    return (await client.mutate({ op: "store", content: input.content, category: input.category, importance: input.importance, metadata: input.metadata === undefined ? undefined : z.record(z.string(), z.json()).parse(input.metadata) }, await toolScope(ctx, access, input.scope))).result;
  });
}
export async function executeMemoryForgetTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = forgetParamsSchema.parse(params), client = await ctx.connection.ready();
    return (await client.mutate({ op: "forget", id: input.id, query: input.query, suppressKey: input.suppress_key, suppressContent: input.suppress_content, minScore: input.min_score, maxDelete: input.max_delete, confirm: input.confirm }, await toolScope(ctx, access, input.scope))).result;
  });
}
export async function executeMemoryUpdateTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = updateParamsSchema.parse(params), client = await ctx.connection.ready();
    return (await client.mutate({ op: "update", id: input.id, text: input.text, category: input.category, importance: input.importance, metadata: input.metadata === undefined ? undefined : z.record(z.string(), z.json()).parse(input.metadata) }, await toolScope(ctx, access))).result;
  });
}
const reflection = z.object({ memoryId: z.string().optional(), query: z.string().optional(), scope: z.string().optional(), dryRun: z.boolean().optional(), note: z.string().optional(), limit: z.number().int().optional() });
export async function executeMemoryReflectionResolveTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = reflection.parse(params), client = await ctx.connection.ready();
    return (await client.mutate({ op: "resolveReflection", memoryId: input.memoryId, query: input.query, dryRun: input.dryRun, note: input.note, limit: input.limit }, await toolScope(ctx, access, input.scope))).result;
  });
}
export async function executeMemoryStatsTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = statsParamsSchema.parse(params), client = await ctx.connection.ready();
    const scope = await toolScope(ctx, access, input.scope);
    const result = await client.inspect({ op: "stats", scope: scope.project }, scope);
    if (result.degraded) throw new ContractError(result.reason);
    if (result.result.op !== "stats") throw new ContractError("engine-failed");
    const payload = { total: result.result.total, scopeBreakdown: result.result.projectBreakdown, categoryBreakdown: result.result.categoryBreakdown, estimatedSpendTodayUsd: await readEstimatedSpendToday(ctx.stateDir),  };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], details: payload };
  });
}
export async function executeMemoryListTool(ctx: ToolContext, access: HostMemoryContext, _id: unknown, params: unknown): Promise<ToolResult> {
  return withToolErrors(async () => {
    const input = listParamsSchema.parse(params), client = await ctx.connection.ready();
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(input.limit ?? DEFAULT_LIST_LIMIT)));
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const result = await client.inspect({ op: "list", category: input.category, limit, offset, importanceMin: input.importance_min }, await toolScope(ctx, access, input.scope));
    if (result.degraded) throw new ContractError(result.reason);
    if (result.result.op !== "list") throw new ContractError("engine-failed");
    return { content: [{ type: "text", text: JSON.stringify(result.result.entries.map(serializeMemory)) }], details: { count: result.result.entries.length, limit, offset, estimatedSpendTodayUsd: await readEstimatedSpendToday(ctx.stateDir),  } };
  });
}

/** A tool call with no agent identity gets no scope at all, unless the gateway marks it a system caller. */
async function toolScope(ctx: ToolContext, access: HostMemoryContext, project?: string): Promise<ScopeCtx> {
  const systemCaller = access.gatewayClientScopes?.includes("operator.admin") ?? false;
  const agentId = resolveAgentId(access.agentId, access.sessionKey?.match(/^agent:([^:]+):/)?.[1]);
  if (agentId === undefined && !systemCaller) throw new ContractError("invalid-input");
  return ctx.connection.scope(access, project);
}

async function withToolErrors(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try { return await run(); }
  catch (error) {
    const failure = error instanceof z.ZodError
      ? new RetrievalError(error.issues.map(issue => issue.message).join(", "), error)
      : error;
    if (!(failure instanceof SnoStationMemError) && !(failure instanceof ContractError)) throw error;
    return {
      isError: true,
      content: [{ type: "text", text: failure.message }],
      details: { errorCode: failure instanceof ContractError ? failure.reason : failure.code },
    };
  }
}
