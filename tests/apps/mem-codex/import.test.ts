import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importRepository, importUser, splitMarkdown } from "../../../apps/mem-codex/src/import.js";
import { importDirectory, spoolDirectory } from "../../../apps/mem-codex/src/paths.js";

const roots: string[] = [];
const previousProfile = process.env.SNO_PROFILE_DIR;
const previousCodexHome = process.env.CODEX_HOME;

async function root(label: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), `${label}-`));
	roots.push(path);
	return path;
}

afterEach(async () => {
	if (previousProfile === undefined) delete process.env.SNO_PROFILE_DIR;
	else process.env.SNO_PROFILE_DIR = previousProfile;
	if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
	else process.env.CODEX_HOME = previousCodexHome;
	for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("Codex memory import", () => {
	it("splits only at level-one and level-two headings", () => {
		expect(splitMarkdown("preamble\n# One\na\n## Two\nb\n### Three\nc\n")).toEqual([
			{ heading: "(preamble)", body: "preamble" },
			{ heading: "One", body: "a" },
			{ heading: "Two", body: "b\n### Three\nc" },
		]);
	});

	it("feeds only changed repository files and excludes rollout summaries", async () => {
		const profile = await root("mem-codex-import-profile");
		const repository = await root("mem-codex-import-repo");
		process.env.SNO_PROFILE_DIR = profile;
		await mkdir(join(repository, ".git"));
		await mkdir(join(repository, ".codex/memories/rollout_summaries"), { recursive: true });
		await writeFile(join(repository, ".codex/memories/MEMORY.md"), "# Main\nalpha\n## More\nbeta\n");
		await writeFile(join(repository, ".codex/memories/topic.md"), "# Topic\ngamma\n");
		await writeFile(join(repository, ".codex/memories/rollout_summaries/hidden.md"), "# Hidden\nnever import\n");

		expect((await importRepository(repository, () => undefined)).blocksFed).toBe(3);
		expect((await importRepository(repository, () => undefined)).blocksFed).toBe(0);
		await writeFile(join(repository, ".codex/memories/topic.md"), "# Topic\nchanged gamma\n");
		expect((await importRepository(repository, () => undefined)).blocksFed).toBe(1);
		const spool = await Promise.all((await readdir(spoolDirectory())).map(async name => JSON.parse(await readFile(join(spoolDirectory(), name), "utf8"))));
		expect(spool).toHaveLength(4);
		expect(spool.every(record => record.project === repository && record.kind === "import")).toBe(true);
		expect(spool.some(record => record.user.includes("never import"))).toBe(false);
		expect((await readdir(importDirectory())).length).toBe(1);
	});

	it("imports user notes into global scope and extension note paths", async () => {
		const profile = await root("mem-codex-user-profile");
		const codexHome = await root("mem-codex-user-home");
		process.env.SNO_PROFILE_DIR = profile;
		process.env.CODEX_HOME = codexHome;
		await mkdir(join(codexHome, "memories/extensions/example/notes"), { recursive: true });
		await writeFile(join(codexHome, "memories/memory_summary.md"), "# User\nuser fact\n");
		await writeFile(join(codexHome, "memories/extensions/example/notes/note.md"), "# Ext\nextension fact\n");
		const result = await importUser(codexHome, () => undefined);
		expect(result.blocksFed).toBe(2);
		const spool = await Promise.all((await readdir(spoolDirectory())).map(async name => JSON.parse(await readFile(join(spoolDirectory(), name), "utf8"))));
		expect(spool.every(record => record.project === "global" && record.childCwd === codexHome)).toBe(true);
	});
});
