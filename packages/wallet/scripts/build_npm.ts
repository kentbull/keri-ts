/** Build wallet inventory on public protocol package dependencies. */
import { build, emptyDir } from "@deno/dnt";
import {
  assertBrowserGraphClean,
  assertPackagePathExists,
  emitBrowserEntrypoint,
  findGeneratedEntrypoint,
  listFilesSync,
  readPackageVersionSync,
  removeIfExistsSync,
  setIgnoreScriptsDefault,
  writeJsonFileSync,
} from "../../../scripts/npm/dnt-helpers.ts";

const OUT_DIR = "./npm";
const ROOT_MARKER = "Wallet application entrypoint; public protocol owners remain borrowed from keri-ts.";
const WEB_MARKER = "Browser-safe wallet entrypoint: the root surface without LMDB";
const keriVersion = readPackageVersionSync("../keri/package.json");
const cesrVersion = readPackageVersionSync("../cesr/package.json");

setIgnoreScriptsDefault();
await emptyDir(OUT_DIR);
await build({
  entryPoints: ["./mod.ts", { name: "./web", path: "./web.ts" }],
  outDir: OUT_DIR,
  shims: { deno: true },
  configFile: new URL("../deno.json", import.meta.url).href,
  mappings: {
    "../keri/runtime.ts": { name: "keri-ts", version: keriVersion, subPath: "runtime" },
    "../keri/db.ts": { name: "keri-ts", version: keriVersion, subPath: "db" },
    "../keri/db-indexeddb.ts": { name: "keri-ts", version: keriVersion, subPath: "db/indexeddb" },
    "../keri/runtime-web.ts": { name: "keri-ts", version: keriVersion, subPath: "runtime/web" },
    "../keri/db-lmdb.ts": { name: "keri-ts", version: keriVersion, subPath: "db/lmdb" },
    "../cesr/mod.ts": { name: "cesr-ts", version: cesrVersion },
  },
  typeCheck: false,
  test: false,
  skipNpmInstall: true,
  declaration: "separate",
  scriptModule: false,
  package: {
    name: "@keri-ts/wallet",
    version: readPackageVersionSync("./package.json"),
    description: "Explicit local ACDC credential inventory and admission",
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/kentbull/keri-ts.git",
      directory: "packages/wallet",
    },
    type: "module",
    sideEffects: false,
    main: "./esm/mod.js",
    module: "./esm/mod.js",
    types: "./types/mod.d.ts",
    exports: {
      ".": { types: "./types/mod.d.ts", import: "./esm/mod.js" },
      "./web": { types: "./types/web.d.ts", import: "./esm/web.js" },
    },
    files: ["esm", "types", "README.md", "LICENSE"],
    dependencies: {
      "@deno/shim-deno": "~0.18.0",
      "cesr-ts": cesrVersion,
      "keri-ts": keriVersion,
      "effection": "^3.6.0",
    },
    engines: { node: ">=20.3" },
    scripts: { test: "node --version" },
  },
  postBuild() {
    const rootImport = findGeneratedEntrypoint({
      root: `${OUT_DIR}/esm`,
      outDir: OUT_DIR,
      fileName: "mod.js",
      marker: ROOT_MARKER,
    });
    const rootTypes = findGeneratedEntrypoint({
      root: `${OUT_DIR}/types`,
      outDir: OUT_DIR,
      fileName: "mod.d.ts",
      marker: ROOT_MARKER,
    });
    const webImport = findGeneratedEntrypoint({
      root: `${OUT_DIR}/esm`,
      outDir: OUT_DIR,
      fileName: "web.js",
      marker: WEB_MARKER,
    });
    const webTypes = findGeneratedEntrypoint({
      root: `${OUT_DIR}/types`,
      outDir: OUT_DIR,
      fileName: "web.d.ts",
      marker: WEB_MARKER,
    });
    for (const path of [rootImport, rootTypes, webImport, webTypes]) assertPackagePathExists(OUT_DIR, path);
    // Only `./web` is browser-safe: the root reaches LMDB through `createWalletBaser` and has no browser condition.
    const webBrowser = emitBrowserEntrypoint(OUT_DIR, webImport);
    assertBrowserGraphClean(OUT_DIR, [webBrowser]);
    const path = `${OUT_DIR}/package.json`;
    const manifest = JSON.parse(Deno.readTextFileSync(path));
    manifest.main = manifest.module = rootImport;
    manifest.types = rootTypes;
    manifest.exports = {
      ".": { types: rootTypes, import: rootImport },
      "./web": { types: webTypes, browser: webBrowser, import: webImport },
    };
    writeJsonFileSync(path, manifest);
    // DNT can leave unreferenced entrypoint copies for mapped dependencies.
    for (const name of ["keri", "cesr"]) removeIfExistsSync(`${OUT_DIR}/esm/${name}`, { recursive: true });
    const bundled = ["esm", "types"].flatMap(folder => listFilesSync(`${OUT_DIR}/${folder}`))
      .filter(path =>
        ["/keri/src/", "/cesr/src/", "/tufa/src/", "/hosting/src/", "/verifier/src/"].some(part => path.includes(part))
      );
    if (bundled.length) throw new Error(`Wallet package bundles sibling sources: ${bundled.join(", ")}`);
    Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
    Deno.copyFileSync("../../LICENSE", `${OUT_DIR}/LICENSE`);
  },
});
