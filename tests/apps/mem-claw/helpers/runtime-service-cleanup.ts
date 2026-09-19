import { afterAll, afterEach } from "vitest";
import { stopAllOpenClawHarnessServices } from "./openclaw-harness.ts";
import { releaseAllOwnedTemporaryRoots } from "./temporary-key-sentinel.ts";

// Per test: the plugin holds one module-level active runtime, keyed by a config
// fingerprint. A case that builds a fresh harness in beforeEach gets a new dbPath
// and therefore a new fingerprint, so leaving the previous runtime active makes
// registration refuse with a configuration conflict and no tools reach the harness.
afterEach(async () => {
	await stopAllOpenClawHarnessServices();
});

// Per file, not per test: a suite-scoped fixture created in beforeAll legitimately
// outlives every test, so sweeping per test deleted its temporary root mid-suite and
// made its own afterAll cleanup throw on an already-released root.
afterAll(async () => {
	try {
		await stopAllOpenClawHarnessServices();
	} finally {
		releaseAllOwnedTemporaryRoots();
	}
});
