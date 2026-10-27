/** Verify the installed hosting/verifier public imports and owned cue-store lifecycle. */
import { createRequire } from "node:module";
import * as verifier from "@keri-ts/verifier";
import * as hosting from "@keri-ts/hosting";
import * as wallet from "@keri-ts/wallet";
import { mkdtemp, rm } from "node:fs/promises";
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
const { run } = await import(pathToFileURL(require.resolve("effection")).href);
const root = await mkdtemp(join(tmpdir(), "tufa-verifier-runtime-"));
try {
  await run(function*() {
    const store = yield* verifier.createVerifierCueBaser({ name: "installed", headDirPath: root });
    try {
      if (Object.values(store.getCounts()).some(count => count !== 0)) throw new Error("Fresh verifier store is not empty");
      yield* store.close();
      if (!(yield* store.reopen())) throw new Error("Verifier cue store did not reopen");
      if (Object.values(store.getCounts()).some(count => count !== 0)) throw new Error("Verifier cue store changed on reopen");
    } finally { yield* store.close(true); }
    const inventory = yield* wallet.createWalletBaser({ name: "installed-wallet", headDirPath: root });
    try {
      if (inventory.issued.cntAll() !== 0 || inventory.admitted.cntAll() !== 0) throw new Error("Fresh wallet is not empty");
      yield* inventory.close();
      if (!(yield* inventory.reopen())) throw new Error("Wallet store did not reopen");
      if (inventory.issued.cntAll() !== 0 || inventory.admitted.cntAll() !== 0) throw new Error("Wallet changed on reopen");
    } finally { yield* inventory.close(true); }
  });
} finally { await rm(root, { recursive: true, force: true }); }
console.error("Installed verifier/wallet packages and owned store lifecycles passed.");
