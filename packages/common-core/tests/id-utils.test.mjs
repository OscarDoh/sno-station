import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
	canonicalizeUUIDv7Input,
	createCuid2,
	createUUIDv7,
	isCuid2,
	isLowercaseCanonicalUUIDv7,
} from "../dist/index.js";

test("createCuid2 generates a valid company CUID2", () => {
	const id = createCuid2();

	assert.equal(isCuid2(id), true);
	assert.equal(id.length, 24);
	assert.equal(isCuid2(id.toUpperCase()), false);
});

test("UUID-v7 validation is lowercase canonical and package-backed", () => {
	const id = createUUIDv7();

	assert.equal(isLowercaseCanonicalUUIDv7(id), true);
	assert.equal(id, id.toLowerCase());
	assert.equal(isLowercaseCanonicalUUIDv7(id.toUpperCase()), false);
	assert.equal(isLowercaseCanonicalUUIDv7(randomUUID()), false);
	assert.equal(isLowercaseCanonicalUUIDv7("not-a-uuid"), false);
});

test("canonicalizeUUIDv7Input accepts host input case and emits lowercase", () => {
	const id = createUUIDv7();

	assert.equal(canonicalizeUUIDv7Input(id.toUpperCase()), id);
	assert.equal(canonicalizeUUIDv7Input(`  ${id.toUpperCase()}  `), id);
	assert.equal(canonicalizeUUIDv7Input(randomUUID()), undefined);
});
