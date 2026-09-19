import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunk } from "../src/chunker";
import type { ChunkConfig } from "../src/chunk-config";
import type { ChunkMetadataDraft } from "../src/chunk-metadata";

interface FrozenCase {
	name: string;
	memoryId: string;
	config: Pick<ChunkConfig, "contentType">;
	input: string;
	expectedChunks: ChunkMetadataDraft[];
}

interface FrozenSnapshot {
	source: {
		package: "@snoai/chunking";
		version: "0.99.1";
		command: string;
	};
	cases: FrozenCase[];
}

const snapshot = JSON.parse(
	readFileSync(
		join(import.meta.dirname, "fixtures", "frozen-0.99.1-prose-conversation.json"),
		"utf8",
	),
) as FrozenSnapshot;

describe("frozen @snoai/chunking@0.99.1 prose/conversation output", () => {
	it("was captured from the immutable published package", () => {
		expect(snapshot.source).toEqual({
			package: "@snoai/chunking",
			version: "0.99.1",
			command:
				'tmpdir="$(mktemp -d /tmp/chunking-0991-install-XXXXXX)" && cd "$tmpdir" && npm init -y && npm install @snoai/chunking@0.99.1 --ignore-scripts --no-audit --no-fund && node --input-type=module <snapshot generator>',
		});
	});

	it.each(snapshot.cases)("$name stays byte-identical", (fixture) => {
		const actual = chunk(fixture.input, fixture.config, fixture.memoryId);
		expect(JSON.stringify(actual)).toBe(JSON.stringify(fixture.expectedChunks));
	});
});
