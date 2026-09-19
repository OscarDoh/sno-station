/**
 * Version gate for the conversation-access host-config grant.
 *
 * OpenClaw 2026.6.9+ blocks typed conversation hooks for non-bundled plugins
 * unless the host config grants `hooks.allowConversationAccess`. The pure gate
 * here decides — from the host version string alone — whether the plugin should
 * write that grant. Below 2026.6.9 (or an unparsable version) it must abstain
 * so we never mutate the config of a host that has no gate or would reject the
 * key. See conversation-access-policy.ts.
 */

import { describe, expect, it } from "vitest";
import {
	hostEnforcesConversationGate,
	parseVersionTriple,
} from "../../../../apps/mem-claw/src/install/conversation-access-policy";

describe("parseVersionTriple", () => {
	it("parses a clean x.y.z", () => {
		expect(parseVersionTriple("2026.6.9")).toEqual([2026, 6, 9]);
	});

	it("ignores a pre-release suffix", () => {
		expect(parseVersionTriple("2026.6.9-beta.1")).toEqual([2026, 6, 9]);
	});

	it("ignores a trailing build hash or any non-version remainder", () => {
		expect(parseVersionTriple("2026.6.9 (f066dd2)")).toEqual([2026, 6, 9]);
	});

	it("returns undefined for a two-segment version", () => {
		expect(parseVersionTriple("2026.6")).toBeUndefined();
	});

	it("returns undefined when not starting with a digit", () => {
		expect(parseVersionTriple("v2026.6.9")).toBeUndefined();
	});

	it("returns undefined for non-strings", () => {
		expect(parseVersionTriple(undefined)).toBeUndefined();
		expect(parseVersionTriple(null)).toBeUndefined();
		expect(parseVersionTriple(20264.24)).toBeUndefined();
	});
});

describe("hostEnforcesConversationGate", () => {
	it("is true at the minimum gated version", () => {
		expect(hostEnforcesConversationGate("2026.6.9")).toBe(true);
	});

	it("is true for a pre-release of the minimum version", () => {
		// The field is part of the pinned OpenClaw release line; the
		// negligible usage base makes treating it as gated the safe choice.
		expect(hostEnforcesConversationGate("2026.6.9-beta.1")).toBe(true);
	});

	it("is true for higher patch / minor / major", () => {
		expect(hostEnforcesConversationGate("2026.6.10")).toBe(true);
		expect(hostEnforcesConversationGate("2026.7.0")).toBe(true);
		expect(hostEnforcesConversationGate("2027.0.0")).toBe(true);
	});

	it("is false just below the provider-v1 host floor", () => {
		expect(hostEnforcesConversationGate("2026.6.8")).toBe(false);
	});

	it("is false for older minor / major", () => {
		expect(hostEnforcesConversationGate("2026.6.0")).toBe(false);
		expect(hostEnforcesConversationGate("2025.9.9")).toBe(false);
	});

	it("is false for an unparsable or missing version", () => {
		expect(hostEnforcesConversationGate(undefined)).toBe(false);
		expect(hostEnforcesConversationGate("unknown")).toBe(false);
		expect(hostEnforcesConversationGate("")).toBe(false);
	});
});
