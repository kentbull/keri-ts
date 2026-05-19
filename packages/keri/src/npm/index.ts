/**
 * npm package root entrypoint.
 *
 * Boundary rule:
 * - root/default imports remain browser-safe
 * - runtime and LMDB-backed storage move to explicit subpaths
 */
export * from "../library/index.ts";
export {
  BUILD_METADATA,
  DISPLAY_VERSION,
  PACKAGE_VERSION,
} from "../app/version.ts";
