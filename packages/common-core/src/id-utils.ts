import { createId as createCuid2Value, isCuid } from "@paralleldrive/cuid2";
import {
	version as uuidVersion,
	v7 as uuidv7,
	validate as validateUuidFormat,
} from "uuid";

export const createCuid2 = createCuid2Value;

export function isCuid2(value: unknown): value is string {
	return typeof value === "string" && value.length === 24 && isCuid(value);
}

export function createUUIDv7(): string {
	return uuidv7().toLowerCase();
}

export function isLowercaseCanonicalUUIDv7(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value === value.toLowerCase() &&
		validateUuidFormat(value) &&
		uuidVersion(value) === 7
	);
}

export function canonicalizeUUIDv7Input(value: string): string | undefined {
	const normalized = value.trim().toLowerCase();
	return validateUuidFormat(normalized) && uuidVersion(normalized) === 7
		? normalized
		: undefined;
}
