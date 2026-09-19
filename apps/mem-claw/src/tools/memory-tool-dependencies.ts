/* Shared host tool dependencies; no runtime composition. */
export { existsSync, realpathSync } from "node:fs";
export { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
export { homedir } from "node:os";
export { basename, dirname, join, resolve, sep } from "node:path";
export { Type } from "@sinclair/typebox";
export { Mutex } from "async-mutex";
export type { OpenClawPluginApi as SnoStationMemPluginApi } from "openclaw/plugin-sdk/core";
export { z } from "zod";
export { RESOURCES_BY_LOCALE } from "@snoai/sno-station-mem/internal/engine/i18n/all-resources";
export type { Locale } from "@snoai/sno-station-mem/internal/engine/i18n/locales";
export { DEFAULT_LOCALE } from "@snoai/sno-station-mem/internal/engine/i18n/locales";
export { ensureSelfImprovementLearningFiles } from "@snoai/sno-station-mem/internal/engine/operations/learning-file-maintenance";
export { SnoStationMemError } from "@snoai/sno-station-mem/internal/engine/shared/errors";
export { AGGREGATION_OPERATIONS, MEMORY_CATEGORIES } from "@snoai/sno-station-mem/internal/engine/shared/types";
