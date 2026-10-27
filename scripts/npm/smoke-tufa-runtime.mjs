/** Verify the installed hosting/verifier public imports and owned cue-store lifecycle. */
import * as hosting from "@keri-ts/hosting";
import { createObservationBaser, Observer } from "@keri-ts/observer";
import { Registrar } from "@keri-ts/registrar";
import * as verifier from "@keri-ts/verifier";
import * as wallet from "@keri-ts/wallet";
import { createAgentRuntime, createHabery, FetchHttpClient, systemClock } from "keri-ts/runtime";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[2] && resolve(process.argv[2]);
if (!packageRoot) throw new Error("Tufa package root is required");

for (const name of ["runHostKernel", "startServer", "createProtocolHandler", "createTufaApp"]) {
  if (typeof hosting[name] !== "function") throw new Error(`Hosting package missing ${name}`);
}

const require = createRequire(join(packageRoot, "package.json"));
if (typeof verifier.VerifierAgent !== "function") throw new Error("Verifier package missing application");
if (typeof wallet.Wallet !== "function") throw new Error("Wallet package missing inventory owner");
const { run, call } = await import(pathToFileURL(require.resolve("effection")).href);
const root = await mkdtemp(join(tmpdir(), "tufa-verifier-runtime-"));
try {
  await run(function*() {
    const store = yield* verifier.createVerifierCueBaser({ name: "installed", headDirPath: root });
    try {
      if (Object.values(store.getCounts()).some(count => count !== 0)) {
        throw new Error("Fresh verifier store is not empty");
      }
      yield* store.close();
      if (!(yield* store.reopen())) throw new Error("Verifier cue store did not reopen");
      if (Object.values(store.getCounts()).some(count => count !== 0)) {
        throw new Error("Verifier cue store changed on reopen");
      }
    } finally {
      yield* store.close(true);
    }
    const hby = yield* createHabery({ name: "installed-registrar", headDirPath: root, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const service = new Registrar(runtime.protocol, runtime.acdc.store);
      const response = yield* call(() => service.handle(new Request("http://localhost/health")));
      if (response.status !== 200) throw new Error("Installed registrar did not handle its public health operation");
      yield* call(() => response.json());
      const records = yield* createObservationBaser({ name: "installed-observer", headDirPath: root });
      try {
        const observer = new Observer(runtime.protocol, runtime.acdc.store, records, {
          sources: [{ url: "https://registrar.example/" }],
          readers: ["reader"],
          maximumAgeMs: 1000,
        });
        const response = yield* call(() => observer.handle(new Request("http://localhost/health")));
        if (response.status !== 200) throw new Error("Installed observer health operation failed");
        yield* call(() => response.json());
        yield* records.close();
        if (!(yield* records.reopen())) throw new Error("Observation store did not reopen");
      } finally {
        yield* records.close(true);
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
    const inventory = yield* wallet.createWalletBaser({ name: "installed-wallet", headDirPath: root });
    try {
      if (inventory.issued.cntAll() !== 0 || inventory.admitted.cntAll() !== 0) {
        throw new Error("Fresh wallet is not empty");
      }
      yield* inventory.close();
      if (!(yield* inventory.reopen())) throw new Error("Wallet store did not reopen");
      if (inventory.issued.cntAll() !== 0 || inventory.admitted.cntAll() !== 0) {
        throw new Error("Wallet changed on reopen");
      }
    } finally {
      yield* inventory.close(true);
    }
  });
} finally {
  await rm(root, { recursive: true, force: true });
}
console.error("Installed verifier/wallet/registrar/observer packages and owned protocol/store lifecycles passed.");
