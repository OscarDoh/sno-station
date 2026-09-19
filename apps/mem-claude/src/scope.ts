import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ScopeCtx } from "@snoai/sno-station-mem/client";
import { CODING_SKIN_MANUAL_SESSION_ID } from "@snoai/sno-station-mem/coding-skin";

const execFileAsync = promisify(execFile);

export async function repositoryRoot(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 2_000,
		});
		const root = stdout.trim();
		return root.length > 0 ? root : undefined;
	} catch {
		return undefined;
	}
}

export function hookScope(project: string, sessionId: string): ScopeCtx {
	return {
		principal: "client-replaced-by-sidecar-library",
		project,
		session: sessionId,
		host: { sessionId },
	};
}

export function manualScope(project: string): ScopeCtx {
	return {
		principal: "client-replaced-by-sidecar-library",
		project,
		session: CODING_SKIN_MANUAL_SESSION_ID,
		readable: [project, "global"],
		host: { sessionId: CODING_SKIN_MANUAL_SESSION_ID },
	};
}
