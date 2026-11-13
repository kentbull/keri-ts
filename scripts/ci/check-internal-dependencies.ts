/**
 * Fail when a package is behind the packages it depends on.
 *
 * Every workspace package declares its internal dependencies, at exactly the dependency's current version, in
 * its `package.json`. Changesets reads that declaration: a bump of a dependency makes it bump every dependent
 * (at least a patch) and rewrite the pin, transitively. The published packages pin exactly (see
 * docs/versioning/release-versioning.md), so a dependent that was not bumped would publish a pin on an old
 * dependency and a consumer would resolve two copies of it.
 *
 * Checked here:
 * - each declared internal dependency equals that package's current version (a stale pin means the dependent
 *   was not bumped with it);
 * - each `../<name>/package.json` a package's `scripts/build_npm.ts` reads for a version is declared, so the
 *   build and Changesets see the same graph.
 *
 * Usage: deno run -A scripts/ci/check-internal-dependencies.ts [root]
 */

interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

/** Read every `packages/<dir>/package.json` under `root`, keyed by directory name. */
export async function readWorkspace(root: string): Promise<Map<string, Manifest>> {
  const found = new Map<string, Manifest>();
  for await (const entry of Deno.readDir(`${root}/packages`)) {
    if (!entry.isDirectory) continue;
    try {
      found.set(entry.name, JSON.parse(await Deno.readTextFile(`${root}/packages/${entry.name}/package.json`)));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return found;
}

/** Problems found in the workspace under `root`; empty when coherent. */
export async function checkInternalDependencies(root: string): Promise<string[]> {
  const workspace = await readWorkspace(root);
  const byName = new Map([...workspace.values()].map((manifest) => [manifest.name, manifest]));
  const problems: string[] = [];
  for (const [dir, manifest] of workspace) {
    const declared = manifest.dependencies ?? {};
    for (const [name, pin] of Object.entries(declared)) {
      const dependency = byName.get(name);
      if (dependency && pin !== dependency.version) {
        problems.push(
          `${manifest.name}@${manifest.version} pins ${name} at ${pin}, but ${name} is at ${dependency.version}: `
            + `bump ${manifest.name} (a changeset naming it) and run the version step`,
        );
      }
    }
    let script = "";
    try {
      script = await Deno.readTextFile(`${root}/packages/${dir}/scripts/build_npm.ts`);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    for (const [, sibling] of script.matchAll(/"\.\.\/([a-z0-9-]+)\/package\.json"/g)) {
      const dependency = workspace.get(sibling);
      if (dependency && sibling !== dir && !(dependency.name in declared)) {
        problems.push(
          `${manifest.name} reads ${dependency.name}'s version in scripts/build_npm.ts but does not declare it in `
            + `package.json dependencies`,
        );
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = Deno.args[0] ?? new URL("../..", import.meta.url).pathname;
  const problems = await checkInternalDependencies(root);
  if (problems.length) {
    console.error(`internal dependency check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    Deno.exit(1);
  }
  console.log("internal dependencies: every pin matches its dependency's current version");
}
