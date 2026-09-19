import { z } from "zod";

/** Independent routing axis: embed normalized content, or store raw attachment out-of-band. */
export const CONTENT_ROUTES = ["embed", "attachment"] as const;

/** Route discriminator for trust-boundary parsing. */
export type ContentRoute = (typeof CONTENT_ROUTES)[number];

/** Validates route strings at trust boundaries. */
export const ContentRouteSchema = z.enum(CONTENT_ROUTES);
