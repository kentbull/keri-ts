/**
 * List every local `lmdb` package directory that setup_lmdb_v1.sh may need to
 * rebuild.
 *
 * Deno can materialize npm packages under `node_modules/.deno/...`, so checking
 * only the top-level `node_modules/lmdb` directory is not enough.
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

const root = Deno.env.get("ROOT_DIR") ?? Deno.args[0];
if (!root) {
  throw new Error("ROOT_DIR or root argument is required");
}

const dirs = new Set<string>();
const nodeModulesLm = `${root}/node_modules/lmdb`;
if (exists(nodeModulesLm)) {
  dirs.add(nodeModulesLm);
}

const denoRoot = `${root}/node_modules/.deno`;
if (exists(denoRoot)) {
  for (const entry of Deno.readDirSync(denoRoot)) {
    const candidate = `${denoRoot}/${entry.name}/node_modules/lmdb`;
    if (exists(candidate)) {
      dirs.add(candidate);
    }
  }
}

for (const dir of dirs) {
  console.log(dir);
}
