/**
 * Runtime smoke probe for an installed `keri-ts` npm package.
 *
 * This script runs inside a temporary npm project in a bare Node container. It
 * verifies both manifest-target existence and the public import surfaces that
 * users rely on after installing the packed tarball.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as db from "keri-ts/db";
import * as keri from "keri-ts";
import * as runtime from "keri-ts/runtime";
import { collectManifestTargets } from "./package-targets.mjs";

/** Throw an actionable smoke failure when a package invariant is false. */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageRoot = "node_modules/keri-ts";
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

for (const target of collectManifestTargets(manifest)) {
  if (!target.startsWith("./")) {
    continue;
  }
  const installedPath = join(packageRoot, target.slice(2));
  assert(existsSync(installedPath), `installed keri-ts package is missing export target ${target}`);
}

assert(typeof keri.PACKAGE_VERSION === "string" && keri.PACKAGE_VERSION.length > 0, "keri-ts root missing PACKAGE_VERSION");
assert(typeof keri.DISPLAY_VERSION === "string" && keri.DISPLAY_VERSION.length > 0, "keri-ts root missing DISPLAY_VERSION");
assert(typeof runtime.createAgentRuntime === "function", "keri-ts/runtime missing createAgentRuntime");
assert(typeof db.createBaser === "function", "keri-ts/db missing createBaser");

assert(!("startServer" in keri), "keri-ts root leaked startServer");
assert(!("createTufaApp" in keri), "keri-ts root leaked createTufaApp");
assert(!("tufa" in keri), "keri-ts root leaked tufa CLI");
assert(!("reportCliFailure" in keri), "keri-ts root leaked CLI failure helper");

console.error("keri-ts root exports:", Object.keys(keri).sort().join(", "));
console.error("keri-ts/runtime exports:", Object.keys(runtime).slice(0, 12).sort().join(", "));
console.error("keri-ts/db exports:", Object.keys(db).slice(0, 12).sort().join(", "));
