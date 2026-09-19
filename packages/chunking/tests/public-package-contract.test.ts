import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifestPath = resolve(import.meta.dirname, "../package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
	main?: string;
	types?: string;
	exports?: Record<string, unknown> | string;
	files?: string[];
	license?: string;
	publishConfig?: { access?: string };
	scripts?: Record<string, string>;
};

describe("public package contract", () => {
	it("exports compiled dist runtime and declarations", () => {
		expect(manifest.main).toBe("./dist/index.js");
		expect(manifest.types).toBe("./dist/index.d.ts");
		expect(manifest.exports).toEqual({
			".": {
				import: "./dist/index.js",
				types: "./dist/index.d.ts",
			},
		});
	});

	it("declares intentional public package metadata", () => {
		expect(manifest.license).toBe("Apache-2.0");
		expect(manifest.publishConfig?.access).toBe("public");
		expect(manifest.files).toEqual(["dist", "README.md", "LICENSE", "package.json"]);
		expect(manifest.scripts?.build).toContain("tsc");
		expect(manifest.scripts?.prepack).toBe("npm run build");
	});
});
