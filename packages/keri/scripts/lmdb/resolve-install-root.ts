/**
 * Resolve the highest ancestor that contains a `node_modules` directory.
 *
 * setup_lmdb_v1.sh uses this to find the install root that owns both the
 * workspace package tree and any Deno shadow npm package tree.
 */

/** Return the parent directory for a POSIX-style path. */
function dirname(path: string): string {
  // Strip trailing slashes first so `/a/b/` reports `/a` instead of `/a/b`.
  const clean = path.replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  return index <= 0 ? "/" : clean.slice(0, index);
}

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

let dir = Deno.cwd();
let found = "";
while (true) {
  if (exists(`${dir}/node_modules`)) {
    found = dir;
  }
  const parent = dirname(dir);
  if (parent === dir) {
    break;
  }
  dir = parent;
}

if (!found) {
  Deno.exit(1);
}

console.log(found);
