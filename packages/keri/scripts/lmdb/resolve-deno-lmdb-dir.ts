/**
 * Ask Deno which `npm:lmdb` package directory it would actually load.
 *
 * This intentionally goes through `import.meta.resolve` so setup_lmdb_v1.sh can
 * rebuild Deno's shadow npm package copy, not just the package directory humans
 * expect from the workspace layout.
 */

/** Test path existence while preserving non-NotFound filesystem errors. */
function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function dirname(path: string): string {
  const marker = "/";
  const index = path.lastIndexOf(marker);
  return index < 0 ? "." : path.slice(0, index);
}

const resolved = import.meta.resolve("npm:lmdb@3.5.3");

if (resolved.startsWith("file:")) {
  // Drop the trailing slash returned for the resolved package directory so the
  // shell script can compare and print stable directory paths.
  console.log(new URL(".", resolved).pathname.replace(/\/$/, ""));
} else if (resolved.startsWith("/") && exists(resolved)) {
  console.log(dirname(resolved));
} else {
  const candidates = [
    `${Deno.cwd()}/node_modules/.deno/lmdb@3.5.3/node_modules/lmdb`,
    `${Deno.cwd()}/node_modules/lmdb`,
  ];
  const candidate = candidates.find((path) => exists(path));
  if (!candidate) {
    throw new Error(
      `could not resolve npm:lmdb@3.5.3 to a local package directory; got ${resolved}`,
    );
  }
  console.log(candidate);
}
