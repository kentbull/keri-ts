/**
 * Re-export of shared CLI rendering helpers.
 *
 * Tufa command adapters use this shim so presentation remains an edge concern
 * while reusable rendering primitives live with the transitional CLI support
 * surface.
 */
export { writeJsonLine, writeTextLines } from "keri-ts/cli";
