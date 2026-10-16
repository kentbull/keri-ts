/**
 * Runtime smoke probe for an installed `keri-ts` npm package.
 *
 * This script runs inside a temporary npm project in a bare Node container. It
 * verifies both manifest-target existence and the public import surfaces that
 * users rely on after installing the packed tarball.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
assert(typeof runtime.credential === "function", "keri-ts/runtime missing credential");
assert(runtime.Algos?.salty === "salty", "keri-ts/runtime missing Manager algorithm selection");

assert(!("startServer" in keri), "keri-ts root leaked startServer");
assert(!("createTufaApp" in keri), "keri-ts root leaked createTufaApp");
assert(!("tufa" in keri), "keri-ts root leaked tufa CLI");
assert(!("reportCliFailure" in keri), "keri-ts root leaked CLI failure helper");

console.error("keri-ts root exports:", Object.keys(keri).sort().join(", "));
console.error("keri-ts/runtime exports:", Object.keys(runtime).slice(0, 12).sort().join(", "));
console.error("keri-ts/db exports:", Object.keys(db).slice(0, 12).sort().join(", "));

// Exercise the generated Deno shim through the public npm storage API, including fsync.
const payloadRoot = await mkdtemp(join(tmpdir(), "keri-payload-smoke-"));
const payloadStore = new db.PayloadStore(payloadRoot, 2);
try {
  const sink = await payloadStore.stage();
  await sink.write(new Uint8Array([1, 2, 3]));
  const payload = await sink.finish();
  await payload.promote("essr.smoke");
  const reopened = await payloadStore.open(payload.id);
  const bytes = [];
  for await (const chunk of reopened.open()) bytes.push(...chunk);
  assert(bytes.join(",") === "1,2,3", "npm payload file changed bytes during promotion");
  await reopened.discard();
  const aborted = await payloadStore.stage();
  await aborted.write(new Uint8Array([4]));
  await aborted.abort();
  await aborted.abort();
} finally {
  await payloadStore.close();
  await rm(payloadRoot, { recursive: true });
}
