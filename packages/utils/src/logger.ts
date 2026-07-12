import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
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
	"secret",
	"password",
	"cookie",
	"credential",
	"credentials",
	"privatekey",
	"accesstoken",
	"refreshtoken",
	"bearer",
]);

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""));
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
	// Skip unified dev.log during test runs. Negative-path tests intentionally emit
	// warnings/errors, and writing them into the shared dev log makes runtime debugging noisy.
	// Keep stderr logging enabled so failed tests still surface diagnostics normally.
	// biome-ignore lint/complexity/useLiteralKeys: bracket notation required by noUncheckedIndexedAccess
	if (process.env["NODE_ENV"] === "test") return undefined;
	// Auto-detect repo root for dev mode
	const root = findRepoRoot();
	if (!root) return undefined;
	return join(root, "logs", UNIFIED_LOG_NAME);
}

let logFilePath: string | undefined;
let logFilePathResolved = false;
let logFileDisabled = false;
let logWriteQueue: Promise<void> = Promise.resolve();
let shutdownHooksInstalled = false;
let flushingOnShutdown = false;

function getLogFilePath(): string | undefined {
	if (logFileDisabled) return undefined;
	if (logFilePathResolved) return logFilePath;
	logFilePathResolved = true;
	const filePath = resolveLogFilePath();
	if (!filePath) return undefined;
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		logFilePath = filePath;
	} catch {
		logFileDisabled = true;
		process.stderr.write(
			`${C.yellow}[logger]${C.reset} Failed to prepare log file: ${filePath}\n`,
		);
	}
	return logFilePath;
}

function disableFileLogging(error: unknown): void {
	if (logFileDisabled) return;
	logFileDisabled = true;
	logFilePath = undefined;
	process.stderr.write(
		`${C.yellow}[logger]${C.reset} File logging permanently disabled: ${error instanceof Error ? error.message : String(error)}\n`,
	);
}

function writeToFile(line: string): void {
	const filePath = getLogFilePath();
	if (filePath === undefined) return;

	// Queue async appends so file logging never blocks the event loop and preserves order.
	logWriteQueue = logWriteQueue
		.then(() => appendFile(filePath, `${line}\n`))
		.catch((error: unknown) => {
			disableFileLogging(error);
		});
}

export async function closeLogger(): Promise<void> {
	await logWriteQueue;
}

function installShutdownHooks(): void {
	if (shutdownHooksInstalled) return;
	shutdownHooksInstalled = true;

	const flush = async (exitCode?: number) => {
		if (flushingOnShutdown) return;
		flushingOnShutdown = true;
		try {
			await closeLogger();
		} finally {
			flushingOnShutdown = false;
			if (exitCode !== undefined) {
				process.exit(exitCode);
			}
		}
	};

	process.once("beforeExit", () => {
		void flush();
	});
	process.once("SIGINT", () => {
		void flush(130);
	});
	process.once("SIGTERM", () => {
		void flush(143);
	});
}

// ── Public API ───────────────────────────────────────────────────────────────

export function createLogger(scope: string) {
	installShutdownHooks();

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
		debug: (msg: string, data?: unknown): boolean => emit("debug", msg, data),
		info: (msg: string, data?: unknown): boolean => emit("info", msg, data),
		warn: (msg: string, data?: unknown): boolean => emit("warn", msg, data),
		error: (msg: string, data?: unknown): boolean => emit("error", msg, data),
	};
}
