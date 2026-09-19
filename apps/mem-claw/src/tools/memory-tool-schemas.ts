import type {
	TOptional,
	TRecord,
	TString,
	TUnknown,
	TUnsafe,
} from "@sinclair/typebox";
import type { ToolDescriptionsNs } from "@snoai/sno-station-mem/internal/engine/i18n/res/_types";
import type { Locale } from "./memory-tool-dependencies";
import { DEFAULT_LOCALE, RESOURCES_BY_LOCALE, Type } from "./memory-tool-dependencies";


export function resolveToolDescriptions(language?: Locale): ToolDescriptionsNs {
	return RESOURCES_BY_LOCALE[language ?? DEFAULT_LOCALE].toolDescriptions;
}
export const metadataType: TOptional<TRecord<TString, TUnknown>> = Type.Optional(
	Type.Record(Type.String(), Type.Unknown()),
);
export const stringEnum = <T extends readonly string[]>(values: T): TUnsafe<T[number]> =>
	Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
export type { ToolResult } from "@snoai/sno-station-mem/internal/engine/bindings/memory-tool-schemas";
import type { MemoryConnection } from "../install/memory-connection";
export interface ToolContext {
  connection: MemoryConnection;
  stateDir: string;
  workspaceDir?: string;
  agentId?: string;
  language?: Locale;
  selfImprovementEnabled?: boolean;
}
