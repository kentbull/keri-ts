import { build, emptyDir } from "@deno/dnt";

const ENTRYPOINT = "./src/npm/index.ts";
const RUNTIME_ENTRYPOINT = "./src/npm/runtime.ts";
const DB_ENTRYPOINT = "./src/npm/db.ts";
const OUT_DIR = "./npm";
const DNT_IMPORT_MAP_PATH = "./.dnt.import-map.json";
const NPM_MAIN_PATH = "./esm/keri/src/npm/index.js";
const NPM_TYPES_PATH = "./types/keri/src/npm/index.d.ts";
const NPM_RUNTIME_PATH = "./esm/keri/src/npm/runtime.js";
const NPM_RUNTIME_TYPES_PATH = "./types/keri/src/npm/runtime.d.ts";
const NPM_DB_PATH = "./esm/keri/src/npm/db.js";
const NPM_DB_TYPES_PATH = "./types/keri/src/npm/db.d.ts";

interface PackageManifest {
  version?: string;
}

/**
 * Resolve the version of the package from package.json or the environment variable.
 * @returns The version of the package.
 */
function resolvePackageVersion(): string {
  const fromEnv = Deno.env.get("KERI_TS_NPM_VERSION");
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }

  const raw = Deno.readTextFileSync("./package.json");
  const pkg = JSON.parse(raw) as PackageManifest;
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error("Missing version in ./package.json");
  }

  return version;
}

/**
 * Resolve the version of the cesr package one directory up from it's package.json.
 * @returns The version of the cesr package.
 */
function resolveCesrPackageVersion(): string {
  const raw = Deno.readTextFileSync("../cesr/package.json");
  const pkg = JSON.parse(raw) as PackageManifest;
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error("Missing version in ../cesr/package.json");
  }

  return version;
}

/**
 * CESR package dependency range of + 1 minor version.
 * @returns The dependency range for the cesr package.
 */
function resolveCesrDependencyRange(): string {
  const version = resolveCesrPackageVersion();
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Unsupported cesr-ts version format: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `>=${major}.${minor}.0 <${major}.${minor + 1}.0`;
}

/**
 * Writes CESR version to Deno import map for later consumption during packaging.
 * @param cesrVersion The version of the cesr package to write to the import map.
 */
function writeDntImportMap(cesrVersion: string): void {
  const importMap = {
    imports: {
      "cesr-ts": `npm:cesr-ts@${cesrVersion}`,
    },
  };
  Deno.writeTextFileSync(
    DNT_IMPORT_MAP_PATH,
    `${JSON.stringify(importMap, null, 2)}\n`,
  );
}

// Avoid running native install scripts (for example lmdb build) during packaging.
if (!Deno.env.has("NPM_CONFIG_IGNORE_SCRIPTS")) {
  Deno.env.set("NPM_CONFIG_IGNORE_SCRIPTS", "true");
}

await emptyDir(OUT_DIR);
const cesrPackageVersion = resolveCesrPackageVersion();
writeDntImportMap(cesrPackageVersion);

// build keri-ts package
try {
  await build({
    entryPoints: [ENTRYPOINT, RUNTIME_ENTRYPOINT, DB_ENTRYPOINT],
    outDir: OUT_DIR,
    shims: {
      deno: true,
    },
    importMap: DNT_IMPORT_MAP_PATH,
    typeCheck: false,
    test: false,
    declaration: "separate",
    scriptModule: false,
    package: {
      name: "keri-ts",
      version: resolvePackageVersion(),
      description: "KERI TypeScript protocol and runtime library",
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "git+https://github.com/kentbull/keri-ts.git",
        directory: "packages/keri",
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
        "./runtime": {
          import: NPM_RUNTIME_PATH,
          types: NPM_RUNTIME_TYPES_PATH,
        },
        "./db": {
          import: NPM_DB_PATH,
          types: NPM_DB_TYPES_PATH,
        },
      },
      files: ["esm", "types", "README.md", "LICENSE"],
      dependencies: {
        "@msgpack/msgpack": "^3.1.2",
        "cbor-x": "^1.6.0",
        "cesr-ts": resolveCesrDependencyRange(),
        "libsodium-wrappers": "^0.8.2",
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
    },
  });
} finally {
  try {
    Deno.removeSync(DNT_IMPORT_MAP_PATH);
  } catch {
    // no-op
  }
}
