/**
 * Shared renderer for the Path A install-time trade-off nudge.
 *
 * Single source of truth — both the npm install wrapper
 * (`bin/mem-claw-install.js`) and the plugin-side
 * `src/plugin/path-a-install-nudge.ts` import this file. The AC5 drift unit
 * test pins the output of both branches via snapshot.
 *
 * Plain JS (ESM) so the wrapper can `import` it at npm install time
 * without a TypeScript build step. A colocated `.d.ts` provides types
 * for the TS consumer.
 *
 */

const PLUGIN_ID = "sno-mem-claw";
const SET_K_CMD = (k) =>
	`openclaw config set plugins.entries.${PLUGIN_ID}.config.retrieval.recallTopK ${k}`;

export function renderPathANudge({ defaultK, leanK, chosen = "default" }) {
	if (chosen === "lean") {
		return [
			`[${PLUGIN_ID}] installed. recallTopK=${leanK} (lean; ~20-25% fewer injected tokens than default).`,
			`[${PLUGIN_ID}] Restore default? \`${SET_K_CMD(defaultK)}\` — wider recall coverage at higher token cost.`,
			`[${PLUGIN_ID}] Re-tune later: open Control UI → Plugins → ${PLUGIN_ID}, or run \`openclaw config set ...\` above.`,
		].join("\n");
	}
	return [
		`[${PLUGIN_ID}] installed. recallTopK=${defaultK} (default; tuned for the 384-token retrieval chunk profile).`,
		`[${PLUGIN_ID}] Run leaner? \`${SET_K_CMD(leanK)}\` — ~20-25% fewer injected tokens, may narrow recall coverage.`,
		`[${PLUGIN_ID}] Re-tune later: open Control UI → Plugins → ${PLUGIN_ID}, or run \`openclaw config set ...\` above.`,
	].join("\n");
}
