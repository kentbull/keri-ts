/**
 * Browser bundle gate for the INSTALLED keri-ts and cesr-ts npm packages.
 *
 * The static graph walk in `dnt-helpers.ts` proves no Node-only import is
 * reachable from the `browser` targets. This gate proves it with a real
 * bundler: it bundles a consumer that imports the browser-safe surfaces from
 * `node_modules` with esbuild's browser platform and `browser` condition, then
 * inspects the metafile (not the output text) for Node-only modules.
 *
 * Usage: node check_browser_bundle.mjs [installDir]
 * `installDir` is an npm project with the packed tarballs and `esbuild`
 * installed; it defaults to the current directory.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installDir = resolve(process.argv[2] ?? ".");
const esbuild = await import(pathToFileURL(createRequire(join(installDir, "noop.js")).resolve("esbuild")).href);

/** Real symbols from every browser-safe surface, exported so tree-shaking keeps them. */
const CONSUMER = `
import { Diger } from "cesr-ts";
import { PACKAGE_VERSION } from "keri-ts";
import { createAgentRuntime, FetchHttpClient, openHabery } from "keri-ts/runtime";
import { openOwner, WebStoreOpener } from "keri-ts/db";
import { indexedDbOpener } from "keri-ts/db/indexeddb";
import { openWalletBaser, openWebWallet, Wallet, WalletBaser, WalletDiscloser } from "@keri-ts/wallet/web";
import * as walletRoot from "@keri-ts/wallet";
import { acquireStoreLock, barrierHttpClient, requestPersistentStorage } from "keri-ts/runtime/web";
export const surface = {
  openWalletBaser, openWebWallet, Wallet, WalletBaser, WalletDiscloser, walletRoot,
  Diger, PACKAGE_VERSION, createAgentRuntime, openHabery, openOwner, WebStoreOpener,
  http: new FetchHttpClient(), opener: indexedDbOpener(),
  acquireStoreLock, barrierHttpClient, requestPersistentStorage,
};
`;

/**
 * Text that must not appear in any module a browser entry reaches. dnt rewrites `import.meta` (and `new.target.name`
 * through it) into a call that needs `_dnt.polyfills.js`, which the browser entries never load, so the first
 * construction of an error class threw a TypeError in a browser. Every error names itself with a literal instead.
 */
const FORBIDDEN_TEXT = [[/import-meta-ponyfill/, "dnt import.meta ponyfill call (needs the polyfills a browser entry does not load)"]];

/** Seeded regressions: Node-only subpaths a browser consumer must never reach. */
const REGRESSIONS = [
  {
    name: "a dnt import.meta ponyfill call",
    source: `export const name = globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).name;`,
  },
  { name: "keri-ts/db/lmdb", source: `export * from "keri-ts/db/lmdb";` },
  { name: "keri-ts/runtime/node", source: `export * from "keri-ts/runtime/node";` },
  { name: "@keri-ts/wallet/lmdb", source: `export * from "@keri-ts/wallet/lmdb";` },
];

/**
 * The one tolerated Node import. effection's `main()` runner lazily `import()`s
 * `node:process` for signal handling, and `export *` makes esbuild resolve it even though
 * keri-ts never calls `main`. It is stubbed to an empty module so every OTHER Node import
 * still fails the gate.
 */
const EFFECTION_MAIN = { importer: /node_modules\/effection\/esm\/lib\/main\.js$/, specifier: "node:process" };
const stubEffectionMain = {
  name: "stub-effection-main-node-process",
  setup(build) {
    build.onResolve({ filter: /^node:process$/ }, (args) =>
      EFFECTION_MAIN.importer.test(args.importer) ? { path: args.path, namespace: "stub-effection-main" } : null);
    build.onLoad({ filter: /.*/, namespace: "stub-effection-main" }, () => ({ contents: "export default undefined;" }));
  },
};

const NODE_MODULES = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const FORBIDDEN_INPUT = [
  [/node_modules\/lmdb\//, "lmdb"],
  [/node_modules\/@deno\/shim-deno/, "@deno/shim-deno"],
  // Scoped to our packages: effection's own `_dnt.shims` is an empty globals proxy that only
  // its (stubbed) `main()` runner pulls in, and the real Deno shim is caught by the line above.
  [/node_modules\/(keri-ts|cesr-ts|@keri-ts)\/.*_dnt\.(polyfills|shims)/, "dnt polyfill/shim"],
  [/deno-shim/, "deno-shim"],
  [/^\(disabled\):/, "browser-disabled (stubbed) module"],
];

/** Bundle `source` as a consumer of the installed packages; returns the problems found. */
async function bundle(source, { platform = "browser", conditions = ["browser"], mainFields } = {}) {
  const dir = mkdtempSync(join(installDir, ".browser-gate-"));
  const entry = join(dir, "entry.js");
  writeFileSync(entry, source);
  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      absWorkingDir: installDir,
      bundle: true,
      write: false,
      metafile: true,
      logLevel: "silent",
      platform,
      format: "esm",
      target: "es2022",
      conditions,
      mainFields,
      plugins: [stubEffectionMain],
    });
    const text = result.outputFiles.map((file) => file.text).join("\n");
    const reached = FORBIDDEN_TEXT.filter(([pattern]) => pattern.test(text)).map(([, label]) => `forbidden text in bundle: ${label}`);
    return { problems: [...inspect(result.metafile), ...reached], metafile: result.metafile };
  } catch (error) {
    return { problems: summarize(error.errors ?? [{ text: String(error) }]) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Collapse esbuild's (often hundreds of) errors into a short, attributable summary. */
function summarize(errors) {
  const importers = new Map();
  for (const { location } of errors) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(location?.file ?? "")?.[1] ?? "(consumer)";
    importers.set(pkg, (importers.get(pkg) ?? 0) + 1);
  }
  const unresolved = [...new Set(errors.map((e) => /Could not resolve "(.+)"/.exec(e.text)?.[1] ?? e.text))];
  return [
    `bundle failed with ${errors.length} error(s); first: ${errors[0].text} (${errors[0].location?.file ?? "?"})`,
    `errors by importing package: ${[...importers].map(([pkg, n]) => `${pkg}=${n}`).join(", ")}`,
    `unresolved: ${unresolved.join(", ")}`,
  ];
}

/** Read the metafile for Node-only inputs and unresolved externals. */
function inspect(metafile) {
  const problems = [];
  for (const [input, info] of Object.entries(metafile.inputs)) {
    for (const [pattern, label] of FORBIDDEN_INPUT) {
      if (pattern.test(input)) problems.push(`forbidden ${label} in bundle: ${input}`);
    }
    for (const imp of info.imports) {
      const bare = imp.path.replace(/^node:/, "");
      if (imp.external || NODE_MODULES.has(bare)) problems.push(`external import ${imp.path} from ${input}`);
    }
  }
  return problems;
}

/** Print total size and the largest contributing packages. */
function report(metafile) {
  const bySource = new Map();
  let total = 0;
  for (const output of Object.values(metafile.outputs)) {
    total += output.bytes;
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input)?.[1] ?? "(consumer)";
      bySource.set(pkg, (bySource.get(pkg) ?? 0) + bytesInOutput);
    }
  }
  console.log(`browser bundle size: ${total} bytes (${(total / 1024).toFixed(1)} KiB, unminified)`);
  for (const [pkg, bytes] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(bytes).padStart(9)}  ${pkg}`);
  }
}

const failures = [];

const gate = await bundle(CONSUMER);
if (gate.problems.length > 0) failures.push(["browser bundle", gate.problems]);
else report(gate.metafile);

for (const { name, source } of REGRESSIONS) {
  const seeded = await bundle(source);
  if (seeded.problems.length === 0) failures.push([`self-test: gate did not reject ${name}`, []]);
  else console.log(`self-test ok: gate rejects ${name}:\n${seeded.problems.map((p) => `    ${p}`).join("\n")}`);
}

// Informational: why the `browser` condition is needed. esbuild adds `browser` on its browser
// platform whatever `conditions` says, so the neutral platform is what omits it.
const bare = await bundle(CONSUMER, { platform: "neutral", conditions: [], mainFields: ["module", "main"] });
console.log(`without the browser condition: ${bare.problems.length} problem(s)`);
for (const problem of bare.problems.slice(0, 20)) console.log(`  ${problem}`);

if (failures.length > 0) {
  for (const [title, problems] of failures) console.error(`FAIL ${title}\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("browser bundle gate passed");
