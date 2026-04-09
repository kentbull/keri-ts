import { build, emptyDir } from "@deno/dnt";

const ENTRYPOINT = "./src/npm/index.ts";
const NODE_CLI_ENTRYPOINT = "./src/app/cli-node.ts";
const OUT_DIR = "./npm";
const NPM_MAIN_PATH = "./esm/tufa/src/npm/index.js";
const NPM_TYPES_PATH = "./types/tufa/src/npm/index.d.ts";
const NPM_BIN_PATH = "./esm/tufa/src/app/cli-node.js";

interface PackageManifest {
  version?: string;
}

function resolvePackageVersion(): string {
  const raw = Deno.readTextFileSync("./package.json");
  const pkg = JSON.parse(raw) as PackageManifest;
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error("Missing version in ./package.json");
  }
  return version;
}

if (!Deno.env.has("NPM_CONFIG_IGNORE_SCRIPTS")) {
  Deno.env.set("NPM_CONFIG_IGNORE_SCRIPTS", "true");
}

await emptyDir(OUT_DIR);

await build({
  entryPoints: [ENTRYPOINT, NODE_CLI_ENTRYPOINT],
  outDir: OUT_DIR,
  shims: {
    deno: true,
  },
  typeCheck: false,
  test: false,
  declaration: "separate",
  scriptModule: false,
  package: {
    name: "tufa",
    version: resolvePackageVersion(),
    description: "Trust Utilities for Agents CLI application package",
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/kentbull/keri-ts.git",
      directory: "packages/tufa",
    },
    bugs: {
      url: "https://github.com/kentbull/keri-ts/issues",
    },
    homepage: "https://github.com/kentbull/keri-ts",
    type: "module",
    sideEffects: false,
    main: NPM_MAIN_PATH,
    module: NPM_MAIN_PATH,
    types: NPM_TYPES_PATH,
    exports: {
      ".": {
        import: NPM_MAIN_PATH,
        types: NPM_TYPES_PATH,
      },
    },
    bin: {
      tufa: NPM_BIN_PATH,
    },
    files: ["esm", "types", "README.md", "LICENSE"],
    dependencies: {
      "@msgpack/msgpack": "^3.1.2",
      "@deno/shim-deno": "~0.18.0",
      "cbor-x": "^1.6.0",
      "commander": "^10.0.1",
      "effection": "^3.6.0",
      "libsodium-wrappers": "^0.8.2",
      "lmdb": "^3.4.4",
    },
    devDependencies: {
      "@types/node": "^20.9.0",
    },
    engines: {
      node: ">=18",
    },
    scripts: {
      prepublishOnly: "npm run test",
      test: "node --version",
    },
  },
  postBuild() {
    Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
    Deno.copyFileSync("../../LICENSE", `${OUT_DIR}/LICENSE`);

    const binPath = `${OUT_DIR}/${NPM_BIN_PATH.replace(/^\.\//, "")}`;
    const current = Deno.readTextFileSync(binPath);
    if (!current.startsWith("#!/usr/bin/env node\n")) {
      Deno.writeTextFileSync(binPath, `#!/usr/bin/env node\n${current}`);
    }
    Deno.chmodSync(binPath, 0o755);
  },
});
