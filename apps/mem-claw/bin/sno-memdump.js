#!/usr/bin/env node

import { main } from "../dist/memdump.js";
import { writeEmergencyDiagnostic } from "../dist/diagnostic-encoder.js";

main(process.argv.slice(2)).catch((error) => {
	writeEmergencyDiagnostic({ level: "error", body: "Memory dump failed", attributes: { error, exit_code: 1 }, source: { event_name: "memdump.command.failed", file: "apps/mem-claw/bin/sno-memdump.js", function: "<module>", site_id: "memdump.command.failed" } });
	process.exitCode = 1;
});
