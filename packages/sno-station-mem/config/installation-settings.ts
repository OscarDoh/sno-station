import { DEFAULT_MODEL_MODE, PRODUCT_MODES, remEnhancedConfigSchema } from "./plugin-config-mode-schema";
import path from "node:path";
import { z } from "zod";
import { FIXED_EXTRACTION_KEY_NAME } from "../src/model/signed-registry-constants";

function containsCredential(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsCredential);
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([key, item]) =>
		(/apiKey$|^(token|credential|password|secret|authorization)$/i.test(key) && item !== undefined && item !== "") || containsCredential(item));
}

export interface InstallationInput {
	embedding?: Record<string, unknown>;
	extractionKeyRef?: typeof FIXED_EXTRACTION_KEY_NAME;
	mode?: (typeof PRODUCT_MODES)[number];
	retrieval?: Record<string, unknown>;
	rerankKeyRef?: "SNO_STATION_MEM_RERANK_API_KEY";
	memoryTelemetry?: { enabled: boolean; currentKeyVersion: number };
	autoRecallTimeoutMs?: number;
	remOperations?: ("rem-replace" | "rem-update")[];
	remEnhanced?: z.infer<typeof remEnhancedConfigSchema>;
}
export interface InstallationSettings {
	storePath: string;
	embedding: Record<string, unknown>;
	extractionKeyRef: typeof FIXED_EXTRACTION_KEY_NAME;
	mode: (typeof PRODUCT_MODES)[number];
	retrieval: Record<string, unknown>;
	rerankKeyRef?: "SNO_STATION_MEM_RERANK_API_KEY";
	memoryTelemetry?: { enabled: boolean; currentKeyVersion: number };
	autoRecallTimeoutMs?: number;
	remOperations?: ("rem-replace" | "rem-update")[];
	remEnhanced?: z.infer<typeof remEnhancedConfigSchema>;
}
const inputSchema = z.strictObject({
	embedding: z.record(z.string(), z.unknown()).refine(value => !containsCredential(value), "credential values are not installation settings").default({}),
	extractionKeyRef: z.literal(FIXED_EXTRACTION_KEY_NAME).default(FIXED_EXTRACTION_KEY_NAME),
	remEnhanced: remEnhancedConfigSchema.optional(),
	remOperations: z.array(z.enum(["rem-replace", "rem-update"])).optional(),
	mode: z.enum(PRODUCT_MODES).default(DEFAULT_MODEL_MODE),
	retrieval: z.record(z.string(), z.unknown()).refine(value => !containsCredential(value), "credential values are not installation settings").default({}),
	rerankKeyRef: z.literal("SNO_STATION_MEM_RERANK_API_KEY").optional(),
	memoryTelemetry: z.strictObject({ enabled: z.boolean(), currentKeyVersion: z.number().int().positive() }).optional(),
	autoRecallTimeoutMs: z.number().int().min(500).max(60000).optional(),
});
export const installationInputSchema: z.ZodType<Omit<InstallationSettings, "storePath">, unknown> = inputSchema;
export const installationSettingsSchema: z.ZodType<InstallationSettings, unknown> = inputSchema.extend({
	storePath: z.string().refine(path.isAbsolute),
});
