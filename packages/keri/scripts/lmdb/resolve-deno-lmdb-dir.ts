/**
 * Ask Deno which `npm:lmdb` package directory it would actually load.
 *
 * This intentionally goes through `import.meta.resolve` so setup_lmdb_v1.sh can
 * rebuild Deno's shadow npm package copy, not just the package directory humans
 * expect from the workspace layout.
 */

// Drop the trailing slash returned for the resolved package directory so the
// shell script can compare and print stable directory paths.
// dprint-ignore-start
console.log(
  new URL(".", import.meta.resolve("npm:lmdb@3.5.3"))
    .pathname
    .replace(/\/$/, "")
);
// dprint-ignore-end
