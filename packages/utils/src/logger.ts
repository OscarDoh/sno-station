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

const PST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Los_Angeles",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function formatPST(date: Date): string {
	const parts = PST_FORMATTER.formatToParts(date);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	const year = byType.get("year") ?? "0000";
	const month = byType.get("month") ?? "00";
	const day = byType.get("day") ?? "00";
	const hour = byType.get("hour") ?? "00";
	const minute = byType.get("minute") ?? "00";
	const second = byType.get("second") ?? "00";
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function safeStringify(data: unknown): string {
	try {
		const seen = new WeakSet();
		return JSON.stringify(data, (_key, val) => {
			if (typeof val === "bigint") return val.toString();
			if (typeof val === "object" && val !== null) {
				if (seen.has(val)) return "[Circular]";
				seen.add(val);
			}
			return val;
		});
	} catch (error: unknown) {
		return `"[Unserializable: ${error instanceof Error ? error.message : String(error)}]"`;
	}
}

function sanitizeMessage(message: string): string {
	let sanitized = "";
	for (const ch of message) {
		const code = ch.charCodeAt(0);
		sanitized += code < 0x20 || code === 0x7f ? " " : ch;
	}
	return sanitized.trim().replace(/\s+/g, " ");
}

const env = process.env as NodeJS.ProcessEnv & { LOG_LEVEL?: string };
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const VALID_LOG_LEVELS = new Set<LogLevel>(
	Object.keys(LEVEL_ORDER) as LogLevel[],
);
const rawLogLevel = env.LOG_LEVEL;
const currentLevel: LogLevel =
	rawLogLevel !== undefined && VALID_LOG_LEVELS.has(rawLogLevel as LogLevel)
		? (rawLogLevel as LogLevel)
		: DEFAULT_LOG_LEVEL;
if (
	rawLogLevel !== undefined &&
	!VALID_LOG_LEVELS.has(rawLogLevel as LogLevel)
) {
	process.stderr.write(
		`${C.yellow}[logger]${C.reset} ${C.dim}${formatPST(new Date())}${C.reset} - ${C.yellow}WARN ${C.reset} - Invalid LOG_LEVEL "${rawLogLevel}". Falling back to "${DEFAULT_LOG_LEVEL}".\n`,
	);
}

export function createLogger(scope: string) {
	const shouldLog = (level: LogLevel) =>
		LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];

	const fmt = (level: LogLevel, msg: string, data?: unknown): string => {
		const ts = formatPST(new Date());
		const lvl = level.toUpperCase().padEnd(5);
		const lc = LEVEL_COLOR[level];
		const safeMsg = sanitizeMessage(msg);
		const dataStr = data !== undefined ? ` ${safeStringify(data)}` : "";
		return `${C.cyan}[${scope}]${C.reset} ${C.dim}${ts}${C.reset} - ${lc}${lvl}${C.reset} - ${safeMsg}${dataStr}`;
	};

	return {
		debug: (msg: string, data?: unknown) =>
			shouldLog("debug") &&
			process.stderr.write(`${fmt("debug", msg, data)}\n`),
		info: (msg: string, data?: unknown) =>
			shouldLog("info") && process.stderr.write(`${fmt("info", msg, data)}\n`),
		warn: (msg: string, data?: unknown) =>
			shouldLog("warn") && process.stderr.write(`${fmt("warn", msg, data)}\n`),
		error: (msg: string, data?: unknown) =>
			shouldLog("error") &&
			process.stderr.write(`${fmt("error", msg, data)}\n`),
	};
}
