/** Verify the installed Tufa runtime embedding subpath loads and exports its contract. */
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[2] && resolve(process.argv[2]);
if (!packageRoot) throw new Error("Tufa package root is required");

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const runtimeTarget = manifest.exports?.["./runtime"]?.import;
if (typeof runtimeTarget !== "string") throw new Error("@keri-ts/tufa/runtime export is missing");

const runtime = await import(pathToFileURL(join(packageRoot, runtimeTarget)).href);
if (typeof runtime.runHostKernel !== "function") throw new Error("Tufa runtime missing runHostKernel");
if (typeof runtime.createProtocolHandler !== "function") throw new Error("Tufa runtime missing createProtocolHandler");

const kernelTarget = manifest.exports?.["./host/kernel"]?.import;
if (typeof kernelTarget !== "string") throw new Error("Tufa host kernel export is missing");
const kernel = await import(pathToFileURL(join(packageRoot, kernelTarget)).href);
if (typeof kernel.runHostKernel !== "function") throw new Error("Tufa host kernel subpath is missing");
const protocolTarget = manifest.exports?.["./http/protocol-handler"]?.import;
if (typeof protocolTarget !== "string") throw new Error("Tufa protocol handler export is missing");
const protocol = await import(pathToFileURL(join(packageRoot, protocolTarget)).href);
if (typeof protocol.createProtocolHandler !== "function") throw new Error("Tufa protocol handler subpath is missing");

if (typeof runtime.VerifierAgent !== "function") throw new Error("Tufa runtime missing verifier application");
const require = createRequire(join(packageRoot, "package.json"));
const { run } = await import(pathToFileURL(require.resolve("effection")).href);
const root = await mkdtemp(join(tmpdir(), "tufa-verifier-runtime-"));
try {
  await run(function*() {
    const store = yield* runtime.createVerifierCueBaser({ name: "installed", headDirPath: root });
    try {
      if (Object.values(store.getCounts()).some(count => count !== 0)) throw new Error("Fresh verifier store is not empty");
      yield* store.close();
      if (!(yield* store.reopen())) throw new Error("Verifier cue store did not reopen");
      if (Object.values(store.getCounts()).some(count => count !== 0)) throw new Error("Verifier cue store changed on reopen");
    } finally { yield* store.close(true); }
  });
} finally { await rm(root, { recursive: true, force: true }); }
console.error("Installed Tufa verifier runtime and owned cue-store lifecycle passed.");
