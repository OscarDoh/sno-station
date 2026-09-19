import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importRepository, splitMarkdown } from "../../../apps/mem-claude/src/import.js";
import { spoolDirectory } from "../../../apps/mem-claude/src/paths.js";

const roots: string[] = [];
const previousProfile = process.env.SNO_PROFILE_DIR;
const previousConfig = process.env.CLAUDE_CONFIG_DIR;

async function root(label: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), `${label}-`));
	roots.push(path);
	return path;
}

afterEach(async () => {
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = previousConfig;
	for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("Claude auto-memory import", () => {
	it("splits only at level-one and level-two headings, retaining unheaded notes", () => {
		expect(splitMarkdown("preamble\n# One\na\n## Two\nb\n### Three\nc\n")).toEqual([
			{ heading: "(preamble)", body: "preamble" },
			{ heading: "One", body: "a" },
			{ heading: "Two", body: "b\n### Three\nc" },
		]);
		expect(splitMarkdown("A note without any heading.\n")).toEqual([
			{ heading: "(preamble)", body: "A note without any heading." },
		]);
	});

	it("feeds only changed memory files, preserving repository scope and excluding instructions/transcripts", async () => {
		process.env.SNO_PROFILE_DIR = await root("mem-claude-import-profile");
		const repository = await root("mem-claude-import-repo");
		const config = await root("mem-claude-import-config");
		process.env.CLAUDE_CONFIG_DIR = config;
		const projectDir = join(config, "projects", repository.replace(/[^a-zA-Z0-9]/g, "-"));
		const memoryDir = join(projectDir, "memory");
		await mkdir(memoryDir, { recursive: true });
		await writeFile(join(memoryDir, "MEMORY.md"), "# Index\nThe repository harbor is cobalt.\n");
		await writeFile(join(memoryDir, "topic-a.md"), "# Topic A\nThe repository telescope is amber.\n");
		await writeFile(join(memoryDir, "topic-b.md"), "The repository compass is silver.\n");
		await writeFile(join(repository, "CLAUDE.md"), "Never import the instruction marker.\n");
		await writeFile(join(projectDir, "transcript.jsonl"), '{"text":"Never import the transcript marker."}\n');
		const first = await importRepository(repository, () => {});
		expect(first.blocksFed).toBe(3);
		expect((await importRepository(repository, () => {})).blocksFed).toBe(0);
		const receiptBefore = JSON.parse(await readFile(first.receiptPath, "utf8"));
		const changed = "# Topic A\nThe repository telescope is now teal.\n";
		await writeFile(join(memoryDir, "topic-a.md"), changed);
		expect((await importRepository(repository, () => {})).blocksFed).toBe(1);
		const spool = await Promise.all((await readdir(spoolDirectory())).map(async name =>
			JSON.parse(await readFile(join(spoolDirectory(), name), "utf8"))));
		expect(spool).toHaveLength(4);
		expect(spool.every(record => record.project === repository && record.kind === "import")).toBe(true);
		expect(spool.every(record => record.user.startsWith("Imported Claude Code memory note from "))).toBe(true);
		expect(spool.some(record => /instruction marker|transcript marker/.test(record.user))).toBe(false);
		const receiptAfter = JSON.parse(await readFile(first.receiptPath, "utf8"));
		expect(receiptAfter.files[join(memoryDir, "MEMORY.md")]).toEqual(receiptBefore.files[join(memoryDir, "MEMORY.md")]);
		expect(receiptAfter.files[join(memoryDir, "topic-b.md")]).toEqual(receiptBefore.files[join(memoryDir, "topic-b.md")]);
		expect(receiptAfter.files[join(memoryDir, "topic-a.md")].hash)
			.toBe(createHash("sha256").update(changed).digest("hex"));
		expect(Object.keys(receiptAfter.files)).toHaveLength(3);
	});

	it("records zero files without creating a spool when the memory directory is absent", async () => {
		process.env.SNO_PROFILE_DIR = await root("mem-claude-absent-profile");
		process.env.CLAUDE_CONFIG_DIR = await root("mem-claude-absent-config");
		const repository = await root("mem-claude-absent-repo");
		const result = await importRepository(repository, () => {});
		expect(result.blocksFed).toBe(0);
		expect(JSON.parse(await readFile(result.receiptPath, "utf8"))).toEqual({
			root: repository, project: repository, files: {},
		});
		await expect(readdir(spoolDirectory())).rejects.toMatchObject({ code: "ENOENT" });
	});
});
