/** @file live-clause-verdict-gate.ts
 * @purpose Validates and registers the correctness gate for live profile clause judgments.
 * @boundary Reads committed gate artifacts only; it never calls a model or mutates memory.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MANDATORY_CASE_CLASSES = [
	"ordinary-replacement",
	"pure-retraction",
	"no-op",
	"tombstone",
	"surface-similarity-no-retirement",
] as const;

export type LiveClauseVerdictCaseClass = (typeof MANDATORY_CASE_CLASSES)[number];

export interface LiveClauseVerdictClause {
	origin: "stored" | "incoming";
	value: string;
}

export interface LiveClauseVerdictExpected {
	verdict: "merge" | "tombstone" | "no-op";
	retired_clauses: string[];
}

export interface LiveClauseVerdictCorpusCase {
	id: string;
	case_class: LiveClauseVerdictCaseClass;
	section_name: string;
	live_sibling_section_names?: string[];
	clauses: LiveClauseVerdictClause[];
	expected: LiveClauseVerdictExpected;
}

export interface LiveClauseVerdictCorpus {
	schema_version: 1;
	cases: LiveClauseVerdictCorpusCase[];
}

export interface LiveClauseVerdictAttestation {
	schema_version: 1;
	result: "pass" | "fail";
	artifact_sha256: string;
	prompt_sha256: string;
	model_config_sha256: string;
	judge_implementation_sha256: string;
	evaluated_at: string;
}

const clauseSchema: z.ZodType<LiveClauseVerdictClause> = z
	.object({
		origin: z.enum(["stored", "incoming"]),
		value: z.string().trim().min(1),
	})
	.strict();

const expectedVerdictSchema: z.ZodType<LiveClauseVerdictExpected> = z
	.object({
		verdict: z.enum(["merge", "tombstone", "no-op"]),
		retired_clauses: z.array(z.string().trim().min(1)),
	})
	.strict();

const corpusCaseSchema: z.ZodType<LiveClauseVerdictCorpusCase> = z
	.object({
		id: z.string().trim().min(1),
		case_class: z.enum(MANDATORY_CASE_CLASSES),
		section_name: z.string().trim().min(1),
		live_sibling_section_names: z.array(z.string().trim().min(1)).optional(),
		clauses: z.array(clauseSchema).min(1),
		expected: expectedVerdictSchema,
	})
	.strict()
	.superRefine((entry, context) => {
		const clauseValues = entry.clauses.map((clause) => clause.value);
		if (new Set(clauseValues).size !== clauseValues.length) {
			context.addIssue({ code: "custom", message: "clause values must be unique" });
		}
		if (!entry.clauses.some((clause) => clause.origin === "incoming")) {
			context.addIssue({ code: "custom", message: "an incoming clause is required" });
		}
		if (new Set(entry.expected.retired_clauses).size !== entry.expected.retired_clauses.length) {
			context.addIssue({ code: "custom", message: "retired clauses must be unique" });
		}
		for (const retiredClause of entry.expected.retired_clauses) {
			if (!clauseValues.includes(retiredClause)) {
				context.addIssue({
					code: "custom",
					message: "every retired clause must name a supplied clause",
				});
			}
		}
		if (
			(entry.expected.verdict === "tombstone" || entry.expected.verdict === "no-op") &&
			entry.expected.retired_clauses.length !== 0
		) {
			context.addIssue({
				code: "custom",
				message: "tombstone and no-op cases cannot carry retired clauses",
			});
		}
	});

const corpusSchema: z.ZodType<LiveClauseVerdictCorpus> = z
	.object({
		schema_version: z.literal(1),
		cases: z.array(corpusCaseSchema),
	})
	.strict()
	.superRefine((corpus, context) => {
		const ids = corpus.cases.map((entry) => entry.id);
		if (new Set(ids).size !== ids.length) {
			context.addIssue({ code: "custom", message: "case identifiers must be unique" });
		}
		for (const caseClass of MANDATORY_CASE_CLASSES) {
			if (corpus.cases.filter((entry) => entry.case_class === caseClass).length < 3) {
				context.addIssue({
					code: "custom",
					message: `case class ${caseClass} requires at least three cases`,
				});
			}
		}
	});

const attestationSchema: z.ZodType<LiveClauseVerdictAttestation> = z
	.object({
		schema_version: z.literal(1),
		result: z.enum(["pass", "fail"]),
		artifact_sha256: z.string().regex(SHA256_PATTERN),
		prompt_sha256: z.string().regex(SHA256_PATTERN),
		model_config_sha256: z.string().regex(SHA256_PATTERN),
		judge_implementation_sha256: z.string().regex(SHA256_PATTERN),
		evaluated_at: z.string().datetime({ offset: true }),
	})
	.strict();

export type LiveClauseVerdictGateReason =
	| "artifact_missing"
	| "artifact_unreadable"
	| "artifact_schema_invalid"
	| "attestation_missing"
	| "attestation_unreadable"
	| "attestation_schema_invalid"
	| "attestation_not_passing"
	| "artifact_drift"
	| "prompt_drift"
	| "model_config_drift"
	| "judge_implementation_drift";

export type LiveClauseVerdictRegistration =
	| {
			enabled: true;
			corpus: LiveClauseVerdictCorpus;
			corpusSha256: string;
			attestation: LiveClauseVerdictAttestation;
	  }
	| { enabled: false; reason: LiveClauseVerdictGateReason };

export interface RegisterLiveClauseVerdictSurfaceInput {
	artifactDir: string;
	expectedPromptSha256: string;
	expectedModelConfigSha256: string;
	expectedJudgeImplementationSha256: string;
}

export interface RegisterLiveClauseVerdictArtifactsInput {
	corpus: unknown;
	attestation: unknown;
	expectedPromptSha256: string;
	expectedModelConfigSha256: string;
	expectedJudgeImplementationSha256: string;
}

class LiveClauseVerdictGateError extends Error {
	constructor(readonly reason: LiveClauseVerdictGateReason) {
		super(reason);
		this.name = "LiveClauseVerdictGateError";
	}
}

function readArtifact(path: string, kind: "artifact" | "attestation"): Buffer {
	if (!existsSync(path)) throw new LiveClauseVerdictGateError(`${kind}_missing`);
	try {
		if (!statSync(path).isFile()) {
			throw new LiveClauseVerdictGateError(`${kind}_unreadable`);
		}
		return readFileSync(path);
	} catch (error) {
		if (error instanceof LiveClauseVerdictGateError) throw error;
		throw new LiveClauseVerdictGateError(`${kind}_unreadable`);
	}
}

function parseJson(bytes: Buffer, kind: "artifact" | "attestation"): unknown {
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new LiveClauseVerdictGateError(`${kind}_schema_invalid`);
	}
}

/** Loads and semantically validates the committed correctness corpus. */
export function loadLiveClauseVerdictCorpus(artifactDir: string): LiveClauseVerdictCorpus {
	const bytes = readArtifact(join(artifactDir, "corpus.json"), "artifact");
	const parsed = corpusSchema.safeParse(parseJson(bytes, "artifact"));
	if (!parsed.success) throw new LiveClauseVerdictGateError("artifact_schema_invalid");
	return parsed.data;
}

/** Hashes the semantic artifact so whitespace-only edits do not invalidate correctness. */
export function hashLiveClauseVerdictArtifact(corpus: LiveClauseVerdictCorpus): string {
	return createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
}

/** Registers already-bundled artifacts through the same fail-closed correctness checks. */
export function registerLiveClauseVerdictArtifacts(
	input: RegisterLiveClauseVerdictArtifactsInput,
): LiveClauseVerdictRegistration {
	const corpusResult = corpusSchema.safeParse(input.corpus);
	if (!corpusResult.success) return { enabled: false, reason: "artifact_schema_invalid" };
	const attestationResult = attestationSchema.safeParse(input.attestation);
	if (!attestationResult.success) {
		return { enabled: false, reason: "attestation_schema_invalid" };
	}
	const corpusSha256 = hashLiveClauseVerdictArtifact(corpusResult.data);
	const attestation = attestationResult.data;
	if (attestation.result !== "pass") {
		return { enabled: false, reason: "attestation_not_passing" };
	}
	if (attestation.artifact_sha256 !== corpusSha256) {
		return { enabled: false, reason: "artifact_drift" };
	}
	if (attestation.prompt_sha256 !== input.expectedPromptSha256) {
		return { enabled: false, reason: "prompt_drift" };
	}
	if (attestation.model_config_sha256 !== input.expectedModelConfigSha256) {
		return { enabled: false, reason: "model_config_drift" };
	}
	if (attestation.judge_implementation_sha256 !== input.expectedJudgeImplementationSha256) {
		return { enabled: false, reason: "judge_implementation_drift" };
	}
	return { enabled: true, corpus: corpusResult.data, corpusSha256, attestation };
}

/** Returns an enabled registration only when the correctness attestation matches every binding. */
export function registerLiveClauseVerdictSurface(
	input: RegisterLiveClauseVerdictSurfaceInput,
): LiveClauseVerdictRegistration {
	try {
		const corpusBytes = readArtifact(join(input.artifactDir, "corpus.json"), "artifact");
		const corpusResult = corpusSchema.safeParse(parseJson(corpusBytes, "artifact"));
		if (!corpusResult.success) {
			throw new LiveClauseVerdictGateError("artifact_schema_invalid");
		}
		const corpusSha256 = hashLiveClauseVerdictArtifact(corpusResult.data);
		const attestationBytes = readArtifact(
			join(input.artifactDir, "attestation.json"),
			"attestation",
		);
		const attestationResult = attestationSchema.safeParse(
			parseJson(attestationBytes, "attestation"),
		);
		if (!attestationResult.success) {
			throw new LiveClauseVerdictGateError("attestation_schema_invalid");
		}
		return registerLiveClauseVerdictArtifacts({
			corpus: corpusResult.data,
			attestation: attestationResult.data,
			expectedPromptSha256: input.expectedPromptSha256,
			expectedModelConfigSha256: input.expectedModelConfigSha256,
			expectedJudgeImplementationSha256: input.expectedJudgeImplementationSha256,
		});
	} catch (error) {
		if (error instanceof LiveClauseVerdictGateError) {
			return { enabled: false, reason: error.reason };
		}
		return { enabled: false, reason: "artifact_unreadable" };
	}
}
