import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createRemOwnerDecidedOperationalConfiguration } from "./rem-entry-config-fixture.ts";

export type RemEntryArtifactCondition =
	| "artifact-missing"
	| "digest-mismatch"
	| "artifact-empty"
	| "artifact-unparseable"
	| "artifact-not-regular"
	| "artifact-permissions"
	| "waiver-invalid"
	| "wrong-scope"
	| "semantic-invalid"
	| "valid";

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value !== "object") throw new Error("unsupported canonical JSON value");
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`;
}

export function prepareRemEntryArtifactFixture(
	stateRoot: string,
	condition: RemEntryArtifactCondition,
	operationalConfiguration: Record<string, unknown> = createRemOwnerDecidedOperationalConfiguration(),
): string {
	const gateRoot = join(stateRoot, "sno-station-mem", "rem-gates");
	mkdirSync(gateRoot, { recursive: true });
	const committedGateRoot = resolve(
		import.meta.dirname,
		"../../../../internal/sno-station-mem/evaluation/rem/sno-e2e",
	);
	const operationArtifacts = new Map(
		(["rem-update", "rem-replace"] as const).map((operation) => [
			operation,
			readFileSync(join(committedGateRoot, `${operation}.json`)),
		]),
	);
	const { enableGateDigests: _excluded, ...identityConfiguration } = operationalConfiguration;
	const common = {
		schemaVersion: 1,
		profileId: "sno-e2e",
		configurationSha256: sha256(canonicalJson(identityConfiguration)),
		createdAt: "2026-08-08T08:00:00Z",
	};
	const immutableProfile = `${JSON.stringify({
		...common,
		artifactId: "p5-immutable-profile",
		resolvedParameters: { reasoningEffort: "medium" },
	})}\n`;
	const artifacts: Record<string, Record<string, unknown>> = {
		"p5-production-config": {
			...common,
			artifactId: "p5-production-config",
			result: condition === "semantic-invalid" ? "fail" : "pass",
			servedModel: "gpt-5.6-terra",
			resolvedParameters: { reasoningEffort: "medium" },
			readbackSource: "immutable-profile",
			immutableProfileSha256: sha256(immutableProfile),
		},
		"p6-monthly-non-regression": {
			...common,
			artifactId: "p6-monthly-non-regression",
			period: "2026-08",
			minima: { accuracy: 1 },
			measured: { accuracy: 1 },
			result: "pass",
		},
		"p7-detector-gate-verdict": {
			...common,
			artifactId: "p7-detector-gate-verdict",
			kind: "measured-pass",
			minima: { accuracy: 1 },
			measured: { accuracy: 1 },
			result: "pass",
			...(condition === "wrong-scope" ? { profileId: "SNO-E2E" } : {}),
		},
		"population-routing": {
			...common,
			artifactId: "population-routing",
			producedAtHead: "a".repeat(40),
			classifierSha256: "b".repeat(64),
			fixtureSetSha256: "c".repeat(64),
			derivationCommand: "npm run rem:derive-routing",
			invocationId: "acc5-installed-cli",
			observations: [
				["value-swap", "transition-narrative", "ACCEPTED"],
				["negated-current", "transition-narrative", "ACCEPTED"],
				["list-prune", "transition-narrative", "ACCEPTED"],
				["required-refuse-rider", "transition-narrative", "ACCEPTED"],
				["pure-negation", "no-owner", "ACCEPTED"],
				["mutant-1", "n/a", "REJECTED"],
				["mutant-2", "n/a", "REJECTED"],
				["mutant-3", "n/a", "REJECTED"],
			].map(([fixtureId, observedRoute, observedVerdict]) => ({
				fixtureId,
				inputSha256: sha256(fixtureId ?? ""),
				observedRoute,
				observedVerdict,
			})),
		},
	};
	writeFileSync(join(gateRoot, "p5-immutable-profile.json"), immutableProfile, {
		mode: 0o600,
	});
	const digests: Record<string, string> = {
		"p5-immutable-profile": sha256(immutableProfile),
	};
	for (const [operation, bytes] of operationArtifacts) {
		writeFileSync(join(gateRoot, `${operation}.json`), bytes, { mode: 0o600 });
		digests[operation] = sha256(bytes);
	}
	for (const [artifactId, artifact] of Object.entries(artifacts)) {
		const bytes = `${JSON.stringify(artifact)}\n`;
		writeFileSync(join(gateRoot, `${artifactId}.json`), bytes, { mode: 0o600 });
		digests[artifactId] = sha256(bytes);
	}
	const p7Path = join(gateRoot, "p7-detector-gate-verdict.json");
	if (condition === "artifact-empty" || condition === "artifact-unparseable") {
		const bytes = condition === "artifact-empty" ? "" : "not-json\n";
		writeFileSync(p7Path, bytes, { mode: 0o600 });
		digests["p7-detector-gate-verdict"] = sha256(bytes);
	}
	if (condition === "waiver-invalid") {
		const bytes = `${JSON.stringify({
			...common,
			artifactId: "p7-detector-gate-verdict",
			kind: "owner-waiver",
			result: "pass",
			waivedBy: "owner",
		})}\n`;
		writeFileSync(p7Path, bytes, { mode: 0o600 });
		digests["p7-detector-gate-verdict"] = sha256(bytes);
	}
	if (condition === "artifact-missing") {
		unlinkSync(join(gateRoot, "p5-production-config.json"));
	}
	if (condition === "digest-mismatch") {
		digests["p6-monthly-non-regression"] = "0".repeat(64);
	}
	if (condition === "artifact-not-regular") {
		unlinkSync(p7Path);
		symlinkSync(join(gateRoot, "p5-production-config.json"), p7Path);
	}
	for (const artifactId of [
		...operationArtifacts.keys(),
		...Object.keys(artifacts),
		"p5-immutable-profile",
	]) {
		const artifactPath = join(gateRoot, `${artifactId}.json`);
		if (condition !== "artifact-missing" || artifactId !== "p5-production-config") {
			if (condition !== "artifact-not-regular" || artifactId !== "p7-detector-gate-verdict") {
				chmodSync(artifactPath, 0o600);
			}
		}
	}
	if (condition === "artifact-permissions") chmodSync(p7Path, 0o622);
	const configurationSource = JSON.stringify({
		...operationalConfiguration,
		enableGateDigests: digests,
	});
	prepareDefaultGrammarInputs(stateRoot, configurationSource);
	return configurationSource;
}

function prepareDefaultGrammarInputs(stateRoot: string, configurationSource: string): void {
	const snoStationMemRoot = join(stateRoot, "sno-station-mem");
	const corpusRoot = join(snoStationMemRoot, "rem-grammar-corpus");
	mkdirSync(corpusRoot, { recursive: true });
	writeFileSync(join(snoStationMemRoot, "rem-operational-config.accepted.json"), configurationSource, {
		mode: 0o600,
	});
	writeFileSync(
		join(corpusRoot, "production-reachability.jsonl"),
		`${JSON.stringify({ input: "The user no longer prefers tea.", expected: "negated-current" })}\n`,
		{ mode: 0o600 },
	);
}
