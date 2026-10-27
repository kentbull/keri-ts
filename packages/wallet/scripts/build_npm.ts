/** Build wallet inventory on public protocol package dependencies. */
import { build, emptyDir } from "@deno/dnt";
import {
  assertPackagePathExists,
  findGeneratedEntrypoint,
  listFilesSync,
  readPackageVersionSync,
  removeIfExistsSync,
  setIgnoreScriptsDefault,
  writeJsonFileSync,
} from "../../../scripts/npm/dnt-helpers.ts";

const OUT_DIR = "./npm";
const ROOT_MARKER = "Wallet application entrypoint; public protocol owners remain borrowed from keri-ts.";
const keriVersion = readPackageVersionSync("../keri/package.json");
const cesrVersion = readPackageVersionSync("../cesr/package.json");

setIgnoreScriptsDefault();
await emptyDir(OUT_DIR);
await build({
  entryPoints: ["./mod.ts"],
  outDir: OUT_DIR,
  shims: { deno: true },
  configFile: new URL("../deno.json", import.meta.url).href,
  mappings: {
    "../keri/runtime.ts": { name: "keri-ts", version: keriVersion, subPath: "runtime" },
    "../keri/db.ts": { name: "keri-ts", version: keriVersion, subPath: "db" },
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
    exports: { ".": { types: "./types/mod.d.ts", import: "./esm/mod.js" } },
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
    assertPackagePathExists(OUT_DIR, rootImport);
    assertPackagePathExists(OUT_DIR, rootTypes);
    const path = `${OUT_DIR}/package.json`;
    const manifest = JSON.parse(Deno.readTextFileSync(path));
    manifest.main = manifest.module = rootImport;
    manifest.types = rootTypes;
    manifest.exports = { ".": { types: rootTypes, import: rootImport } };
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
