import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function activateKillSwitch(stateDir: string, reason: string, activatedBy: string): void {
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(join(stateDir, "killswitch"), JSON.stringify({ activated: new Date().toISOString(), reason, activatedBy }));
}
export function deactivateKillSwitch(stateDir: string): void { rmSync(join(stateDir, "killswitch"), { force: true }); }
export function isKillSwitchActive(stateDir: string): boolean { return existsSync(join(stateDir, "killswitch")); }
export function readKillSwitchState(stateDir: string): { active: boolean; reason?: string; activatedBy?: string; corrupt?: boolean } {
	if (!isKillSwitchActive(stateDir)) return { active: false };
	try { const value = JSON.parse(readFileSync(join(stateDir, "killswitch"), "utf8")); return { active: true, reason: value.reason, activatedBy: value.activatedBy, corrupt: false }; }
	catch { return { active: true, reason: "kill switch metadata is unreadable", activatedBy: "unknown", corrupt: true }; }
}
