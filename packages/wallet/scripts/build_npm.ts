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
const ROOT_MARKER = "Browser-safe wallet entrypoint: inventory, consent, authoring and disclosure";
const WEB_MARKER = "Browser wallet application entrypoint: the root surface plus";
const LMDB_MARKER = "Node wallet entrypoint: the LMDB-backed inventory factory";
const keriVersion = readPackageVersionSync("../keri/package.json");
const cesrVersion = readPackageVersionSync("../cesr/package.json");

setIgnoreScriptsDefault();
await emptyDir(OUT_DIR);
await build({
  entryPoints: ["./mod.ts", { name: "./web", path: "./web.ts" }, { name: "./lmdb", path: "./lmdb.ts" }],
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
      "./lmdb": { types: "./types/lmdb.d.ts", import: "./esm/lmdb.js" },
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
    const lmdbImport = findGeneratedEntrypoint({
      root: `${OUT_DIR}/esm`,
      outDir: OUT_DIR,
      fileName: "lmdb.js",
      marker: LMDB_MARKER,
    });
    const lmdbTypes = findGeneratedEntrypoint({
      root: `${OUT_DIR}/types`,
      outDir: OUT_DIR,
      fileName: "lmdb.d.ts",
      marker: LMDB_MARKER,
    });
    for (const path of [rootImport, rootTypes, webImport, webTypes, lmdbImport, lmdbTypes]) {
      assertPackagePathExists(OUT_DIR, path);
    }
    // The root and `./web` are browser-safe; only `./lmdb` reaches the native backend and has no browser condition.
    const rootBrowser = emitBrowserEntrypoint(OUT_DIR, rootImport);
    const webBrowser = emitBrowserEntrypoint(OUT_DIR, webImport);
    assertBrowserGraphClean(OUT_DIR, [rootBrowser, webBrowser]);
    const path = `${OUT_DIR}/package.json`;
    const manifest = JSON.parse(Deno.readTextFileSync(path));
    manifest.main = manifest.module = rootImport;
    manifest.types = rootTypes;
    manifest.exports = {
      ".": { types: rootTypes, browser: rootBrowser, import: rootImport },
      "./web": { types: webTypes, browser: webBrowser, import: webImport },
      "./lmdb": { types: lmdbTypes, import: lmdbImport },
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
