import {
	boundedRedactions,
	boundedWarnings,
	provenance,
	warning,
	type RedactionEvent,
	type SanitizerWarning,
	type StorageValidationResult,
} from "./types.js";
import { isOnlyRedactionMarkers, isSecretFieldName, redactStructuredSecretValue } from "./redaction.js";
import { sanitizePlainText } from "./projection.js";

const USEFUL_TEXT_FIELDS = ["abstract", "overview", "content"] as const;

function useful(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0 && !isOnlyRedactionMarkers(value.trim());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function withRedactionPath(event: RedactionEvent, path: string): RedactionEvent {
	if (event.path) return event;
	return { ...event, path };
}

function withWarningPath(event: SanitizerWarning, path: string): SanitizerWarning {
	if (event.path) return event;
	return { ...event, path };
}

function sanitizeStorageKey(
	key: string,
	path: string,
	redactions: RedactionEvent[],
	warnings: SanitizerWarning[],
): string {
	const sanitized = sanitizePlainText(key, {
		source: "generic-text",
		contentType: "plain_text",
		preserveLines: false,
	});
	redactions.push(...sanitized.redactions.map((event) => withRedactionPath(event, path)));
	warnings.push(...sanitized.warnings.map((event) => withWarningPath(event, path)));
	return sanitized.text.length > 0 ? sanitized.text : "[REDACTED_KEY]";
}

function uniqueStorageKey(record: Record<string, unknown>, key: string): string {
	if (!Object.prototype.hasOwnProperty.call(record, key)) return key;
	let suffix = 2;
	while (Object.prototype.hasOwnProperty.call(record, `${key}_${suffix}`)) {
		suffix += 1;
	}
	return `${key}_${suffix}`;
}

function parseJsonContainer(text: string): unknown | undefined {
	const trimmed = text.trim();
	if (
		!(
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		)
	) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

function sanitizeStorageValue(
	value: unknown,
	path: string,
	redactions: RedactionEvent[],
	warnings: SanitizerWarning[],
	seen: WeakSet<object>,
): unknown {
	if (typeof value === "string") {
		const parsedJson = parseJsonContainer(value);
		if (parsedJson !== undefined) {
			const sanitizedJson = sanitizeStorageValue(parsedJson, path, redactions, warnings, seen);
			return JSON.stringify(sanitizedJson, null, 2);
		}
		const sanitized = sanitizePlainText(value, {
			source: "generic-text",
			contentType: "plain_text",
			preserveLines: true,
		});
		redactions.push(...sanitized.redactions.map((event) => withRedactionPath(event, path)));
		warnings.push(...sanitized.warnings.map((event) => withWarningPath(event, path)));
		return sanitized.text;
	}
	if (!value || typeof value !== "object") return value;
	if (seen.has(value)) {
		warnings.push(warning("unsupported_candidate_cycle", "Cyclic candidate field was removed", path));
		return undefined;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		const out = value.map((item, index) =>
			sanitizeStorageValue(item, `${path}[${index}]`, redactions, warnings, seen),
		);
		seen.delete(value);
		return out;
	}
	if (!isPlainRecord(value)) {
		warnings.push(warning("unsupported_candidate_object", "Unsupported candidate object was removed", path));
		seen.delete(value);
		return undefined;
	}
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		const safeKey = uniqueStorageKey(out, sanitizeStorageKey(key, path, redactions, warnings));
		const keyPath = `${path}.${safeKey}`;
		if (isSecretFieldName(key)) {
			const redacted = redactStructuredSecretValue(keyPath);
			out[safeKey] = redacted.text;
			redactions.push(redacted.event);
			continue;
		}
		out[safeKey] = sanitizeStorageValue(item, keyPath, redactions, warnings, seen);
	}
	seen.delete(value);
	return out;
}

export function validateExtractedContentForStorage<T extends Record<string, unknown>>(
	value: T,
): StorageValidationResult<T> {
	if (!isPlainRecord(value)) {
		return {
			ok: false,
			reason: "unsupported-candidate",
			redactions: [],
			warnings: [warning("unsupported_candidate", "Candidate must be a plain object")],
			provenance: provenance("generic-text", "structured_json", ["post-extraction-validation"]),
		};
	}
	const redactions: RedactionEvent[] = [];
	const warnings: SanitizerWarning[] = [];
	const sanitizedRoot = sanitizeStorageValue(value, "$", redactions, warnings, new WeakSet());
	if (!isPlainRecord(sanitizedRoot)) {
		return {
			ok: false,
			reason: "unsupported-candidate",
			redactions: boundedRedactions(redactions),
			warnings: boundedWarnings(warnings),
			provenance: provenance("generic-text", "structured_json", ["post-extraction-validation"]),
		};
	}
	const next = sanitizedRoot;
	const removedUsefulField = USEFUL_TEXT_FIELDS.some(
		(field) =>
			Object.prototype.hasOwnProperty.call(value, field) &&
			value[field] !== undefined &&
			next[field] === undefined,
	);
	if (removedUsefulField) {
		return {
			ok: false,
			reason: "unsupported-candidate",
			redactions: boundedRedactions(redactions),
			warnings: boundedWarnings(warnings),
			provenance: provenance("generic-text", "structured_json", ["post-extraction-validation"]),
		};
	}
	const hasUseful = USEFUL_TEXT_FIELDS.some((field) => useful(next[field]));
	if (!hasUseful) {
		return {
			ok: false,
			reason: "empty-after-sanitization",
			redactions: boundedRedactions(redactions),
			warnings: boundedWarnings([
				...warnings,
				warning("empty_after_sanitization", "Candidate has no useful content after sanitization"),
			]),
			provenance: provenance("generic-text", "structured_json", ["post-extraction-validation"]),
		};
	}
	return {
		ok: true,
		value: next as T,
		redactions: boundedRedactions(redactions),
		warnings: boundedWarnings(warnings),
		provenance: provenance("generic-text", "structured_json", ["post-extraction-validation"]),
	};
}
