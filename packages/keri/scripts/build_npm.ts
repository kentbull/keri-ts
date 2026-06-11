/**
 * Build the `keri-ts` npm package with DNT and normalize generated metadata.
 *
 * DNT may change generated path depth as imports evolve, so this script treats
 * marker comments in the generated entrypoints as the source of truth for npm
 * manifest targets instead of hard-coding the final tree layout.
 */
import { build, emptyDir } from "@deno/dnt";
import {
  assertPackagePathExists,
  findGeneratedEntrypoint,
  readPackageVersionSync,
  setIgnoreScriptsDefault,
  writeDntImportMapSync,
  writeJsonFileSync,
} from "../../../scripts/npm/dnt-helpers.ts";

const ENTRYPOINT = "./src/npm/index.ts";
const CLI_ENTRYPOINT = "./src/npm/cli.ts";
const RUNTIME_ENTRYPOINT = "./src/npm/runtime.ts";
const DB_ENTRYPOINT = "./src/npm/db.ts";
const OUT_DIR = "./npm";
const DNT_IMPORT_MAP_PATH = "./.dnt.import-map.json";
const NPM_MAIN_PATH = "./esm/keri/npm/src/keri/src/npm/index.js";
const NPM_TYPES_PATH = "./types/keri/src/npm/index.d.ts";
const NPM_CLI_PATH = "./esm/keri/npm/src/keri/src/npm/cli.js";
const NPM_CLI_TYPES_PATH = "./types/keri/src/npm/cli.d.ts";
const NPM_RUNTIME_PATH = "./esm/keri/npm/src/keri/src/npm/runtime.js";
const NPM_RUNTIME_TYPES_PATH = "./types/keri/src/npm/runtime.d.ts";
const NPM_DB_PATH = "./esm/keri/npm/src/keri/src/npm/db.js";
const NPM_DB_TYPES_PATH = "./types/keri/src/npm/db.d.ts";

/** Manifest fields that this build script owns after DNT emits package.json. */
interface BuiltNpmPackageManifest {
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, unknown>;
}

/** Package import/types pair for one public npm export surface. */
interface NpmExportTarget {
  import: string;
  types: string;
}

/** Public npm surfaces that `keri-ts` promises to keep stable. */
interface NpmExportTargets {
  root: NpmExportTarget;
  cli: NpmExportTarget;
  runtime: NpmExportTarget;
  db: NpmExportTarget;
}

// These marker comments live in source entrypoints and should survive DNT
// rewriting. They make generated target discovery resilient to path-depth drift.
const ENTRYPOINT_MARKERS = {
  root: "npm package root entrypoint.",
  cli: "npm subpath entrypoint for `keri-ts/cli`.",
  runtime: "npm subpath entrypoint for `keri-ts/runtime`.",
  db: "npm subpath entrypoint for `keri-ts/db`.",
} as const;

/**
 * Resolve the version of the package from package.json or the environment variable.
 * @returns The version of the package.
 */
function resolvePackageVersion(): string {
  return readPackageVersionSync("./package.json", { envOverride: "KERI_TS_NPM_VERSION" });
}

/**
 * Resolve the version of the cesr package one directory up from it's package.json.
 * @returns The version of the cesr package.
 */
function resolveCesrPackageVersion(): string {
  return readPackageVersionSync("../cesr/package.json");
}

/**
 * CESR package dependency range of + 1 minor version.
 * @returns The dependency range for the cesr package.
 */
function resolveCesrDependencyRange(): string {
  const version = resolveCesrPackageVersion();
  // Capture the numeric major/minor/patch prefix so prerelease suffixes do not
  // affect the compatible dependency range.
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
 *
 * DNT otherwise follows local workspace imports and can inline local CESR
 * source into the generated package. The temporary import map forces generated
 * output to depend on the published `cesr-ts` package instead.
 *
 * @param cesrVersion The version of the cesr package to write to the import map.
 */
function writeDntImportMap(cesrVersion: string): void {
  writeDntImportMapSync(DNT_IMPORT_MAP_PATH, {
    "cesr-ts": `npm:cesr-ts@${cesrVersion}`,
  });
}

/**
 * Resolve all npm root and subpath export targets from generated output.
 *
 * The placeholder constants above are only bootstrap values for DNT's package
 * block. The generated files can move when DNT rewrites source paths, so final
 * targets are discovered by searching emitted JS and declaration trees for the
 * stable entrypoint markers.
 */
function resolveGeneratedExportTargets(): NpmExportTargets {
  const targets = {
    root: {
      import: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/esm`, outDir: OUT_DIR, fileName: "index.js", marker: ENTRYPOINT_MARKERS.root },
      ),
      types: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/types`, outDir: OUT_DIR, fileName: "index.d.ts", marker: ENTRYPOINT_MARKERS.root },
      ),
    },
    cli: {
      import: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/esm`, outDir: OUT_DIR, fileName: "cli.js", marker: ENTRYPOINT_MARKERS.cli },
      ),
      types: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/types`, outDir: OUT_DIR, fileName: "cli.d.ts", marker: ENTRYPOINT_MARKERS.cli },
      ),
    },
    runtime: {
      import: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/esm`, outDir: OUT_DIR, fileName: "runtime.js", marker: ENTRYPOINT_MARKERS.runtime },
      ),
      types: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/types`, outDir: OUT_DIR, fileName: "runtime.d.ts", marker: ENTRYPOINT_MARKERS.runtime },
      ),
    },
    db: {
      import: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/esm`, outDir: OUT_DIR, fileName: "db.js", marker: ENTRYPOINT_MARKERS.db },
      ),
      types: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/types`, outDir: OUT_DIR, fileName: "db.d.ts", marker: ENTRYPOINT_MARKERS.db },
      ),
    },
  };

  for (const target of Object.values(targets)) {
    assertPackagePathExists(OUT_DIR, target.import);
    assertPackagePathExists(OUT_DIR, target.types);
  }

  return targets;
}

/**
 * Rewrite DNT's manifest paths to the discovered generated target paths.
 *
 * The initial package block below gives DNT enough metadata to build. The final
 * artifact must instead use the paths DNT actually emitted. This function
 * normalizes:
 *
 * - `main` and `module` to the discovered root ESM entrypoint
 * - `types` to the discovered root declaration entrypoint
 * - `exports["."]`, `exports["./cli"]`, `exports["./runtime"]`, and
 *   `exports["./db"]` to their discovered import/types pairs
 *
 * These fields are the public npm package surface. Normalizing them here keeps
 * release behavior stable even when source layout changes alter DNT output
 * paths.
 */
function normalizeBuiltManifest(): void {
  const packageJsonPath = `${OUT_DIR}/package.json`;
  const raw = Deno.readTextFileSync(packageJsonPath);
  const manifest = JSON.parse(raw) as BuiltNpmPackageManifest;
  const targets = resolveGeneratedExportTargets();
  manifest.main = targets.root.import;
  manifest.module = targets.root.import;
  manifest.types = targets.root.types;
  manifest.exports = {
    ".": {
      import: targets.root.import,
      types: targets.root.types,
    },
    "./cli": {
      import: targets.cli.import,
      types: targets.cli.types,
    },
    "./runtime": {
      import: targets.runtime.import,
      types: targets.runtime.types,
    },
    "./db": {
      import: targets.db.import,
      types: targets.db.types,
    },
  };
  writeJsonFileSync(packageJsonPath, manifest);
}

// Avoid running native install scripts (for example lmdb build) during packaging.
setIgnoreScriptsDefault();

await emptyDir(OUT_DIR);
const cesrPackageVersion = resolveCesrPackageVersion();
writeDntImportMap(cesrPackageVersion);

// build keri-ts package
try {
  await build({
    entryPoints: [
      ENTRYPOINT,
      CLI_ENTRYPOINT,
      RUNTIME_ENTRYPOINT,
      DB_ENTRYPOINT,
    ],
    outDir: OUT_DIR,
    shims: {
      deno: true,
    },
    importMap: DNT_IMPORT_MAP_PATH,
    typeCheck: false,
    test: false,
    skipNpmInstall: true,
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
        "./cli": {
          import: NPM_CLI_PATH,
          types: NPM_CLI_TYPES_PATH,
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
        "libsodium-wrappers": "0.8.4",
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
      normalizeBuiltManifest();
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
