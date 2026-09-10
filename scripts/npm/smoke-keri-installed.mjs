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
import { createAgentRuntime } from "keri-ts/app/agent-runtime";
import { Kevery } from "keri-ts/core/eventing";
import { createBaser } from "keri-ts/db/basing";
import { credential } from "keri-ts/vdr/credentialing";
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
  if (!target.startsWith("./") || target.includes("*")) {
    continue;
  }
  const installedPath = join(packageRoot, target.slice(2));
  assert(existsSync(installedPath), `installed keri-ts package is missing export target ${target}`);
}

assert(typeof keri.PACKAGE_VERSION === "string" && keri.PACKAGE_VERSION.length > 0, "keri-ts root missing PACKAGE_VERSION");
assert(typeof keri.DISPLAY_VERSION === "string" && keri.DISPLAY_VERSION.length > 0, "keri-ts root missing DISPLAY_VERSION");
assert(typeof runtime.createAgentRuntime === "function", "keri-ts/runtime missing createAgentRuntime");
assert(typeof runtime.Kevery === "function", "keri-ts/runtime missing Kevery");
assert(typeof runtime.messagize === "function", "keri-ts/runtime missing messagize");
assert(typeof runtime.inceptRegistry === "function", "keri-ts/runtime missing inceptRegistry");
assert(typeof db.createBaser === "function", "keri-ts/db missing createBaser");
assert(typeof db.LMDBer === "function", "keri-ts/db missing LMDBer");
assert(typeof db.dgKey === "function", "keri-ts/db missing dgKey");
assert(typeof createAgentRuntime === "function", "keri-ts/app/* export pattern is broken");
assert(typeof Kevery === "function", "keri-ts/core/* export pattern is broken");
assert(typeof createBaser === "function", "keri-ts/db/* export pattern is broken");
assert(typeof credential === "function", "keri-ts/vdr/* export pattern is broken");

assert(!("startServer" in keri), "keri-ts root leaked startServer");
assert(!("createTufaApp" in keri), "keri-ts root leaked createTufaApp");
assert(!("tufa" in keri), "keri-ts root leaked tufa CLI");
assert(!("reportCliFailure" in keri), "keri-ts root leaked CLI failure helper");

console.error("keri-ts root exports:", Object.keys(keri).sort().join(", "));
console.error("keri-ts/runtime exports:", Object.keys(runtime).slice(0, 12).sort().join(", "));
console.error("keri-ts/db exports:", Object.keys(db).slice(0, 12).sort().join(", "));
