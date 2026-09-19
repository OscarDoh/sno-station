
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { ContractError } from "@snoai/sno-station-mem/client";
import { readEstimatedSpendToday } from "@snoai/sno-station-mem/internal/engine/operations/daily-spend-estimator";
import { emptyToolResponse, isSystemCommandCaller, parseClearArgs, formatBreakdown } from "./openclaw-command-helpers";
import type { MemoryConnection } from "../install/memory-connection";
import { MEMORY_SUBCOMMANDS } from "../constants";
export interface CommandDeps { connection: MemoryConnection; stateDir: string; installationId?: string }
export function registerCompletionTools(api: OpenClawPluginApi): void {
	const names = [
		"memory_recall",
		"memory_store",
		"memory_forget",
		"memory_update",
		"memory_stats",
		"memory_list",
		"memory_reflection_resolve",
	] as const;
	for (const name of names) {
		api.registerTool(
			{
				name,
				label: name,
				description: "Completion-mode stub",
				parameters: Type.Object({}),
				/** Executes the registered command after SDK argument validation and shared safety checks. */
				async execute() {
					return emptyToolResponse();
				},
			},
			{ name },
		);
	}
}

type RegisteredCommand = Parameters<OpenClawPluginApi["registerCommand"]>[0];
type MemorySubcommand = (typeof MEMORY_SUBCOMMANDS)[number];
type CommandContext = Parameters<RegisteredCommand["handler"]>[0];
const MEMORY_COMMAND_USAGE = "Usage: /memory <stats|status|search|clear> ...";

function isMemorySubcommand(value: string): value is MemorySubcommand {
	return (MEMORY_SUBCOMMANDS as readonly string[]).includes(value);
}

function parseMemoryCommandArgs(raw: string | undefined): {
	subcommand?: MemorySubcommand;
	args?: string;
} {
	const trimmed = raw?.trim();
	if (!trimmed) return {};
	const [candidate, ...rest] = trimmed.split(/\s+/);
	if (!candidate) return {};
	const subcommand = candidate.toLowerCase();
	if (!isMemorySubcommand(subcommand)) return {};
	const args = rest.join(" ").trim();
	return {
		subcommand,
		...(args ? { args } : {}),
	};
}


export function registerPluginCommands(api: OpenClawPluginApi, deps: CommandDeps): void {
  api.registerCommand({ name: "memory", description: "Manage Sno Memory", acceptsArgs: true, requireAuth: true,
    handler: async ctx => {
      const parsed = parseMemoryCommandArgs(ctx.args ?? ctx.commandBody);
      if (!parsed.subcommand) return { text: MEMORY_COMMAND_USAGE };
      const client = await deps.connection.ready();
      const scope = await deps.connection.scope(ctx);
      if (parsed.subcommand === "clear") {
        const args = parseClearArgs(parsed.args);
        if (!args.yes) return { text: "Confirmation required: add --yes." };
        if (!args.scope && !args.all) return { text: "Specify --scope <scope> with --yes. Use --all --yes only from a system command context." };
        if (args.scope && args.all) return { text: "Use either --scope <scope> or --all, not both." };
        const result = await client.mutate({ op: "clear", confirm: args.yes, all: args.all }, await deps.connection.scope(ctx, args.scope));
        return { text: result.result.content.map(part => part.text).join("\n") };
      }
      if (parsed.subcommand === "search") {
        if (!parsed.args?.trim()) return { text: "Usage: /memory search <query>" };
        const result = await client.getRecall(parsed.args, scope, { source: "manual", limit: 5 });
        if (result.degraded) throw new ContractError(result.reason);
        return { text: result.contextText || "No matching memories found." };
      }
      const result = await client.inspect({ op: "stats", scope: isSystemCommandCaller(ctx) ? undefined : scope.project }, scope);
      if (result.degraded) throw new ContractError(result.reason);
      if (result.result.op !== "stats") throw new ContractError("engine-failed");
      return { text: [`Total memories: ${result.result.total}`, ...formatBreakdown("Scopes", result.result.projectBreakdown), ...formatBreakdown("Categories", result.result.categoryBreakdown), `Estimated spend today: $${(await readEstimatedSpendToday(deps.stateDir)).toFixed(4)}`, ...(parsed.subcommand === "status" ? [`Store: ${client.storePath}`, `Sidecar PID: ${client.pid}`] : [])].join("\n") };
    },
  });
}
