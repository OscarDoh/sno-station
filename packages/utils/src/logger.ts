type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

// ANSI colors — forced regardless of TTY (logs piped to file keep color codes for `cat`)
const C = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
	debug: C.blue,
	info: C.green,
	warn: C.yellow,
	error: C.red,
};

function formatPST(date: Date): string {
	const pst = new Date(date.getTime() - 8 * 60 * 60 * 1000);
	const y = pst.getUTCFullYear();
	const mo = String(pst.getUTCMonth() + 1).padStart(2, "0");
	const d = String(pst.getUTCDate()).padStart(2, "0");
	const h = String(pst.getUTCHours()).padStart(2, "0");
	const mi = String(pst.getUTCMinutes()).padStart(2, "0");
	const s = String(pst.getUTCSeconds()).padStart(2, "0");
	return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function safeStringify(data: unknown): string {
	const seen = new WeakSet();
	return JSON.stringify(data, (_key, val) => {
		if (typeof val === "bigint") return val.toString();
		if (typeof val === "object" && val !== null) {
			if (seen.has(val)) return "[Circular]";
			seen.add(val);
		}
		return val;
	});
}

const env = process.env as NodeJS.ProcessEnv & { LOG_LEVEL?: string };
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const VALID_LOG_LEVELS = new Set<LogLevel>(Object.keys(LEVEL_ORDER) as LogLevel[]);
const rawLogLevel = env.LOG_LEVEL;
const currentLevel: LogLevel =
	rawLogLevel !== undefined && VALID_LOG_LEVELS.has(rawLogLevel as LogLevel)
		? (rawLogLevel as LogLevel)
		: DEFAULT_LOG_LEVEL;
if (rawLogLevel !== undefined && !VALID_LOG_LEVELS.has(rawLogLevel as LogLevel)) {
	process.stderr.write(
		`${C.yellow}[logger]${C.reset} ${C.dim}${formatPST(new Date())}${C.reset} - ${C.yellow}WARN ${C.reset} - Invalid LOG_LEVEL "${rawLogLevel}". Falling back to "${DEFAULT_LOG_LEVEL}".\n`,
	);
}

export function createLogger(scope: string) {
	const shouldLog = (level: LogLevel) => LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];

	const fmt = (level: LogLevel, msg: string, data?: unknown): string => {
		const ts = formatPST(new Date());
		const lvl = level.toUpperCase().padEnd(5);
		const lc = LEVEL_COLOR[level];
		const dataStr = data !== undefined ? ` ${safeStringify(data)}` : "";
		return `${C.cyan}[${scope}]${C.reset} ${C.dim}${ts}${C.reset} - ${lc}${lvl}${C.reset} - ${msg}${dataStr}`;
	};

	return {
		debug: (msg: string, data?: unknown) =>
			shouldLog("debug") && process.stderr.write(`${fmt("debug", msg, data)}\n`),
		info: (msg: string, data?: unknown) =>
			shouldLog("info") && process.stderr.write(`${fmt("info", msg, data)}\n`),
		warn: (msg: string, data?: unknown) =>
			shouldLog("warn") && process.stderr.write(`${fmt("warn", msg, data)}\n`),
		error: (msg: string, data?: unknown) =>
			shouldLog("error") && process.stderr.write(`${fmt("error", msg, data)}\n`),
	};
}
