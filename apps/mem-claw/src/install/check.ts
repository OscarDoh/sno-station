/** @file check.ts
 * @purpose Background self-upgrade orchestration: fetch manifest, decide
 *   whether to act, dispatch to download or activate-existing path.
 * @boundary All failures are silently swallowed. The gateway boot path must
 *   never see an error from this module.
 */

import { readReleaseManifest } from "@snoai/sno-station-mem/release-download";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { writeEmergencyDiagnostic } from "@snoai/sno-station-mem/internal/engine/observability/early-diagnostics";
import { activateExistingVersion, downloadAndStage } from "./download";
import { ensureLayoutDirs, readMemClawPackageVersion, runBootGc } from "./stage";
import { SELF_UPGRADE } from "../constants";

type ManifestShape = {
	schemaVersion: 1;
	name: "@snoai/mem-claw";
	latest: string;
	tarball: string;
	integrity: string;
	requiresPostinstall: boolean;
};

const manifestSchema: z.ZodType<ManifestShape, unknown> = z.object({
	schemaVersion: z.literal(1),
	name: z.literal("@snoai/mem-claw"),
	latest: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/),
	tarball: z.string().url(),
	integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
	requiresPostinstall: z.boolean().optional().default(false),
});

export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Fetch + parse the manifest. Returns `null` on any failure (network, non-2xx,
 * malformed JSON, schema mismatch). Never throws.
 */
export async function fetchManifest(context?: { operation_id: string }): Promise<Manifest | null> {
	const url = process.env.MEM_CLAW_MANIFEST_URL?.trim() || SELF_UPGRADE.manifestUrl;
	const started = performance.now();
	let outcome = "failed";
	let reason = "request_failed";
	let status: number | undefined;
	let failure: unknown;
	try {
		const response = await readReleaseManifest(url, `mem-claw/${readMemClawPackageVersion() ?? "unknown"}`, SELF_UPGRADE.manifestTimeoutMs);
		status = response.status;
		if (!response.ok) {
			reason = "http_status";
			return null;
		}
		reason = "invalid_json";
		const json = response.document;
		const parsed = manifestSchema.safeParse(json);
		outcome = parsed.success ? "success" : "failed";
		reason = parsed.success ? "manifest_valid" : "invalid_schema";
		return parsed.success ? parsed.data : null;
	} catch (error) {
		failure = error;
		return null;
	} finally {
		writeEmergencyDiagnostic({
			level: outcome === "success" ? "debug" : "warn", body: "Upgrade manifest request completed",
			context, attributes: { outcome, reason_code: reason, status, duration_ms: performance.now() - started, ...(failure === undefined ? {} : { error: failure }) },
			source: {
				event_name: "upgrade.manifest.completed",
				file: "apps/mem-claw/src/install/check.ts",
				function: "fetchManifest",
				site_id: "upgrade.manifest.completed",
			},
		});
	}
}

/**
 * Boot-time self-upgrade entry. Fire-and-forget — caller should attach
 * `.catch(() => {})`. Returns void on success and on every silent failure.
 *
 * Sequence: GC → env/source gate → fetch manifest → equality check →
 * dispatch to `downloadAndStage` (new version) or `activateExistingVersion`
 * (rollback to a version we already have on disk).
 */
export async function scheduleBackgroundUpgrade(shimUrl: string): Promise<void> {
	const started = performance.now();
	const context = { operation_id: randomUUID() };
	const complete = (outcome: "success" | "skipped" | "refused" | "failed", reason: string, error?: unknown): void => {
		writeEmergencyDiagnostic({
			level: outcome === "failed" ? "warn" : "info", body: "Background upgrade check completed", context,
			attributes: { outcome, reason_code: reason, duration_ms: performance.now() - started, ...(error === undefined ? {} : { error }) },
			source: {
				event_name: "upgrade.check.completed",
				file: "apps/mem-claw/src/install/check.ts",
				function: "scheduleBackgroundUpgrade",
				site_id: "upgrade.check.completed",
			},
		});
	};
	try {
		runBootGc();
	} catch (error) {
		writeEmergencyDiagnostic({
			level: "warn", body: "Upgrade boot cleanup failed", context, attributes: { error },
			source: {
				event_name: "upgrade.gc.failed",
				file: "apps/mem-claw/src/install/check.ts",
				function: "scheduleBackgroundUpgrade",
				site_id: "upgrade.gc.failed",
			},
		});
	}
	if (process.env.MEM_CLAW_SELF_UPGRADE === "0") return complete("skipped", "disabled");
	if (isLocalSourceLoad(shimUrl)) return complete("skipped", "local_source");

	const manifest = await fetchManifest(context);
	if (!manifest) return complete("failed", "manifest_unavailable");
	if (manifest.requiresPostinstall) return complete("refused", "requires_postinstall");

	const current = readMemClawPackageVersion();
	if (!current) return complete("skipped", "current_version_unavailable");
	if (manifest.latest === current) return complete("skipped", "already_current");

	const layout = ensureLayoutDirs();
	const existingVersionDir = join(layout.versions, manifest.latest);
	try {
		if (existsSync(existingVersionDir)) {
			await activateExistingVersion(manifest.latest, context);
		} else {
			await downloadAndStage(manifest, context);
		}
		complete("success", "staging_completed");
	} catch (error) {
		complete("failed", "staging_failed", error);
	}
}

/**
 * Skip self-upgrade when loaded from the source tree (dev path) or from a
 * dist build that has not been installed under `node_modules`. The presence
 * of `node_modules/@snoai/mem-claw` in the path is the canonical signal
 * that we are running from a real install.
 */
function isLocalSourceLoad(shimUrl: string): boolean {
	const path = fileURLToPath(shimUrl);
	const parts = path.split(/[\\/]+/);
	for (let i = 0; i < parts.length - 2; i += 1) {
		if (
			parts[i] === "node_modules" &&
			parts[i + 1] === "@snoai" &&
			parts[i + 2] === "mem-claw"
		) {
			return false;
		}
	}
	return true;
}

export const __test__: {
	manifestSchema: typeof manifestSchema;
	isLocalSourceLoad: (shimUrl: string) => boolean;
} = { manifestSchema, isLocalSourceLoad };
