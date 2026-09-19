import { z } from "zod";
import { type ChunkConfig, ChunkConfigSchema } from "./chunk-config.js";
import type { ChunkMetadataDraft } from "./chunk-metadata.js";
import { CHUNKING_VERSION } from "./chunking-version.js";
import { countTokens } from "./tokenize.js";

export type StructuredJsonValue =
	| null
	| boolean
	| number
	| string
	| StructuredJsonValue[]
	| { [key: string]: StructuredJsonValue };

export const StructuredJsonValueSchema: z.ZodType<StructuredJsonValue> = z.lazy(() =>
	z.union([
		z.null(),
		z.boolean(),
		z.number(),
		z.string(),
		z.array(StructuredJsonValueSchema),
		z.record(z.string(), StructuredJsonValueSchema),
	]),
);

const StructuredTextPartSchema = z
	.object({
		kind: z.literal("text"),
		text: z.string(),
		label: z.string().min(1).optional(),
	})
	.strict();

const StructuredJsonPartSchema = z
	.object({
		kind: z.literal("json"),
		value: StructuredJsonValueSchema,
		label: z.string().min(1).optional(),
	})
	.strict();

const StructuredRawPartSchema = z
	.object({
		kind: z.literal("raw"),
		text: z.string(),
		label: z.string().min(1).optional(),
	})
	.strict();

export const StructuredMixedPartSchema = z.discriminatedUnion("kind", [
	StructuredTextPartSchema,
	StructuredJsonPartSchema,
	StructuredRawPartSchema,
]);

export type StructuredMixedPart = z.infer<typeof StructuredMixedPartSchema>;

export const StructuredChunkInputSchema = z.union([
	z.array(StructuredMixedPartSchema),
	StructuredJsonValueSchema,
]);

export type StructuredChunkInput = StructuredJsonValue | StructuredMixedPart[];

interface StructuredSegment {
	path: string;
	text: string;
}

interface OffsetStructuredSegment extends StructuredSegment {
	startOffset: number;
	endOffset: number;
}

interface ParsedJsonString {
	ok: boolean;
	value?: StructuredJsonValue;
}

function stableJsonStringify(value: StructuredJsonValue): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;

	const entries = Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key] ?? null)}`);
	return `{${entries.join(",")}}`;
}

function appendObjectKey(path: string, key: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `${path}.${key}`;
	return `${path}[${JSON.stringify(key)}]`;
}

function flattenJson(value: StructuredJsonValue, path: string): StructuredSegment[] {
	if (Array.isArray(value)) {
		if (value.length === 0) return [{ path, text: `${path}: []` }];
		return value.flatMap((item, index) => flattenJson(item, `${path}[${index}]`));
	}

	if (value !== null && typeof value === "object") {
		const keys = Object.keys(value).sort();
		if (keys.length === 0) return [{ path, text: `${path}: {}` }];
		return keys.flatMap((key) => flattenJson(value[key] ?? null, appendObjectKey(path, key)));
	}

	return [{ path, text: `${path}: ${stableJsonStringify(value)}` }];
}

function labelSuffix(label: string | undefined): string {
	return label === undefined ? "" : ` [${label}]`;
}

function flattenMixedPart(part: StructuredMixedPart, index: number): StructuredSegment[] {
	const basePath = `$parts[${index}]`;
	switch (part.kind) {
		case "text": {
			const path = `${basePath}.text`;
			return [{ path, text: `${path}${labelSuffix(part.label)}: ${part.text}` }];
		}
		case "json":
			return flattenJson(part.value, `${basePath}.json`);
		case "raw": {
			const path = `${basePath}.raw`;
			return [{ path, text: `${path}${labelSuffix(part.label)}: ${part.text}` }];
		}
		default: {
			const _exhaustive: never = part;
			throw new Error(`Unexpected structured part: ${String(_exhaustive)}`);
		}
	}
}

function isMixedPartArray(input: StructuredChunkInput): input is StructuredMixedPart[] {
	if (!Array.isArray(input)) return false;
	return input.every((part) => StructuredMixedPartSchema.safeParse(part).success);
}

function parseJsonString(text: string): ParsedJsonString {
	try {
		const parsed: unknown = JSON.parse(text);
		const result = StructuredJsonValueSchema.safeParse(parsed);
		if (!result.success) return { ok: false };
		return { ok: true, value: result.data };
	} catch {
		return { ok: false };
	}
}

function flattenStructuredInput(input: StructuredChunkInput): StructuredSegment[] {
	if (isMixedPartArray(input)) {
		const segments = input.flatMap((part, index) => flattenMixedPart(part, index));
		return segments.length === 0 ? [{ path: "$parts", text: "$parts: []" }] : segments;
	}

	if (typeof input === "string") {
		const parsed = parseJsonString(input);
		if (parsed.ok && parsed.value !== undefined) return flattenJson(parsed.value, "$");
		return [{ path: "$", text: `$: ${input}` }];
	}

	return flattenJson(input, "$");
}

function withOffsets(segments: StructuredSegment[]): OffsetStructuredSegment[] {
	let offset = 0;
	return segments.map((segment) => {
		const startOffset = offset;
		const endOffset = startOffset + segment.text.length;
		offset = endOffset + 1;
		return { ...segment, startOffset, endOffset };
	});
}

function buildStructuredChunk(
	segments: readonly OffsetStructuredSegment[],
	chunkIndex: number,
	cfg: ChunkConfig,
	memoryId: string,
	oversized: boolean,
): ChunkMetadataDraft {
	const first = segments[0];
	const last = segments[segments.length - 1];
	if (first === undefined || last === undefined) {
		throw new Error("structured chunk requires at least one segment");
	}

	const chunkText = segments.map((segment) => segment.text).join("\n");
	const draft: ChunkMetadataDraft = {
		chunkId: "",
		memoryId,
		chunkIndex,
		chunkText,
		densePayload: "",
		structuredPaths: segments.map((segment) => segment.path),
		startOffset: first.startOffset,
		endOffset: last.endOffset,
		tokenCount: countTokens(chunkText, cfg.tokenizerMode),
		contentType: "structured",
		chunkingVersion: CHUNKING_VERSION,
	};

	if (oversized) draft.flags = ["oversized"];
	return draft;
}

function emitChunk(
	out: ChunkMetadataDraft[],
	segments: readonly OffsetStructuredSegment[],
	cfg: ChunkConfig,
	memoryId: string,
	oversized: boolean,
): void {
	if (segments.length === 0) return;
	out.push(buildStructuredChunk(segments, out.length, cfg, memoryId, oversized));
}

function chunkSegments(
	segments: readonly OffsetStructuredSegment[],
	cfg: ChunkConfig,
	memoryId: string,
): ChunkMetadataDraft[] {
	const out: ChunkMetadataDraft[] = [];
	let group: OffsetStructuredSegment[] = [];

	for (const segment of segments) {
		const segmentTokens = countTokens(segment.text, cfg.tokenizerMode);
		if (segmentTokens > cfg.maxTokens) {
			emitChunk(out, group, cfg, memoryId, false);
			group = [];
			emitChunk(out, [segment], cfg, memoryId, true);
			continue;
		}

		if (group.length === 0) {
			group = [segment];
			if (segmentTokens >= cfg.targetTokens) {
				emitChunk(out, group, cfg, memoryId, false);
				group = [];
			}
			continue;
		}

		const candidate = [...group, segment];
		const candidateText = candidate.map((item) => item.text).join("\n");
		const candidateTokens = countTokens(candidateText, cfg.tokenizerMode);
		if (candidateTokens > cfg.maxTokens) {
			emitChunk(out, group, cfg, memoryId, false);
			group = [segment];
			if (segmentTokens >= cfg.targetTokens) {
				emitChunk(out, group, cfg, memoryId, false);
				group = [];
			}
			continue;
		}

		group = candidate;
		if (candidateTokens >= cfg.targetTokens) {
			emitChunk(out, group, cfg, memoryId, false);
			group = [];
		}
	}

	emitChunk(out, group, cfg, memoryId, false);
	return out;
}

export function chunkStructured(
	input: StructuredChunkInput,
	config?: Partial<ChunkConfig>,
	parentMemoryId?: string,
): ChunkMetadataDraft[] {
	const parsed = StructuredChunkInputSchema.parse(input) as StructuredChunkInput;
	const cfg = ChunkConfigSchema.parse({ ...(config ?? {}), contentType: "structured" });
	const segments = withOffsets(flattenStructuredInput(parsed));
	return chunkSegments(segments, cfg, parentMemoryId ?? "");
}
