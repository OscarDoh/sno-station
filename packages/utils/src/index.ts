export { addLogFileTarget, closeLogger, configureLogger, createLogger, effectiveLogLevel,
	emitDiagnostic, loggerFileStatus } from "./logger.js";
export type { Logger, LoggerConfiguration, LogLevel, LogResource, LogSource, LogSiteCatalog } from "./logger.js";
export { currentLogContext, externalLogReference, privateLogReference, withLogContext } from "./log-context.js";
export type { LogContext, LogContextInput, LogReference } from "./log-context.js";
export { encodeDiagnostic, sanitizeLogAttributes } from "./log-encoder.js";
