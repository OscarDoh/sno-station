// This public runtime export ships without a declaration in the pinned host SDK.
declare module "openclaw/plugin-sdk/memory-core-host-runtime-core" {
  export function readMemoryArtifactProvenance(params: { workspaceDir: string; relativePath: string }): Promise<{
    fileHash: string;
    originClass: "agent" | "untrusted";
    observedAt: number;
    sessionId?: string;
    sessionKey?: string;
  } | undefined>;
}
