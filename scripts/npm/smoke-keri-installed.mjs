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
import { createServer as createHttpServer } from "node:http";
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
assert(typeof runtime.EssrRecipient === "function", "keri-ts/runtime missing ESSR recipient");
assert(typeof runtime.credential === "function", "keri-ts/runtime missing credential");
assert(runtime.Algos?.salty === "salty", "keri-ts/runtime missing Manager algorithm selection");


console.error("keri-ts root exports:", Object.keys(keri).sort().join(", "));
console.error("keri-ts/runtime exports:", Object.keys(runtime).slice(0, 12).sort().join(", "));
console.error("keri-ts/db exports:", Object.keys(db).slice(0, 12).sort().join(", "));

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

// Prove the installed native writer rolls back a late secret-policy failure.
const keeperRoot = await mkdtemp(join(tmpdir(), "keri-aeid-smoke-"));
try {
  await run(function*() {
    const keeper = yield* db.createKeeper({ name: "installed-aeid", headDirPath: keeperRoot });
    try {
      const first = Signer.random({ transferable: false });
      const second = Signer.random({ transferable: false });
      const manager = new runtime.Manager({ ks: keeper, seed: first.qb64, aeid: first.verfer.qb64 });
      const [verfers] = manager.incept({ icount: 2, ncount: 2, transferable: true, temp: true });
      const pubs = verfers.map((verfer) => verfer.qb64);
      const message = new TextEncoder().encode("installed AEID commit proof");
      const before = manager.sign(message, pubs, true).map((signature) => signature.qb64).join();
      const rootSalt = keeper.getGbls("salt");
      const prefixSalt = keeper.getPrms(pubs[0]).salt;
      const failure = new Error("Injected installed AEID write failure");
      const pin = keeper.pinGbls;
      keeper.pinGbls = function(key, value) {
        const result = pin.call(this, key, value);
        if (key === "aeid") throw failure;
        return result;
      };
      let observed;
      try {
        manager.updateAeid(second.verfer.qb64, second.qb64);
      } catch (error) {
        observed = error;
      } finally {
        keeper.pinGbls = pin;
      }
      assert(observed === failure, "installed AEID change lost its late failure");
      assert(keeper.getGbls("salt") === rootSalt && keeper.getPrms(pubs[0]).salt === prefixSalt,
        "installed AEID failure changed secret rows");
      assert(manager.aeid === first.verfer.qb64 && manager.seed === first.qb64,
        "installed AEID failure changed manager policy");
      assert(manager.sign(message, pubs, true).map((signature) => signature.qb64).join() === before,
        "installed AEID rollback lost signing keys");
      manager.updateAeid(second.verfer.qb64, second.qb64);
      yield* keeper.close(false);
      assert(yield* keeper.reopen({ reuse: true }), "installed keeper did not reopen");
      const reopened = new runtime.Manager({ ks: keeper, seed: second.qb64 });
      const signatures = reopened.sign(message, pubs, true);
      assert(signatures.every((signature, index) => verfers[index].verify(signature.raw, message)),
        "installed AEID commit lost signing keys on reopen");
    } finally {
      yield* keeper.close(true);
    }
  });
} finally {
  await rm(keeperRoot, { recursive: true, force: true });
}
console.error("Installed AEID late-failure rollback and committed signing/reopen passed.");

const signedBytes = new TextEncoder().encode("installed CESR crypto and TCP qualification");
const signer = Signer.random();
const signature = signer.sign(signedBytes);
assert(signer.verfer.verify(signature.raw, signedBytes), "installed signer/verifier failed");
const altered = signedBytes.slice();
altered[0] ^= 1;
assert(!signer.verfer.verify(signature.raw, altered), "installed verifier accepted altered bytes");
console.error("Installed CESR signing and tamper-refusal checks passed.");

// Exercise the installed factories against a real listener, preserving signed bodies and opaque PUT bytes.
const httpRequests = [];
const httpServer = createHttpServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  httpRequests.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  res.writeHead(204);
  res.end();
});
await new Promise((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(0, "127.0.0.1", resolve);
});
try {
  await run(function*() {
    const hby = yield* runtime.createHabery({ name: "installed-messengers", temp: true, skipConfig: true });
    try {
      const sender = hby.makeHab("sender");
      sender.interact();
      const parts = [...hby.db.clonePreIter(sender.pre)];
      assert(parts.length === 2, "installed factory fixture lacks its two accepted KEL events");
      const wire = Buffer.concat(parts.map(part => Buffer.from(part)));
      const urls = { http: `http://127.0.0.1:${httpServer.address().port}/inbox` };
      const http = new runtime.FetchHttpClient();
      const headers = { Authorization: "installed-factory" };
      const ordinary = runtime.messengerFrom(sender.pre, urls, http, runtime.systemClock, headers);
      assert(ordinary instanceof runtime.HTTPMessenger, "installed ordinary factory selected the wrong class");
      assert((yield* ordinary.send(wire, { signal: AbortSignal.timeout(5000) })).kind === "complete", "installed POST refused");
      const stream = runtime.streamMessengerFrom(sender.pre, urls, wire, http, runtime.systemClock, headers);
      assert(stream instanceof runtime.HTTPStreamMessenger, "installed stream factory selected the wrong class");
      assert((yield* stream.send({ signal: AbortSignal.timeout(5000) })).status === 204, "installed PUT refused");
      assert(httpRequests.map(req => req.method).join(",") === "POST,POST,PUT", "installed factory changed request count/order");
      for (const req of httpRequests) {
        assert(req.path === "/inbox", "installed factory lost the endpoint path");
        assert(req.headers["cesr-destination"] === sender.pre, "installed factory lost destination");
        assert(req.headers.authorization === "installed-factory", "installed factory lost authorization");
      }
      for (let i = 0; i < 2; i++) {
        const req = httpRequests[i];
        assert(req.headers["cesr-attachment"], "installed POST lost detached proof");
        assert(Buffer.concat([req.body, Buffer.from(req.headers["cesr-attachment"])]).equals(Buffer.from(parts[i])), "installed POST changed signed bytes");
      }
      const put = httpRequests[2];
      assert(!put.headers["cesr-attachment"], "installed PUT retained detached framing");
      assert(Number(put.headers["content-length"]) === wire.length && put.body.equals(wire), "installed PUT changed length/bytes");
    } finally {
      yield* hby.close(true);
    }
  });
} finally {
  await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
}
console.error("Installed ordinary POST and whole-stream PUT factories passed.");

// Exercise the public TCP stream factory; successful transmission is not protocol acceptance.
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
  // Cross the factory writer's 64 KiB chunk boundary without adding a transport knob.
  const wire = Buffer.concat([Buffer.alloc(128 * 1024, 0xa5), signature.qb64b]);
  const [, bytes] = await Promise.all([
    run(() => runtime.streamMessengerFrom("installed-destination", { tcp: `tcp://127.0.0.1:${server.address().port}` }, wire, new runtime.FetchHttpClient(), runtime.systemClock).send({ signal: AbortSignal.timeout(5000) })),
    received,
  ]);
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
