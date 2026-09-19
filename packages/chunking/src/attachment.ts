import { createHash } from "node:crypto";
import { z } from "zod";
import { ContentRouteSchema } from "./content-route.js";
import { countTokens } from "./tokenize.js";

export const ATTACHMENT_SUMMARY_CAP_TOKENS = 2048 as const;
export const ATTACHMENT_SUMMARY_HEAD_TOKENS = 1536 as const;
export const ATTACHMENT_SUMMARY_TAIL_TOKENS = 512 as const;

export const AttachmentRouteInputSchema = z
	.object({
		route: ContentRouteSchema.optional(),
		attachmentId: z.string().min(1).optional(),
		content: z.string(),
		filename: z.string().min(1).optional(),
		mediaType: z.string().min(1).optional(),
		contentHash: z.string().min(1).optional(),
		routeReasons: z.array(z.string().min(1)).optional(),
		consumerSummary: z.string().min(1).optional(),
	})
	.strict()
	.refine((input) => input.route === undefined || input.route === "attachment", {
		message: "attachment route input must not declare embed route",
		path: ["route"],
	});

export type AttachmentRouteInput = z.infer<typeof AttachmentRouteInputSchema>;

export interface AttachmentRawPayload {
	content: string;
	filename?: string;
	mediaType?: string;
	contentHash?: string;
}

export interface AttachmentSummaryInput {
	text: string;
	tokenCount: number;
	capTokens: typeof ATTACHMENT_SUMMARY_CAP_TOKENS;
	wasTruncated: boolean;
	strategy: "head-tail";
}

export interface AttachmentHandleVector {
	kind: "summary" | "tags" | "filename" | "type";
	text: string;
	source: "consumer-llm" | "deterministic-auto-extract" | "metadata";
	tags?: string[];
}

export interface AttachmentHandle {
	attachmentId: string;
	vectors: AttachmentHandleVector[];
	summaryInput: AttachmentSummaryInput;
}

export interface AttachmentRouteResult {
	route: "attachment";
	attachmentId: string;
	raw: AttachmentRawPayload;
	handle: AttachmentHandle;
}

function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function deriveAttachmentId(input: AttachmentRouteInput): string {
	if (input.attachmentId !== undefined) return input.attachmentId;
	const hashInput = [
		input.contentHash ?? sha256Hex(input.content),
		input.filename ?? "",
		input.mediaType ?? "",
	].join("\n");
	return `att_${sha256Hex(hashInput).slice(0, 32)}`;
}

function extensionTag(filename: string | undefined): string | undefined {
	if (filename === undefined) return undefined;
	const lastPart = filename.split("/").at(-1) ?? filename;
	const dot = lastPart.lastIndexOf(".");
	if (dot <= 0 || dot >= lastPart.length - 1) return undefined;
	return `extension:${lastPart.slice(dot + 1).toLowerCase()}`;
}

function buildTags(input: AttachmentRouteInput): string[] {
	const tags = ["route:attachment"];
	if (input.filename !== undefined) tags.push(`filename:${input.filename}`);
	const ext = extensionTag(input.filename);
	if (ext !== undefined) tags.push(ext);
	if (input.mediaType !== undefined) tags.push(`mediaType:${input.mediaType}`);
	for (const reason of input.routeReasons ?? []) {
		tags.push(`reason:${reason}`);
	}
	return tags;
}

function slicePrefixByTokenCap(text: string, capTokens: number): string {
	if (countTokens(text) <= capTokens) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2);
		if (countTokens(text.slice(0, mid)) <= capTokens) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return text.slice(0, lo);
}

function sliceSuffixByTokenCap(text: string, capTokens: number): string {
	if (countTokens(text) <= capTokens) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const len = Math.floor((lo + hi + 1) / 2);
		if (countTokens(text.slice(text.length - len)) <= capTokens) {
			lo = len;
		} else {
			hi = len - 1;
		}
	}
	return text.slice(text.length - lo);
}

function buildSummaryInput(content: string): AttachmentSummaryInput {
	const tokenCount = countTokens(content);
	if (tokenCount <= ATTACHMENT_SUMMARY_CAP_TOKENS) {
		return {
			text: content,
			tokenCount,
			capTokens: ATTACHMENT_SUMMARY_CAP_TOKENS,
			wasTruncated: false,
			strategy: "head-tail",
		};
	}

	const head = slicePrefixByTokenCap(content, ATTACHMENT_SUMMARY_HEAD_TOKENS);
	const tail = sliceSuffixByTokenCap(content, ATTACHMENT_SUMMARY_TAIL_TOKENS);
	const text = `${head}${tail}`;
	return {
		text,
		tokenCount: countTokens(text),
		capTokens: ATTACHMENT_SUMMARY_CAP_TOKENS,
		wasTruncated: true,
		strategy: "head-tail",
	};
}

function firstMeaningfulLines(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, 3);
	const joined = lines.join(" / ");
	if (joined.length <= 320) return joined;
	return `${joined.slice(0, 320).trimEnd()}...`;
}

function fallbackSummary(input: AttachmentRouteInput, summaryInput: AttachmentSummaryInput): string {
	const prefix = input.filename ?? input.mediaType ?? "attachment";
	const excerpt = firstMeaningfulLines(summaryInput.text);
	if (excerpt.length === 0) return `Attachment handle for ${prefix}.`;
	return `Attachment handle for ${prefix}: ${excerpt}`;
}

function buildRawPayload(input: AttachmentRouteInput): AttachmentRawPayload {
	const raw: AttachmentRawPayload = { content: input.content };
	if (input.filename !== undefined) raw.filename = input.filename;
	if (input.mediaType !== undefined) raw.mediaType = input.mediaType;
	if (input.contentHash !== undefined) raw.contentHash = input.contentHash;
	return raw;
}

function metadataVectors(input: AttachmentRouteInput, tags: string[]): AttachmentHandleVector[] {
	const vectors: AttachmentHandleVector[] = [
		{
			kind: "tags",
			text: tags.join(" "),
			source: "metadata",
			tags,
		},
	];
	if (input.filename !== undefined) {
		vectors.push({
			kind: "filename",
			text: input.filename,
			source: "metadata",
			tags,
		});
	}
	if (input.mediaType !== undefined) {
		vectors.push({
			kind: "type",
			text: input.mediaType,
			source: "metadata",
			tags,
		});
	}
	return vectors;
}

export function buildAttachmentRoute(input: AttachmentRouteInput): AttachmentRouteResult {
	const parsed = AttachmentRouteInputSchema.parse(input);
	const attachmentId = deriveAttachmentId(parsed);
	const tags = buildTags(parsed);
	const summaryInput = buildSummaryInput(parsed.content);
	const summaryText =
		parsed.consumerSummary ?? fallbackSummary(parsed, summaryInput);
	const summarySource =
		parsed.consumerSummary === undefined ? "deterministic-auto-extract" : "consumer-llm";
	const vectors: AttachmentHandleVector[] = [
		{
			kind: "summary",
			text: summaryText,
			source: summarySource,
			tags,
		},
		...metadataVectors(parsed, tags),
	];

	return {
		route: "attachment",
		attachmentId,
		raw: buildRawPayload(parsed),
		handle: {
			attachmentId,
			vectors,
			summaryInput,
		},
	};
}
