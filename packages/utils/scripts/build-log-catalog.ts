import { createHash } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import type { LogSiteCatalog } from "../src/log-site-catalog.ts";

const SOURCE_FIELDS = ["event_name", "file", "function", "site_id"] as const;
const GENERATED_PATH = "apps/mem-claw/src/install/log-site-catalog.generated.ts";
const ADMITTED_CONSUMERS = [
	"tests/apps/mem-claw/eval-server/memora-eval-server.ts",
	"tests/apps/mem-claw/eval-server/current-only-recall.ts",
];

interface SourceInput {
	path: string;
	text: string;
}

interface SyntaxNode {
	type: string;
	start: number;
	end: number;
	loc?: { start: { line: number; column: number } } | null;
	[key: string]: unknown;
}

function isNode(value: unknown): value is SyntaxNode {
	return typeof value === "object" && value !== null && "type" in value &&
		typeof value.type === "string" && "start" in value && typeof value.start === "number" &&
		"end" in value && typeof value.end === "number";
}

function literalFields(node: SyntaxNode): Record<string, string> {
	const fields: Record<string, string> = {};
	if (!Array.isArray(node.properties)) return fields;
	for (const property of node.properties) {
		if (!isNode(property) || property.type !== "ObjectProperty" || property.computed) continue;
		const key = property.key;
		const value = property.value;
		if (!isNode(key) || !isNode(value) || value.type !== "StringLiteral" || typeof value.value !== "string") continue;
		const name = key.type === "Identifier" ? key.name : key.value;
		if (typeof name === "string") fields[name] = value.value;
	}
	return fields;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function syntax(source: SourceInput): SyntaxNode {
	const program = parse(source.text, { sourceType: "unambiguous", plugins: ["typescript"] });
	if (!isNode(program)) throw new Error(`Invalid syntax tree: ${source.path}`);
	return program;
}

function collectSource(source: SourceInput, sites: LogSiteCatalog["sites"]): void {
	function visit(node: SyntaxNode, call?: SyntaxNode): void {
		const ownerCall = node.type === "CallExpression" ? node : call;
		if (node.type === "ObjectExpression") {
			const fields = literalFields(node);
			if (fields.site_id && fields.event_name) {
				for (const field of SOURCE_FIELDS) {
					if (!fields[field]) throw new Error(`Nonliteral ${field} at ${source.path}:${node.start}`);
				}
				if (fields.file !== source.path) throw new Error(`Wrong source file for ${fields.site_id}`);
				if (sites[fields.site_id]) throw new Error(`Duplicate diagnostic site: ${fields.site_id}`);
				const location = (ownerCall ?? node).loc?.start;
				if (!location) throw new Error(`Missing source position: ${fields.site_id}`);
				sites[fields.site_id] = {
					file: source.path, function: fields.function, line: location.line,
					column: location.column + 1, file_hash: hash(source.text),
				};
			}
		}
		for (const value of Object.values(node)) {
			if (isNode(value)) visit(value, ownerCall);
			else if (Array.isArray(value)) for (const child of value) if (isNode(child)) visit(child, ownerCall);
		}
	}
	visit(syntax(source));
}

export function buildLogCatalog(sources: readonly SourceInput[]): LogSiteCatalog {
	const ordered = [...sources].sort((left, right) => left.path.localeCompare(right.path));
	const sites: LogSiteCatalog["sites"] = {};
	for (const source of ordered) collectSource(source, sites);
	return {
		build_id: hash(JSON.stringify(ordered.map(source => [source.path, hash(source.text)]))),
		sites,
	};
}

export function collectLogSources(root: string): SourceInput[] {
	const workspace = existsSync(resolve(root, "packages/utils/src"));
	const roots = (workspace ? ["apps", "packages"] : ["src", "scripts"]).filter(path => existsSync(resolve(root, path)));
	if (!roots.length) throw new Error("No utility source available for diagnostic catalog");
	const paths = globSync(roots.map(path => `${path}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`), {
		cwd: root,
		exclude: ["**/*.d.ts", "**/node_modules/**", "**/dist*/**", "**/.cache/**"],
	}).filter(path => path !== GENERATED_PATH);
	const consumers = ADMITTED_CONSUMERS.filter(path => existsSync(resolve(root, path)));
	return [...paths, ...consumers].map(path => ({
		path: workspace ? path : "packages/utils/" + path,
		text: readFileSync(resolve(root, path), "utf8"),
	}));
}

export function generateUtilsLogCatalog(): LogSiteCatalog {
	const packageRoot = resolve(import.meta.dirname, "..");
	const workspaceRoot = resolve(packageRoot, "../..");
	const root = resolve(workspaceRoot, "packages/utils") === packageRoot ? workspaceRoot : packageRoot;
	const catalog = buildLogCatalog(collectLogSources(root));
	if (!Object.keys(catalog.sites).length) throw new Error("No diagnostic sites available for utility catalog");
	mkdirSync(resolve(packageRoot, "dist"), { recursive: true });
	writeFileSync(resolve(packageRoot, "dist/log-site-catalog.json"), JSON.stringify(catalog) + "\n");
	return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const catalog = generateUtilsLogCatalog();
	process.stdout.write("Generated " + Object.keys(catalog.sites).length + " package diagnostic source sites\n");
}
