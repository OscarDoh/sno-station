/** @file path-a-install-nudge.ts
 * @purpose Path A install-time trade-off nudge — TypeScript-side surface.
 * @boundary Re-export only. The renderer itself lives in
 *   `bin/_install-nudge-shared.js` so the npm install wrapper
 *   (plain JS, no TS build) and this TS file are the same source.
 *   A drift snapshot pins both branches.
 */

export { renderPathANudge } from "../../bin/_install-nudge-shared.js";
