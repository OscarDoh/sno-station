import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("classifies actual workspace memory files and refuses missing or escaped paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "zebra-provenance-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", join(root, "host"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "memory/dreaming"), { recursive: true });
    for (const path of ["MEMORY.md", "USER.md", "memory/note.md", "memory/dreaming/note.md"]) await writeFile(join(workspace, path), "A local memory note.");
    await writeFile(join(root, "outside.md"), "Outside the workspace.");
    await symlink(join(root, "outside.md"), join(workspace, "memory/escape.md"));
    const { classifyWorkspaceMemoryPaths } = await import("../../../../apps/mem-claw/src/tools/workspace-provenance");
    const paths = ["MEMORY.md", "USER.md", "memory/note.md", "memory/dreaming/note.md", "memory/missing.md", "../outside.md", "memory/escape.md"];
    expect(await classifyWorkspaceMemoryPaths({ cfg: {}, agentId: "main", workspaceDir: workspace, relativePaths: paths })).toEqual(paths.map((relativePath, index) => ({ relativePath, originClass: index < 3 ? "agent" : index === 3 ? "system" : "untrusted" })));
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
