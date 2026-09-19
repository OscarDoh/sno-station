import { describe, expect, it } from "vitest";
import {
	isChatIdBasedAgentId,
	resolveHookAgentId,
} from "../../../../apps/mem-claw/src/install/openclaw-plugin-runtime.ts";

describe("resolveHookAgentId", () => {
	it("prefers explicit non-system agent ids", () => {
		expect(resolveHookAgentId(" agent-a ", "agent:agent-b:session-1")).toEqual({
			agentId: "agent-a",
			source: "explicit",
		});
	});

	it("uses parseable session keys when explicit agent id is missing", () => {
		expect(
			resolveHookAgentId(undefined, "agent:parsed-agent:session-1"),
		).toEqual({
			agentId: "parsed-agent",
			source: "sessionKey",
		});
	});

	it("fails closed for missing, unparseable, and system-bypass hook identities", () => {
		expect(resolveHookAgentId(undefined, undefined)).toEqual({
			source: "missing",
		});
		expect(resolveHookAgentId(undefined, "opaque-session-key")).toEqual({
			source: "missing",
		});
		expect(resolveHookAgentId(undefined, "agent:system:session-1")).toEqual({
			source: "missing",
		});
		expect(resolveHookAgentId(" system ", "agent:agent-a:session-1")).toEqual({
			source: "missing",
		});
	});
});

// Issue #492 Layer 2 (PR #516 / upstream f194d79): numeric chat_id guard.
describe("isChatIdBasedAgentId", () => {
	it("flags pure-digit ids (Discord snowflake, Telegram user_id) as chat-id based", () => {
		expect(isChatIdBasedAgentId("657229412030480397")).toBe(true);
		expect(isChatIdBasedAgentId("5108601505")).toBe(true);
		expect(isChatIdBasedAgentId(" 5108601505 ")).toBe(true);
		expect(isChatIdBasedAgentId("0")).toBe(true);
	});

	it("leaves real agent ids untouched (alphanumeric / prefixed numerics)", () => {
		expect(isChatIdBasedAgentId("main")).toBe(false);
		expect(isChatIdBasedAgentId("agent-1234")).toBe(false);
		expect(isChatIdBasedAgentId("dc-channel--1476858065914695741")).toBe(false);
		expect(isChatIdBasedAgentId("tg-group--5108601505")).toBe(false);
		expect(isChatIdBasedAgentId("user42")).toBe(false);
	});

	it("returns false for empty/whitespace/undefined (handled by resolveHookAgentId)", () => {
		expect(isChatIdBasedAgentId(undefined)).toBe(false);
		expect(isChatIdBasedAgentId("")).toBe(false);
		expect(isChatIdBasedAgentId("   ")).toBe(false);
	});
});
