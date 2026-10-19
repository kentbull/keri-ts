/**
 * Runtime smoke probe for an installed `keri-ts` npm package.
 *
 * This script runs inside a temporary npm project in a bare Node container. It
 * verifies both manifest-target existence and the public import surfaces that
 * users rely on after installing the packed tarball.
 */
import { Signer } from "cesr-ts";
import { run } from "effection";
import * as keri from "keri-ts";
import * as db from "keri-ts/db";
import * as runtime from "keri-ts/runtime";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

assert(
  typeof keri.PACKAGE_VERSION === "string" && keri.PACKAGE_VERSION.length > 0,
  "keri-ts root missing PACKAGE_VERSION",
);
assert(
  typeof keri.DISPLAY_VERSION === "string" && keri.DISPLAY_VERSION.length > 0,
  "keri-ts root missing DISPLAY_VERSION",
);
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

// Exercise the installed native reader above LMDB-js's 16 MiB shared-buffer threshold.
// This is a fresh current-version raw table, not a prior-version data compatibility test.
const nativeRoot = await mkdtemp(join(tmpdir(), "keri-native-smoke-"));
try {
  await run(function*() {
    const store = yield* db.openLMDB({ name: "installed", headDirPath: nativeRoot, temp: false });
    try {
      let table = store.openDB("installed.", false);
      const key = new TextEncoder().encode("large");
      const value = new Uint8Array(16 * 1024 ** 2 + 1).fill(0xa5);
      value[0] = 0xff;
      value[value.length - 1] = 0xfe;
      const digest = createHash("sha256").update(value).digest("hex");
      store.setVal(table, key, value);
      assert(createHash("sha256").update(store.getVal(table, key)).digest("hex") === digest, "native large-row read changed bytes");
      yield* store.close(false);
      assert(yield* store.reopen({ reuse: true }), "native store did not reopen");
      table = store.openDB("installed.", false);
      const retained = store.getVal(table, key);
      assert(createHash("sha256").update(retained).digest("hex") === digest, "native large row changed across reopen");
      store.setVal(table, key, new Uint8Array([1, 2, 3]));
      assert(createHash("sha256").update(retained).digest("hex") === digest, "later native writes changed caller-owned bytes");
      assert(store.getVal(table, key).join(",") === "1,2,3", "native writer failed after the large read");
    } finally {
      yield* store.close(true);
    }
  });
} finally {
  await rm(nativeRoot, { recursive: true, force: true });
}
console.error("Installed native LMDB >16 MiB read/reopen and owned-byte checks passed.");

const signedBytes = new TextEncoder().encode("installed CESR crypto and TCP qualification");
const signer = Signer.random();
const signature = signer.sign(signedBytes);
assert(signer.verfer.verify(signature.raw, signedBytes), "installed signer/verifier failed");
const altered = signedBytes.slice();
altered[0] ^= 1;
assert(!signer.verfer.verify(signature.raw, altered), "installed verifier accepted altered bytes");
console.error("Installed CESR signing and tamper-refusal checks passed.");

// Exercise the public native TCP owner; successful transmission is not protocol acceptance.
let finishReceive, failReceive;
const received = new Promise((resolve, reject) => { finishReceive = resolve; failReceive = reject; });
const server = createServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.once("end", () => finishReceive(Buffer.concat(chunks)));
  socket.once("error", failReceive);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
try {
  const wire = signature.qb64b;
  const [result, bytes] = await Promise.all([
    run(() => runtime.sendCesrTcp(`tcp://127.0.0.1:${server.address().port}`, wire, runtime.systemClock, {
      maxChunkBytes: 7, connectTimeoutMs: 5000, drainTimeoutMs: 5000, signal: AbortSignal.timeout(5000),
    })),
    received,
  ]);
  assert(result.kind === "transmitted" && result.bytes === wire.length, "installed TCP transmission did not complete");
  assert(Buffer.from(bytes).equals(Buffer.from(wire)), "installed TCP changed transmitted bytes");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.error("Installed TCP transmission and joined socket close passed.");

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
// npm init defaults to CommonJS; compile the maintained fixture as a Node ESM client.
copyFileSync("keri-consumer.ts", "keri-consumer.mts");
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
  "keri-consumer.mts",
], { stdio: "inherit" });

console.error("Installed keri-ts declarations passed strict NodeNext checking.");
