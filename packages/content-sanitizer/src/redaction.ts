import {
	boundedRedactions,
	boundedWarnings,
	provenance,
	type RedactionEvent,
	type SanitizerContentType,
	type SanitizerSource,
	type TextSanitizerResult,
} from "./types.js";

const SECRET_MARKER = "[REDACTED_SECRET]";
const PRIVATE_MARKER = "[REDACTED_PRIVATE]";
const SECRET_FIELD_PATTERN =
	/(?:token|api[_-]?key|access[_-]?key|account[_-]?key|secret|client[_-]?secret|password|authorization|private[_-]?key)/i;

const SECRET_REPLACEMENTS: Array<{
	class: string;
	pattern: RegExp;
	replace: string | ((match: string, group?: string) => string);
}> = [
	{
		class: "authorization-bearer",
		pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
		replace: "Authorization: Bearer [REDACTED_SECRET]",
	},
	{
		class: "bearer-token",
		pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
		replace: "Bearer [REDACTED_SECRET]",
	},
	{
		class: "basic-auth",
		pattern: /Authorization\s*:\s*Basic\s+[A-Za-z0-9\-._~+/]+=*/gi,
		replace: "Authorization: Basic [REDACTED_SECRET]",
	},
	{
		class: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
		replace: SECRET_MARKER,
	},
		{ class: "openai-key", pattern: /(?<![A-Za-z0-9])sk-proj-[A-Za-z0-9\-_]{20,}\b/g, replace: SECRET_MARKER },
		{ class: "openai-key", pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}\b/g, replace: SECRET_MARKER },
		{ class: "anthropic-key", pattern: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9\-_]{20,}\b/g, replace: SECRET_MARKER },
	{
		class: "stripe-key",
			pattern: /(?<![A-Za-z0-9])(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
		replace: SECRET_MARKER,
	},
	{
		class: "github-token",
			pattern: /(?<![A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
		replace: SECRET_MARKER,
	},
	{
		class: "github-token",
			pattern: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}\b/g,
		replace: SECRET_MARKER,
	},
		{ class: "slack-token", pattern: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: SECRET_MARKER },
		{ class: "google-api-key", pattern: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{20,}\b/g, replace: SECRET_MARKER },
		{ class: "google-oauth-token", pattern: /(?<![A-Za-z0-9])ya29\.[A-Za-z0-9._-]{20,}\b/g, replace: SECRET_MARKER },
		{ class: "aws-access-key", pattern: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b/g, replace: SECRET_MARKER },
		{ class: "npm-token", pattern: /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36,}\b/g, replace: SECRET_MARKER },
	{
		class: "key-value-secret",
		pattern:
			/(?<![A-Za-z0-9_-])((["']?)(?:token|api[_-]?key|access[_-]?key|account[_-]?key|secret|client[_-]?secret|password)\2\s*[:=]\s*)(?:"[^"\r\n]*(?:"|(?=\r?\n|$))|'[^'\r\n]*(?:'|(?=\r?\n|$))|[^\s"',;)}\]]{6,})/gi,
		replace: (_match, group) => `${group ?? ""}${SECRET_MARKER}`,
	},
	{
		class: "query-secret",
		pattern: /([?&](?:access[_-]?token|api[_-]?key|token|secret|password)=)[^&#\s]+/gi,
		replace: (_match, group) => `${group ?? ""}${SECRET_MARKER}`,
	},
	{
		class: "private-key-block",
		pattern:
			/-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?(?:-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----|$)/g,
		replace: SECRET_MARKER,
	},
	{
		class: "url-credentials",
		pattern: /(?<=:\/\/)[^@\s/:]+:[^@\s]+(?=@)/g,
		replace: SECRET_MARKER,
	},
	{
		class: "url-credentials-bare",
		pattern:
			/(?<![A-Za-z0-9])[A-Za-z0-9._%+-]+:[^@\s/]+(?=@(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+|localhost)(?::\d+)?(?:[/\s]|$))/g,
		replace: SECRET_MARKER,
	},
];

function pushEvent(events: RedactionEvent[], kind: "secret" | "private", klass: string, count: number): void {
	if (count === 0) return;
	const existing = events.find((event) => event.kind === kind && event.class === klass);
	if (existing) {
		existing.count += count;
		return;
	}
	events.push({ kind, class: klass, count });
}

function applyPattern(
	text: string,
	pattern: RegExp,
	replacement: string | ((match: string, group?: string) => string),
): { text: string; count: number } {
	let count = 0;
	const out = text.replace(pattern, (match: string, group?: string) => {
		count += 1;
		return typeof replacement === "string" ? replacement : replacement(match, group);
	});
	return { text: out, count };
}

export function redactPrivateBlocksForStorage(
	text: string,
	options: { source?: SanitizerSource; contentType?: SanitizerContentType } = {},
): TextSanitizerResult {
	let out = text;
	const redactions: RedactionEvent[] = [];
	const privateBlocks = applyPattern(
		out,
		/<private\b[^>]*>[\s\S]*?(?:<\/private>|$)/gi,
		PRIVATE_MARKER,
	);
	out = privateBlocks.text;
	pushEvent(redactions, "private", "private-block", privateBlocks.count);
	return {
		text: out,
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings([]),
		provenance: provenance(
			options.source ?? "generic-text",
			options.contentType ?? "plain_text",
			redactions.length > 0 ? ["redacted-private-blocks"] : ["private-block-scan"],
		),
	};
}

export function redactForStorage(
	text: string,
	options: { source?: SanitizerSource; contentType?: SanitizerContentType } = {},
): TextSanitizerResult {
	let out = text;
	const redactions: RedactionEvent[] = [];
	const privateBlocks = redactPrivateBlocksForStorage(out, options);
	out = privateBlocks.text;
	redactions.push(...privateBlocks.redactions);

	for (const replacement of SECRET_REPLACEMENTS) {
		const applied = applyPattern(out, replacement.pattern, replacement.replace);
		out = applied.text;
		pushEvent(redactions, "secret", replacement.class, applied.count);
	}

	return {
		text: out,
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings([]),
		provenance: provenance(
			options.source ?? "generic-text",
			options.contentType ?? "plain_text",
			redactions.length > 0 ? ["redacted-storage-secrets"] : ["redaction-scan"],
		),
	};
}

export function redactStructuredSecretValue(path: string): {
	text: string;
	event: RedactionEvent;
} {
	return {
		text: SECRET_MARKER,
		event: {
			kind: "secret",
			class: "structured-secret-field",
			count: 1,
			path,
		},
	};
}

export function isSecretFieldName(name: string): boolean {
	return SECRET_FIELD_PATTERN.test(name);
}

export function isOnlyRedactionMarkers(text: string): boolean {
	return text
		.replaceAll(SECRET_MARKER, "")
		.replaceAll(PRIVATE_MARKER, "")
		.replace(/\s+/g, "")
		.trim().length === 0;
}
