/** Durable D5 verdict/evidence fixture for real-SQLite writer acceptance. */

import type { TestDb } from "./test-db.ts";

type VerdictRelationship = "match" | "mismatch" | "absent";

export function seedRemWriteVerdict(
	fixture: TestDb,
	input: {
		rowId: string;
		evidenceId: string;
		relationship?: VerdictRelationship;
		winnerRowId?: string;
	},
): void {
	const row = fixture.runtime.raw
		.prepare("SELECT text FROM nodix_memories WHERE id = ?")
		.get(input.rowId) as { text: string } | undefined;
	if (row === undefined) throw new Error(`missing verdict fixture row ${input.rowId}`);
	const atom = row.text;
	fixture.runtime.raw
		.prepare("UPDATE nodix_memories SET raw_candidate_json = ? WHERE id = ?")
		.run(JSON.stringify({ retiredFactAtoms: [atom] }), input.rowId);
	if (input.relationship === "absent") return;
	const sourceRowId = `${input.rowId}-source`;
	seedSourceRow(fixture, sourceRowId);
	const targetRowId = input.relationship === "mismatch" ? sourceRowId : input.rowId;
	fixture.runtime.raw
		.prepare(
			`INSERT INTO nodix_rem_write_verdicts(
				evidence_id, winner_row_id, loser_row_id, target_row_id,
				retired_fact_atoms_json, recorded_at
			) VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(
			input.evidenceId,
			input.winnerRowId ?? targetRowId,
			input.rowId,
			targetRowId,
			JSON.stringify([atom]),
			"2026-08-08T08:00:15.000Z",
		);
}

function seedSourceRow(fixture: TestDb, rowId: string): void {
	fixture.runtime.raw
		.prepare(
			`INSERT INTO nodix_memories(
				id, text, category, project_id, importance, timestamp, timezone, metadata, content_hash,
				fact_id, lane, raw_candidate_json
			) VALUES (?, ?, 'profile', 'rem-replace-source', 0.7, ?, 'UTC', '{}', ?, ?, 'active', '{}')`,
		)
		.run(
			rowId,
			"The source row carries the earlier workspace preference.",
			Date.parse("2026-08-08T07:59:00.000Z"),
			"f".repeat(64),
			`fact-${rowId}`,
		);
}
