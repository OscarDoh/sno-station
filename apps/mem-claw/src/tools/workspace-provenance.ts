import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { MemoryPluginCapability } from "openclaw/plugin-sdk/core";
import { readMemoryArtifactProvenance } from "openclaw/plugin-sdk/memory-core-host-runtime-core";

type Classifier = NonNullable<NonNullable<MemoryPluginCapability["runtime"]>["classifyWorkspaceMemoryPaths"]>;
type OriginClass = Awaited<ReturnType<Classifier>>[number]["originClass"];

export const classifyWorkspaceMemoryPaths: Classifier = async ({ workspaceDir, relativePaths }) => {
  return Promise.all(relativePaths.map(async relativePath => {
    let originClass: OriginClass = "untrusted";
    try {
      const [workspace, file] = await Promise.all([realpath(workspaceDir), realpath(resolve(workspaceDir, relativePath))]);
      const local = relative(workspace, file);
      if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) return { relativePath, originClass };
      const name = local.split(sep).join("/");
      if (["DREAMS.md", "dreams.md"].includes(name) || name.startsWith("memory/dreaming/") || name.startsWith("memory/.dreams/")) originClass = "system";
      else if (["MEMORY.md", "memory.md", "USER.md"].includes(name) || name.startsWith("memory/") && name.endsWith(".md")) {
        originClass = (await readMemoryArtifactProvenance({ workspaceDir, relativePath: name }))?.originClass ?? "agent";
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || !["ENOENT", "ENOTDIR"].includes(String(error.code))) throw error;
    }
    return { relativePath, originClass };
  }));
};
