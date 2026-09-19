import { activateKillSwitch } from "../helpers/obsolete-kill-switch-fixture";
/** @file memory-import-command.test.ts
 * @purpose Guards JSONL import atomicity when file I/O fails mid-stream.
 * @boundary Commander import command with mocked source read failure only.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import type { CliContext } from "../../../../packages/sno-station-mem/src/engine/bindings/memory-cli-shared.ts";
import { registerMemoryImportCommand } from "../../../../apps/mem-claw/src/commands/memory-import-command.ts";


const brokenImportPath = join(tmpdir(), "mem-claw-broken-import.jsonl");

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		createReadStream: vi.fn((file: string | URL, options?: unknown) => {
			if (String(file) !== brokenImportPath) {
				return actual.createReadStream(
					file,
					options as Parameters<typeof actual.createReadStream>[1],
				);
			}
			let sent = false;
			return new Readable({
				read() {
					if (sent) return;
					sent = true;
					this.push(
						`${JSON.stringify({
							id: "import-prefix",
							text: "This valid prefix must not be imported after a read error.",
							category: "episodic",
						})}\n`,
					);
					setImmediate(() => this.destroy(new Error("source read failed")));
				},
			});
		}),
	};
});

describe("memory import command", () => {
	function registerImportWithStore(store: Partial<CliContext["store"]>) {
		const memory = new Command("memory");
		memory.exitOverride();
		registerMemoryImportCommand(memory, {
			store: {
				hasId: vi.fn().mockResolvedValue(false),
				findByContentHash: vi.fn().mockReturnValue(undefined),
				importEntry: vi.fn(),
				...store,
			},
			retriever: {},
			embedder: {},
			stateDir: tmpdir(),
		} as unknown as CliContext);
		return memory;
	}

	it("does not import a valid prefix when source reading fails", async () => {
		writeFileSync(brokenImportPath, "");
		const importEntry = vi.fn();
		const memory = registerImportWithStore({ importEntry });

		await expect(
			memory.parseAsync(["node", "memory", "import", brokenImportPath]),
		).rejects.toMatchObject({
			code: "import_io_error",
		});
		expect(importEntry).not.toHaveBeenCalled();
	});



	it("fails old-category import payloads and points at the offline migrator", async () => {
		const importEntry = vi.fn();
		const memory = registerImportWithStore({ importEntry });
		const dir = mkdtempSync(join(tmpdir(), "mem-claw-import-old-category-"));
		const importPath = join(dir, "old.jsonl");
		writeFileSync(
			importPath,
			`${JSON.stringify({
				id: "old-preference",
				text: "The user prefers direct answers.",
				// Pre-cutover category — the import path must reject it, not remap it.
				category: "preference",
			})}\n`,
		);

		await expect(memory.parseAsync(["node", "memory", "import", importPath])).rejects.toMatchObject({
			code: "import_invalid_category",
			message: expect.stringContaining("offline cutover migrator"),
		});
		expect(importEntry).not.toHaveBeenCalled();
	});

	it("imports lesson rows through offline-family authority", async () => {
		const importEntry = vi.fn().mockResolvedValue(undefined);
		const memory = registerImportWithStore({ importEntry });
		const dir = mkdtempSync(join(tmpdir(), "mem-claw-import-lesson-"));
		const importPath = join(dir, "lesson.jsonl");
		writeFileSync(
			importPath,
			`${JSON.stringify({
				id: "lesson-row",
				text: "Verify the working directory before retrying missing-file operations.",
				category: "lesson",
				metadata: { anti_pattern_signature: "verify-working-directory" },
			})}\n`,
		);

		await memory.parseAsync(["node", "memory", "import", importPath]);

		expect(importEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "lesson-row",
				category: "lesson",
				offlineFamily: true,
			}),
		);
	});
});
