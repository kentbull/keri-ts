/**
 * Verify installed hosting/verifier/wallet/registrar/observer public imports and owned store lifecycles.
 *
 * Usage: node smoke-tufa-runtime.mjs <package root> [hosting|verifier|wallet|registrar|observer|multisync ...]
 * Copy this file next to the install whose packages it checks (bare imports resolve from there). With no
 * package names it checks the five Tufa depends on, as the Tufa and combined smokes do; a single package's
 * release smoke names only that package, whose install then need not contain the others. Multisync has no
 * owned store, so its check is that its public entry imports.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const all = ["hosting", "verifier", "wallet", "registrar", "observer"];
const known = [...all, "multisync"];
const packageRoot = process.argv[2] && resolve(process.argv[2]);
if (!packageRoot) throw new Error("Package root is required");
const selected = process.argv.length > 3 ? process.argv.slice(3) : all;
const unknown = selected.filter(name => !known.includes(name));
if (unknown.length) throw new Error(`No installed-package probe for ${unknown.join(", ")}`);
const checks = new Set(selected);

if (checks.has("multisync")) await import("@keri-ts/multisync/v2");

if (checks.has("hosting")) {
  const hosting = await import("@keri-ts/hosting");
  for (const name of ["runHostKernel", "startServer", "createProtocolHandler", "createTufaApp"]) {
    if (typeof hosting[name] !== "function") throw new Error(`Hosting package missing ${name}`);
  }
}

const verifier = checks.has("verifier") ? await import("@keri-ts/verifier") : undefined;
if (verifier && typeof verifier.VerifierAgent !== "function") throw new Error("Verifier package missing application");

const wallet = checks.has("wallet") ? await import("@keri-ts/wallet") : undefined;
const walletLmdb = checks.has("wallet") ? await import("@keri-ts/wallet/lmdb") : undefined;
if (wallet) {
  const walletWeb = await import("@keri-ts/wallet/web");
  if (typeof wallet.Wallet !== "function") throw new Error("Wallet package missing inventory owner");
  if (typeof walletLmdb.createWalletBaser !== "function") throw new Error("Wallet lmdb entry lost its LMDB factory");
  if (typeof wallet.openWalletBaser !== "function" || "createWalletBaser" in wallet || "createWalletBaser" in walletWeb) {
    throw new Error("Wallet root and web entries must expose openWalletBaser and no LMDB factory");
  }
  if (typeof walletWeb.openWebWallet !== "function") throw new Error("Wallet web entry lost openWebWallet");
  if (walletWeb.Wallet !== wallet.Wallet || walletWeb.WalletBaser !== wallet.WalletBaser) {
    throw new Error("Wallet web entry must share the root's owner classes");
  }
}

const registrar = checks.has("registrar") ? await import("@keri-ts/registrar") : undefined;
const observer = checks.has("observer") ? await import("@keri-ts/observer") : undefined;
const keri = registrar || observer
  ? { lmdb: await import("keri-ts/db/lmdb"), runtime: await import("keri-ts/runtime") }
  : undefined;

// Store lifecycles run inside effection, resolved from the checked package so they share its instance.
if (verifier || keri || walletLmdb) {
  const require = createRequire(join(packageRoot, "package.json"));
  const { run, call } = await import(pathToFileURL(require.resolve("effection")).href);
  const root = await mkdtemp(join(tmpdir(), "installed-package-runtime-"));
  try {
    await run(function*() {
      if (verifier) {
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
      }
      if (keri) {
        const hby = yield* keri.lmdb.createHabery({ name: "installed-registrar", headDirPath: root, skipConfig: true });
        const runtime = yield* keri.runtime.createAgentRuntime(
          hby,
          new keri.runtime.FetchHttpClient(),
          keri.runtime.systemClock,
        );
        try {
          if (registrar) {
            const service = new registrar.Registrar(runtime.protocol, runtime.acdc.store);
            const response = yield* call(() => service.handle(new Request("http://localhost/health")));
            if (response.status !== 200) throw new Error("Installed registrar did not handle its public health operation");
            yield* call(() => response.json());
          }
          if (observer) {
            const records = yield* observer.createObservationBaser({ name: "installed-observer", headDirPath: root });
            try {
              const service = new observer.Observer(runtime.protocol, runtime.acdc.store, records, {
                sources: [{ url: "https://registrar.example/" }],
                readers: ["reader"],
                maximumAgeMs: 1000,
              });
              const response = yield* call(() => service.handle(new Request("http://localhost/health")));
              if (response.status !== 200) throw new Error("Installed observer health operation failed");
              yield* call(() => response.json());
              yield* records.close();
              if (!(yield* records.reopen())) throw new Error("Observation store did not reopen");
            } finally {
              yield* records.close(true);
            }
          }
        } finally {
          yield* runtime.close();
          yield* hby.close(true);
        }
      }
      if (walletLmdb) {
        const inventory = yield* walletLmdb.createWalletBaser({ name: "installed-wallet", headDirPath: root });
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
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
console.error(`Installed ${selected.join("/")} packages and owned protocol/store lifecycles passed.`);
