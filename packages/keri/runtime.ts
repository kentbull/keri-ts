/**
 * Explicit non-browser-safe runtime surface for `keri-ts`.
 *
 * This subpath exists so the package root can stay browser-safe by default
 * while runtime, networking, filesystem, and host-adjacent concerns remain
 * available to trusted consumers such as `tufa`.
 */
export * from "./src/runtime/index.ts";
