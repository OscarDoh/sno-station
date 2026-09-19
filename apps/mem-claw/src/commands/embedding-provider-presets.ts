/** @file embedding-provider-presets.ts
 * @purpose Named bundles of embedder config that the `sno-mem-config embedder` CLI maps to
 *          the JSON shape consumed by `PluginConfig.embedding`.
 * @boundary Read-only constants. No filesystem, no network, no schema validation.
 * @see plugin/memory-management-cli.ts (sno-mem-config embedder show / set / wipe-db).

 */

export const EMBEDDER_PRESETS = {
	// pplx-embed-v1-0.6b standard INT8: MIT-licensed PPLX export using standard
	// ONNX quantization ops. Mean pooling is required.
	"local-pplx": {
		provider: "local-onnx",
		model: "tss-deposium/pplx-embed-v1-0.6b-onnx-int8-standard",
		revision: "a18fdffe7480e6ea5643acb7757142b33838817a",
		nativeDim: 1024,
		dimensions: 1024,
		dtype: "q8",
		pooling: "mean",
		sessionOptions: {
			graphOptimizationLevel: "extended",
			enableMemPattern: false,
			enableCpuMemArena: false,
		},
	},
} as const;

export type EmbedderPresetName = keyof typeof EMBEDDER_PRESETS;

export const DEFAULT_PRESET: EmbedderPresetName = "local-pplx";

export function listPresets(): EmbedderPresetName[] {
	return Object.keys(EMBEDDER_PRESETS) as EmbedderPresetName[];
}

export function isPresetName(value: string): value is EmbedderPresetName {
	return Object.hasOwn(EMBEDDER_PRESETS, value);
}
