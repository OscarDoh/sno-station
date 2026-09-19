import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const corpusPath = readOption("--corpus");
if (!corpusPath) {
	refuse(
		"calibration corpus is required: pass --corpus <path>; calibration corpus is owed, and the harness refuses rather than fabricating",
	);
}

let corpus;
try {
	corpus = JSON.parse(readFileSync(resolve(process.cwd(), corpusPath), "utf8"));
} catch (error) {
	refuse(`calibration corpus could not be read: ${errorMessage(error)}`);
}

const corpusErrors = validateCorpus(corpus);
if (corpusErrors.length > 0) {
	refuse(`invalid calibration corpus: ${corpusErrors.join(", ")}`);
}

const calibration = JSON.parse(
	readFileSync(resolve(fixtureDir, "calibration-predeclaration.json"), "utf8"),
);
const plan = {
	schemaVersion: 1,
	inputContract: "historical-calibration-corpus.schema.json",
	corpusSnapshotSha256: corpus.corpusSnapshotSha256,
	targetPairCount: corpus.targetPairs.length,
	arms: ["control", "update-only", "replace-only", "combined"],
	soloArmRule: "Each solo arm must be non-negative beyond the noise band.",
	combinedArmRule: "The combined arm decides enabling but cannot rescue a negative solo arm.",
	calibrationStatus: "corpus-accepted-run-owed",
	predeclaredCoverage: calibration.predeclaredCoverage,
	runnable: true,
	gateReady: false,
};

if (process.argv.includes("--json")) {
	process.stdout.write(`${JSON.stringify(plan)}\n`);
} else {
	process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function readOption(name) {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

function validateCorpus(value) {
	if (!isRecord(value)) return ["root must be an object"];
	const errors = [];
	if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
	for (const field of [
		"corpusSnapshotSha256",
		"embeddingSnapshotSha256",
		"rankingConfigSha256",
	]) {
		if (!isSha256(value[field])) errors.push(`${field} must be a lowercase SHA-256 hex digest`);
	}
	if (!Array.isArray(value.targetPairs) || value.targetPairs.length === 0) {
		errors.push("targetPairs must be a non-empty array");
		return errors;
	}
	const relationIds = new Set();
	const ranks = new Set();
	for (const [index, pair] of value.targetPairs.entries()) {
		const prefix = `targetPairs[${index}]`;
		if (!isRecord(pair)) {
			errors.push(`${prefix} must be an object`);
			continue;
		}
		if (!isNonEmptyString(pair.relationId)) errors.push(`${prefix}.relationId is required`);
		else if (relationIds.has(pair.relationId)) errors.push(`${prefix}.relationId must be unique`);
		else relationIds.add(pair.relationId);
		validateRow(pair.older, `${prefix}.older`, errors);
		validateRow(pair.newer, `${prefix}.newer`, errors);
		if (!Number.isInteger(pair.candidateRank) || pair.candidateRank < 1) {
			errors.push(`${prefix}.candidateRank must be a positive integer`);
		} else if (ranks.has(pair.candidateRank)) {
			errors.push(`${prefix}.candidateRank must be unique`);
		} else {
			ranks.add(pair.candidateRank);
		}
		if (
			typeof pair.similarityScore !== "number" ||
			!Number.isFinite(pair.similarityScore) ||
			pair.similarityScore < 0 ||
			pair.similarityScore > 1
		) {
			errors.push(`${prefix}.similarityScore must be a finite number from 0 through 1`);
		}
		if (
			isRecord(pair.older) &&
			isRecord(pair.newer) &&
			isDateTime(pair.older.validTime) &&
			isDateTime(pair.newer.validTime) &&
			Date.parse(pair.older.validTime) > Date.parse(pair.newer.validTime)
		) {
			errors.push(`${prefix}.older.validTime must not be after newer.validTime`);
		}
	}
	return errors;
}

function validateRow(value, prefix, errors) {
	if (!isRecord(value)) {
		errors.push(`${prefix} must be an object`);
		return;
	}
	if (!isNonEmptyString(value.rowId)) errors.push(`${prefix}.rowId is required`);
	if (!isNonEmptyString(value.text)) errors.push(`${prefix}.text is required`);
	if (!isDateTime(value.validTime)) errors.push(`${prefix}.validTime must be an ISO date-time`);
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isDateTime(value) {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function refuse(message) {
	process.stderr.write(`REFUSED: ${message}\n`);
	process.exit(1);
}
