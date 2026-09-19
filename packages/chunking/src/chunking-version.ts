/**
 * Per PRD §7.4 / §15.1.2. Locked input to deterministic chunk IDs.
 *
 * Historical rule: bumping this version changes every deterministic chunk ID and forces
 * re-ingest. The chunking-superset release is a deliberate hard cut with no published
 * data to invalidate, and the frozen 0.99.1 prose/conversation snapshots must remain
 * byte-identical. Do not align this value with npm package semver; the package can ship
 * as 1.0.0 while this chunk-output ID version stays 1.1.0.
 */
export const CHUNKING_VERSION = "1.1.0" as const;
