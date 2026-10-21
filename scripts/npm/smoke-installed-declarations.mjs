/** Compile explicit installed consumers only after the invoking runtime probes have finished. */
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";

// Install compiler tools only after runtime checks, so they cannot mask missing
// runtime dependencies. Check the actual packed declarations without skipping libs.
execFileSync("npm", [
  "install",
  "--no-save",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "typescript@5.9.3",
  "@types/node@20.19.43",
], { stdio: "inherit" });
// npm init defaults to CommonJS; compile each explicitly selected maintained fixture as an ESM client.
const fixtures = process.argv.slice(2);
if (!fixtures.length) throw new Error("At least one installed consumer fixture is required");
const clients = fixtures.map(path => {
  const target = path.replace(/\.ts$/, ".mts");
  copyFileSync(path, target);
  return target;
});
execFileSync(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "--noEmit",
  "--strict",
  "--module",
  "NodeNext",
  "--target",
  "ES2022",
  "--lib",
  "ES2022,DOM,DOM.Iterable",
  ...clients,
], { stdio: "inherit" });

console.error("Installed declarations passed strict NodeNext checking.");
