/** Build the versioned application module without embedding sibling packages. */
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

const outDir = "./npm";
const keriVersion = readPackageVersionSync("../keri/package.json");
const walletVersion = readPackageVersionSync("../wallet/package.json");
setIgnoreScriptsDefault();
await emptyDir(outDir);
await build({
  entryPoints: ["./v2/mod.ts"],
  outDir,
  configFile: new URL("../deno.json", import.meta.url).href,
  mappings: {
    "../keri/runtime.ts": { name: "keri-ts", version: keriVersion, subPath: "runtime" },
    "../wallet/mod.ts": { name: "@keri-ts/wallet", version: walletVersion },
  },
  shims: { deno: false },
  typeCheck: false,
  test: false,
  skipNpmInstall: true,
  declaration: "separate",
  scriptModule: false,
  package: {
    name: "@keri-ts/multisync",
    version: readPackageVersionSync("./package.json"),
    description: "Application-layer multisig synchronization with versioned protocol modules",
    license: "Apache-2.0",
    type: "module",
    sideEffects: false,
    files: ["esm", "types", "LICENSE"],
    dependencies: { "keri-ts": keriVersion, "@keri-ts/wallet": walletVersion },
  },
  postBuild() {
    const marker = "Application-layer v2 multisig synchronization";
    const js = findGeneratedEntrypoint({ root: `${outDir}/esm`, outDir, fileName: "mod.js", marker });
    const types = findGeneratedEntrypoint({ root: `${outDir}/types`, outDir, fileName: "mod.d.ts", marker });
    assertPackagePathExists(outDir, js);
    assertPackagePathExists(outDir, types);
    const path = `${outDir}/package.json`;
    const manifest = JSON.parse(Deno.readTextFileSync(path));
    delete manifest.main;
    delete manifest.module;
    delete manifest.types;
    manifest.exports = { "./v2": { types, import: js } };
    writeJsonFileSync(path, manifest);
    // DNT may emit unused mapped entrypoints; remove those sibling copies.
    for (const name of ["keri", "wallet", "cesr"]) {
      removeIfExistsSync(`${outDir}/esm/${name}`, { recursive: true });
    }
    const bundled = ["esm", "types"].flatMap((folder) => listFilesSync(`${outDir}/${folder}`))
      .filter((path) => ["/keri/src/", "/wallet/src/", "/cesr/src/"].some((part) => path.includes(part)));
    if (bundled.length) throw new Error(`Multisync bundles sibling source: ${bundled.join(", ")}`);
    Deno.copyFileSync("../../LICENSE", `${outDir}/LICENSE`);
  },
});
