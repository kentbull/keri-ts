/**
 * Explicit non-browser-safe CLI command-helper surface for `keri-ts`.
 *
 * This subpath is separated from `keri-ts/runtime` so host/runtime consumers
 * can avoid pulling Commander-backed command modules into their import graph.
 */
export * from "./src/app/cli/index.ts";
