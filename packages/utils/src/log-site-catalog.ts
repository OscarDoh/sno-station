export interface LogSite {
	file: string;
	function: string;
	line: number;
	column: number;
	file_hash: string;
}

export interface LogSiteCatalog {
	build_id: string;
	sites: Record<string, LogSite>;
}

export interface LogSource {
	event_name: string;
	file: string;
	function: string;
	site_id: string;
}

export function validateLogCatalog(catalog: LogSiteCatalog, buildId: string): void {
	if (!buildId || buildId.length > 160 || catalog.build_id !== buildId) throw new Error("Log catalog build mismatch");
	for (const [id, site] of Object.entries(catalog.sites)) {
		if (!id || id.length > 200 || site.file.length > 1024 || !/^(apps|packages|tests)\/[\w./-]+$/.test(site.file)
			|| site.file.split("/").includes("..") || !site.function || site.function.length > 256
			|| !Number.isSafeInteger(site.line) || site.line < 1
			|| !Number.isSafeInteger(site.column) || site.column < 1
			|| !/^[a-f0-9]{64}$/.test(site.file_hash)) {
			throw new Error("Invalid log catalog site");
		}
	}
}

export function resolveLogSite(
	source: LogSource,
	buildId: string,
	catalog?: LogSiteCatalog,
): Record<string, unknown> {
	const site = catalog?.sites[source.site_id];
	const matches = catalog?.build_id === buildId && site?.file === source.file
		&& site?.function === source.function;
	return {
		file: source.file, function: source.function, site_id: source.site_id, build_id: buildId,
		catalog_status: matches ? "available" : "unavailable",
		...(!matches ? { catalog_reason: site ? "site_mismatch" : "site_not_in_catalog" } : {}),
	};
}
