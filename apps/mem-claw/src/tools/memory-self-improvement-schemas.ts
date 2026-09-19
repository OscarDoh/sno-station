/** @file memory-self-improvement-schemas.ts
 * @purpose Defines schemas and file mappings for self-improvement tools.
 * @boundary Self-improvement constants and parameter validation only.
 */

import { z } from "./memory-tool-dependencies";

export const LEARNING_TYPE_FILE = {
	learning: "LEARNINGS.md",
	error: "ERRORS.md",
	feature: "FEATURE_REQUESTS.md",
} as const;

export const LEARNING_TYPE_PREFIX = {
	learning: "LRN",
	error: "ERR",
	feature: "FEAT",
} as const;

export const selfImprovementLogSchema: z.ZodType<
	{
		type: "learning" | "error" | "feature";
		summary: string;
		details: string;
		suggestedAction: string;
		category: string;
		area: string;
		priority: string;
	},
	unknown
> = z.object({
	type: z.enum(["learning", "error", "feature"]),
	summary: z.string().min(1),
	details: z.string().default(""),
	suggestedAction: z.string().default(""),
	category: z.string().default("best_practice"),
	area: z.string().default("config"),
	priority: z.string().default("medium"),
});

export const selfImprovementExtractSkillSchema: z.ZodType<
	{
		learningId: string;
		skillName: string;
		sourceFile: "LEARNINGS.md" | "ERRORS.md" | "FEATURE_REQUESTS.md";
		outputDir: string;
	},
	unknown
> = z.object({
	learningId: z.string().regex(/^(LRN|ERR|FEAT)-\d{8}-\d{3}$/),
	skillName: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
	sourceFile: z.enum(["LEARNINGS.md", "ERRORS.md", "FEATURE_REQUESTS.md"]).default("LEARNINGS.md"),
	outputDir: z.string().default("skills"),
});
