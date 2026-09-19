import { z } from "zod";

/** Embedded content types. Code now routes through the attachment axis, not embedding. */
export const CONTENT_TYPES = ["conversation", "prose", "structured"] as const;

/** Per PRD §7.2. */
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Per PRD §7.2. Validates content-type strings at trust boundaries. */
export const ContentTypeSchema = z.enum(CONTENT_TYPES);
