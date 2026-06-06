/**
 * Print the package fields that matter when auditing an LMDB rebuild target.
 *
 * Keeping this in TypeScript avoids JSON parsing heredocs in the setup shell
 * script while preserving a small, stable command-line contract.
 */

const packageJsonPath = Deno.args[0];
if (!packageJsonPath) {
  throw new Error("Usage: read-package-summary.ts <package.json>");
}

const pkg = JSON.parse(Deno.readTextFileSync(packageJsonPath));
console.log(
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      repository: pkg.repository?.url ?? pkg.repository,
    },
    null,
    2,
  ),
);
