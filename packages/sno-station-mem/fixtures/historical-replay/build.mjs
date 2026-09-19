import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const conformancePath = resolve(fixtureDir, "../row-state-conformance/conformance-output.json");
const outputPath = resolve(fixtureDir, "historical-replay-population.json");
const bytes = readFileSync(conformancePath);
const conformance = JSON.parse(bytes.toString("utf8"));

if (
	!Array.isArray(conformance.rows) ||
	conformance.counts.total !== conformance.rows.length ||
	conformance.counts.staleCurrent !== 53
) {
	throw new Error("historical replay input no longer matches the pinned row-state population");
}

const rows = conformance.rows.map((row) => ({
	rowId: row.rowId,
	caseId: row.caseId,
	generation: row.generation,
	sourceKind: row.sourceKind,
	state: row.state,
	owner: row.owner,
	ambiguous: row.ambiguous,
}));
const output = {
	schemaVersion: 1,
	replayKind: "deterministic-row-state-only",
	input: {
		path: "packages/rem-core/fixtures/row-state-conformance/conformance-output.json",
		sha256: createHash("sha256").update(bytes).digest("hex"),
	},
	counts: {
		totalRows: rows.length,
		verdictOwnedStaleCurrentRows: rows.filter(
			(row) => row.state === "stale-current" && row.owner === "verdict",
		).length,
	},
	limitations: [
		"This fixture records deterministic row-state replay only.",
		"It does not reconstruct historical embedding, ranking, candidate sets, or older/newer pairs.",
		"It must not be used as target-pair coverage evidence for an enable gate.",
	],
	rows,
};

const outputBytes = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes("--write")) {
	writeFileSync(outputPath, outputBytes);
} else if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== outputBytes) {
	throw new Error("historical replay output is stale; rerun with --write after review");
}
