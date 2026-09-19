import { z } from "zod";

/**
 * Per PRD §10.5 / §15.1.2. Bonuses applied during chunk-to-memory aggregation.
 *
 * Invariant: `bonusTotalInvariant >= multiHitBonusCap + adjacencyBonusCap`. The
 * caps must not exceed the empirical gap between adjacent rerank scores in
 * production traces, otherwise bonuses can flip a higher-quality single hit.
 */
export const AggregationConfigSchema = z
	.object({
		// `.finite()` rejects `Infinity` / `NaN` — without it, an `Infinity` cap
		// would silently bypass the bonus invariant guard and produce
		// `Infinity`/`NaN` memory scores that destabilize ranking.
		multiHitBonusPerHit: z.number().finite().nonnegative().default(0.03),
		multiHitBonusCap: z.number().finite().nonnegative().default(0.1),
		adjacencyBonusPerPair: z.number().finite().nonnegative().default(0.02),
		adjacencyBonusCap: z.number().finite().nonnegative().default(0.06),
		bonusTotalInvariant: z.number().finite().nonnegative().default(0.16),
	})
	.strict()
	.refine((c) => c.bonusTotalInvariant >= c.multiHitBonusCap + c.adjacencyBonusCap, {
		message: "bonusTotalInvariant must be >= multiHitBonusCap + adjacencyBonusCap",
	});

/** Per PRD §10.5. Inferred type from schema. */
export type AggregationConfig = z.infer<typeof AggregationConfigSchema>;

/** Per PRD §10.5 / §15.1.2. Launch defaults (re-tunable post-deploy via config). */
export const DEFAULT_AGGREGATION_CONFIG: AggregationConfig = {
	multiHitBonusPerHit: 0.03,
	multiHitBonusCap: 0.1,
	adjacencyBonusPerPair: 0.02,
	adjacencyBonusCap: 0.06,
	bonusTotalInvariant: 0.16,
};
