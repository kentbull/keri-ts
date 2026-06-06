/**
 * Default `keri-ts` library surface.
 *
 * Boundary rule:
 * - root/default imports must remain browser-safe
 * - non-browser-safe runtime and LMDB-backed storage live behind explicit
 *   subpath entrypoints such as `keri-ts/runtime` and `keri-ts/db`
 */
export { BUILD_METADATA, DISPLAY_VERSION, PACKAGE_VERSION } from "./src/app/version.ts";
export * from "./src/library/index.ts";
