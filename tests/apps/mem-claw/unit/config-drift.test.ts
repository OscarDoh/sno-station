/**
 * AC5 drift detection — pins the four surfaces of `recallTopK` to a single
 * source of truth (`AUTO_RECALL_INJECTION_TOP_K`, `AUTO_RECALL_LEAN_TOP_K`).
 *
 * Surfaces under test:
 *   1. JSON schema default in `openclaw.plugin.json`.
 *   2. `uiHints["retrieval.recallTopK"].help` text — must declare both
 *      `Default <N>` and `Lean <N>` tokens.
 *   3. Zod runtime default surfaced via `pluginConfigSchema.parse({})`.
 *   4. Path A nudge renderer output — regression-locked snapshot + literal
 *      assertions for the K values.
 *
 * Drift in any one fails CI. PRD: §2.6(3), §2.8 AC5.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../apps/mem-claw/openclaw.plugin.json";
import {
	AUTO_RECALL_INJECTION_TOP_K,
	AUTO_RECALL_LEAN_TOP_K,
} from "../../../../packages/sno-station-mem/config/index";
import { renderPathANudge } from "../../../../apps/mem-claw/src/install/path-a-install-nudge";
import { pluginConfigSchema } from "../../../../packages/sno-station-mem/src/engine/shared/types";
import {
	DEFAULT_MODEL_MODE,
	PRODUCT_MODES,
} from "@snoai/sno-station-mem/internal/config/skin-defaults";

describe("memory mode source of truth", () => {
	it("keeps the manifest mirror and runtime default aligned with the shared model mode", () => {
		const mode = manifest.configSchema.properties.mode;
		expect(mode.enum).toEqual(PRODUCT_MODES);
		expect(mode.default).toBe(DEFAULT_MODEL_MODE);
		expect(pluginConfigSchema.parse({}).mode).toBe(DEFAULT_MODEL_MODE);
	});

	it.each(PRODUCT_MODES)("preserves the explicit %s mode", (mode) => {
		expect(pluginConfigSchema.parse({ mode }).mode).toBe(mode);
	});
});

describe("AC5 config drift — recallTopK", () => {
	it("JSON schema allows a rerank candidate cap of 2000", () => {
		expect(manifest.configSchema.properties.retrieval.properties.rerankMaxCandidates.maximum).toBe(2000);
	});

	it("JSON schema default equals AUTO_RECALL_INJECTION_TOP_K", () => {
		const recallTopK =
			manifest.configSchema.properties.retrieval.properties.recallTopK;
		expect(recallTopK.default).toBe(AUTO_RECALL_INJECTION_TOP_K);
		expect(recallTopK.minimum).toBe(1);
		expect(recallTopK.maximum).toBe(300);
	});

	it("uiHints help text declares both default and lean K via `Default <N>` / `Lean <N>` tokens", () => {
		const hints = manifest.uiHints as Record<
			string,
			{ help?: string } | undefined
		>;
		const entry = hints["retrieval.recallTopK"];
		if (!entry?.help) {
			throw new Error(
				"uiHints['retrieval.recallTopK'].help is missing — AC5 cannot run",
			);
		}
		const help = entry.help;
		const parseToken = (label: string): number => {
			const match = new RegExp(`\\b${label} (\\d+)\\b`).exec(help);
			if (!match) {
				throw new Error(
					`uiHints help text missing '${label} <N>' token: ${help}`,
				);
			}
			const captured = match[1];
			if (captured === undefined) {
				throw new Error(
					`regex matched but capture group undefined for '${label}'`,
				);
			}
			return Number(captured);
		};
		expect(parseToken("Default")).toBe(AUTO_RECALL_INJECTION_TOP_K);
		expect(parseToken("Lean")).toBe(AUTO_RECALL_LEAN_TOP_K);
	});

	it("Zod runtime default equals AUTO_RECALL_INJECTION_TOP_K", () => {
		const parsed = pluginConfigSchema.parse({});
		expect(parsed.retrieval.recallTopK).toBe(AUTO_RECALL_INJECTION_TOP_K);
	});

	it("does not expose a capture character limit", () => {
		expect("captureMaxChars" in manifest.uiHints).toBe(false);
		expect("captureMaxChars" in manifest.configSchema.properties).toBe(false);
		expect("captureMaxChars" in pluginConfigSchema.parse({})).toBe(false);
		expect(() => pluginConfigSchema.parse({ captureMaxChars: 500 })).toThrow();
	});

	it("Path A nudge — default branch matches the snapshot and references both K values", () => {
		const rendered = renderPathANudge({
			defaultK: AUTO_RECALL_INJECTION_TOP_K,
			leanK: AUTO_RECALL_LEAN_TOP_K,
		});
		expect(rendered).toMatchSnapshot();
		expect(rendered).toContain(`recallTopK=${AUTO_RECALL_INJECTION_TOP_K}`);
		expect(rendered).toContain(`recallTopK ${AUTO_RECALL_LEAN_TOP_K}`);
	});

	it("Path A nudge — lean branch matches the snapshot and inverts the chosen/alt K", () => {
		const rendered = renderPathANudge({
			defaultK: AUTO_RECALL_INJECTION_TOP_K,
			leanK: AUTO_RECALL_LEAN_TOP_K,
			chosen: "lean",
		});
		expect(rendered).toMatchSnapshot();
		// Lean is the chosen K, default is the alt-cmd K.
		expect(rendered).toContain(`recallTopK=${AUTO_RECALL_LEAN_TOP_K}`);
		expect(rendered).toContain(`recallTopK ${AUTO_RECALL_INJECTION_TOP_K}`);
		expect(rendered).toContain("Restore default?");
	});
});
