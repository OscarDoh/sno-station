import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

// ANSI colors — preserved in both stderr and file output
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

// ── Redaction ────────────────────────────────────────────────────────────────
// Exact key names (case-insensitive) that indicate sensitive values.
// Uses exact match to avoid false positives like "token_count" or "secretary".

const SENSITIVE_KEYS = new Set([
	"authorization",
	"token",
	"apikey",
	"api_key",
	"api-key",
	"secret",
	"password",
	"cookie",
	"credential",
	"credentials",
	"privatekey",
	"private_key",
	"accesstoken",
	"access_token",
	"refreshtoken",
	"refresh_token",
	"bearer",
]);

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEYS.has(
		key.toLowerCase().replace(/[-_]/g, "").toLowerCase(),
	);
}

// ── Serialization ────────────────────────────────────────────────────────────

function normalize(value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
			...(value.cause !== undefined ? { cause: normalize(value.cause) } : {}),
		};
	}
	if (typeof value === "function") {
		return `[Function ${value.name || "anonymous"}]`;
	}
	if (typeof value === "symbol") {
		return value.toString();
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	return value;
}

function safeStringify(data: unknown): string {
	try {
		const ancestors: object[] = [];
		const json = JSON.stringify(
			normalize(data),
			function (key, value: unknown) {
				// Normalize nested non-plain values (Error, function, symbol, bigint)
				const normalized = normalize(value);

				// Redact sensitive keys (applied to the key from the parent object)
				if (key && isSensitiveKey(key)) return "[REDACTED]";

				// Handle primitives after normalization
				if (typeof normalized !== "object" || normalized === null)
					return normalized;

				// Walk up the ancestor stack to match the current parent
				while (
					ancestors.length > 0 &&
					ancestors[ancestors.length - 1] !== this
				) {
					ancestors.pop();
				}
				if (ancestors.includes(normalized)) return "[Circular]";
				ancestors.push(normalized);
				return normalized;
			},
		);
		return json ?? String(data);
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

// ── Log level ────────────────────────────────────────────────────────────────

const DEFAULT_LOG_LEVEL: LogLevel = "info";
const VALID_LOG_LEVELS = new Set<LogLevel>(
	Object.keys(LEVEL_ORDER) as LogLevel[],
);
// biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noUncheckedIndexedAccess
const rawLogLevel = process.env["LOG_LEVEL"];
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

// ── Unified file logging ─────────────────────────────────────────────────────
// ALL logs from every app/package go to ONE file: {repoRoot}/logs/dev.log
// Auto-detected from .git directory. No env var needed. In production (compiled
// binary, no .git), file logging is silently skipped.
// Override with LOG_FILE env var if needed.
// LH: ANSI color codes are preserved in the log file — use `cat` to view with colors.

const UNIFIED_LOG_NAME = "dev.log";

function findRepoRoot(): string | undefined {
	let dir = process.cwd();
	for (let i = 0; i < 20; i++) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

function resolveLogFilePath(): string | undefined {
	// Explicit override takes priority
	// biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noUncheckedIndexedAccess
	const explicit = process.env["LOG_FILE"];
	if (explicit) return explicit;
	// Auto-detect repo root for dev mode
	const root = findRepoRoot();
	if (!root) return undefined;
	return join(root, "logs", UNIFIED_LOG_NAME);
}

let logFd: number | undefined;
let logFdResolved = false;
let logFileDisabled = false;

function getLogFd(): number | undefined {
	if (logFileDisabled) return undefined;
	if (logFdResolved) return logFd;
	logFdResolved = true;
	const filePath = resolveLogFilePath();
	if (!filePath) return undefined;
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		logFd = openSync(filePath, "a");
	} catch {
		logFileDisabled = true;
		process.stderr.write(
			`${C.yellow}[logger]${C.reset} Failed to open log file: ${filePath}\n`,
		);
	}
	return logFd;
}

// LH: Write with ANSI colors preserved — `cat logs/dev.log` renders colors in terminal
function writeToFile(line: string): void {
	const fd = getLogFd();
	if (fd === undefined) return;
	try {
		writeSync(fd, `${line}\n`);
	} catch (error: unknown) {
		// Permanently disable file logging — avoid retry spam on persistent failure
		logFileDisabled = true;
		if (logFd !== undefined) {
			try {
				closeSync(logFd);
			} catch {
				// Best-effort close
			}
			logFd = undefined;
		}
		process.stderr.write(
			`${C.yellow}[logger]${C.reset} File logging permanently disabled: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export function createLogger(scope: string) {
	const safeScope = sanitizeMessage(scope);

	const shouldLog = (level: LogLevel) =>
		LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];

	const fmt = (level: LogLevel, msg: string, data?: unknown): string => {
		const ts = formatPST(new Date());
		const lvl = level.toUpperCase().padEnd(5);
		const lc = LEVEL_COLOR[level];
		const safeMsg = sanitizeMessage(msg);
		const dataStr = data !== undefined ? ` ${safeStringify(data)}` : "";
		return `${C.cyan}[${safeScope}]${C.reset} ${C.dim}${ts}${C.reset} - ${lc}${lvl}${C.reset} - ${safeMsg}${dataStr}`;
	};

	const emit = (level: LogLevel, msg: string, data?: unknown): boolean => {
		if (!shouldLog(level)) return false;
		const line = fmt(level, msg, data);
		process.stderr.write(`${line}\n`);
		writeToFile(line);
		return true;
	};

	return {
		debug: (msg: string, data?: unknown) => emit("debug", msg, data),
		info: (msg: string, data?: unknown) => emit("info", msg, data),
		warn: (msg: string, data?: unknown) => emit("warn", msg, data),
		error: (msg: string, data?: unknown) => emit("error", msg, data),
	};
}
