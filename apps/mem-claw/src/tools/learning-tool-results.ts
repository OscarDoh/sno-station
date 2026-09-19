import { normalizeError, makeResult } from "@snoai/sno-station-mem/internal/engine/bindings/memory-tool-results";
import type { ToolContext, ToolResult } from "./memory-tool-schemas";
export { makeResult };
export async function runWithAudit(_ctx: ToolContext, _tool: string, _scope: string | undefined, run: () => Promise<ToolResult>): Promise<ToolResult> {
  try { return await run(); }
  catch (error) { const normalized = normalizeError(error); return makeResult(normalized.message, { errorCode: normalized.code }, true); }
}
