/**
 * Print the LMDB package version and directory visible from the current Deno
 * working directory.
 *
 * CI environment assertions call this instead of embedding a Node heredoc in a
 * shell script. The upward walk mirrors how local commands discover the nearest
 * workspace `node_modules/@keri-ts/lmdb-js` installation.
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

/** Find the nearest ancestor containing `node_modules/@keri-ts/lmdb-js`. */
function findLmdbDir(): string | null {
  let dir = Deno.cwd();
  while (dir !== dirname(dir)) {
    const candidate = `${dir}/node_modules/@keri-ts/lmdb-js`;
    if (exists(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}

try {
  const lmdbDir = findLmdbDir();
  if (!lmdbDir) {
    throw new Error("@keri-ts/lmdb-js not installed");
  }
  const pkg = JSON.parse(Deno.readTextFileSync(`${lmdbDir}/package.json`));
  console.log(`@keri-ts/lmdb-js: ${pkg.version}`);
  console.log(`@keri-ts/lmdb-js dir: ${lmdbDir}`);
} catch {
  console.log("@keri-ts/lmdb-js: not installed");
}
