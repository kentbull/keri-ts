/**
 * Build the `@keri-ts/tufa` npm package and normalize its CLI metadata.
 *
 * Tufa publishes both a minimal module surface and the `tufa` executable. DNT
 * output paths can move as imports change, so generated entrypoint marker
 * comments are used to discover package.json targets before packing.
 */
import { build, emptyDir } from "@deno/dnt";
import {
  assertPackagePathExists,
  findGeneratedEntrypoint,
  prependShebangIfMissing,
  readPackageVersionSync,
  removeIfExistsSync,
  setIgnoreScriptsDefault,
  writeDntImportMapSync,
  writeJsonFileSync,
} from "../../../scripts/npm/dnt-helpers.ts";

const ENTRYPOINT = "./src/npm/index.ts";
const NODE_CLI_ENTRYPOINT = "./src/app/cli-node.ts";
const OUT_DIR = "./npm";
const DNT_IMPORT_MAP_PATH = "./.dnt.import-map.json";
const NPM_MAIN_PATH = "./esm/tufa/npm/src/npm/index.js";
const NPM_TYPES_PATH = "./types/npm/index.d.ts";
const NPM_BIN_PATH = "./esm/tufa/npm/src/app/cli-node.js";

/** Manifest fields that this build script owns after DNT emits package.json. */
interface BuiltNpmPackageManifest {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
}

/** Final generated module and executable targets for the Tufa npm package. */
interface TufaNpmTargets {
  root: {
    import: string;
    types: string;
  };
  bin: string;
}

// These marker strings live in source entrypoints and should survive DNT
// rewriting. The CLI marker is its bootstrap expression rather than a comment;
// both markers make generated target discovery resilient to path-depth drift.
const ROOT_ENTRYPOINT_MARKER = "Minimal npm module surface for the `tufa` application package.";
const BIN_ENTRYPOINT_MARKER = "run(() => tufa(argv.slice(2)))";

/** Resolve this package version from its workspace package.json. */
function resolvePackageVersion(): string {
  return readPackageVersionSync("./package.json");
}

/** Resolve an internal dependency version from a sibling workspace package. */
function resolveWorkspacePackageVersion(path: string): string {
  return readPackageVersionSync(path);
}

/**
 * Pin DNT's workspace imports to npm package specifiers for generated output.
 *
 * Tufa depends on public `keri-ts` and `cesr-ts` package surfaces. Without this
 * temporary import map, DNT can follow workspace-local source imports and emit
 * duplicated implementation trees into the Tufa package.
 */
function writeDntImportMap(
  keriVersion: string,
  cesrVersion: string,
): void {
  writeDntImportMapSync(DNT_IMPORT_MAP_PATH, {
    "keri-ts": `npm:keri-ts@${keriVersion}`,
    "keri-ts/cli": `npm:keri-ts@${keriVersion}/cli`,
    "keri-ts/runtime": `npm:keri-ts@${keriVersion}/runtime`,
    "keri-ts/db": `npm:keri-ts@${keriVersion}/db`,
    "cesr-ts": `npm:cesr-ts@${cesrVersion}`,
  });
}

/**
 * Resolve module and CLI executable targets from generated output.
 *
 * The package block below uses placeholder paths to satisfy DNT before build.
 * Final targets come from emitted files that still contain source markers,
 * because generated path depth can change as source imports move.
 */
function resolveGeneratedTargets(): TufaNpmTargets {
  const targets = {
    root: {
      import: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/esm`, outDir: OUT_DIR, fileName: "index.js", marker: ROOT_ENTRYPOINT_MARKER },
      ),
      types: findGeneratedEntrypoint(
        { root: `${OUT_DIR}/types`, outDir: OUT_DIR, fileName: "index.d.ts", marker: ROOT_ENTRYPOINT_MARKER },
      ),
    },
    bin: findGeneratedEntrypoint(
      { root: `${OUT_DIR}/esm`, outDir: OUT_DIR, fileName: "cli-node.js", marker: BIN_ENTRYPOINT_MARKER },
    ),
  };

  assertPackagePathExists(OUT_DIR, targets.root.import);
  assertPackagePathExists(OUT_DIR, targets.root.types);
  assertPackagePathExists(OUT_DIR, targets.bin);

  return targets;
}

/**
 * Rewrite DNT's manifest paths to the generated module and bare bin target.
 *
 * The initial package block below gives DNT enough metadata to build. The final
 * artifact must instead use the paths DNT actually emitted. This function
 * normalizes:
 *
 * - package `name` back to the scoped published name
 * - `main` and `module` to the discovered minimal ESM module surface
 * - `types` to the discovered declaration file for that module surface
 * - `exports["."]` to the same import/types pair
 * - `bin["tufa"]` to the discovered CLI executable without a leading `./`
 *
 * Node package `bin` entries are package-relative paths without a leading
 * `./`, while exports keep `./` targets. Keeping that policy centralized here
 * avoids drift between global installs, Docker smoke tests, and tarball target
 * assertions.
 */
function normalizeBuiltManifest(): TufaNpmTargets {
  const packageJsonPath = `${OUT_DIR}/package.json`;
  const raw = Deno.readTextFileSync(packageJsonPath);
  const manifest = JSON.parse(raw) as BuiltNpmPackageManifest;
  const targets = resolveGeneratedTargets();
  manifest.name = "@keri-ts/tufa";
  manifest.main = targets.root.import;
  manifest.module = targets.root.import;
  manifest.types = targets.root.types;
  manifest.exports = {
    ".": {
      import: targets.root.import,
      types: targets.root.types,
    },
  };
  manifest.bin = {
    // npm `bin` entries are package-relative paths without the leading `./`
    // marker that exports/main/types targets keep.
    tufa: targets.bin.replace(/^\.\//, ""),
  };
  writeJsonFileSync(packageJsonPath, manifest);
  return targets;
}

setIgnoreScriptsDefault();

await emptyDir(OUT_DIR);
const keriPackageVersion = resolveWorkspacePackageVersion(
  "../keri/package.json",
);
const cesrPackageVersion = resolveWorkspacePackageVersion(
  "../cesr/package.json",
);
writeDntImportMap(keriPackageVersion, cesrPackageVersion);

try {
  await build({
    entryPoints: [ENTRYPOINT, NODE_CLI_ENTRYPOINT],
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
      name: "@keri-ts/tufa",
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
        "@deno/shim-deno": "~0.18.0",
        "cesr-ts": cesrPackageVersion,
        "commander": "^10.0.1",
        "effection": "^3.6.0",
        "keri-ts": keriPackageVersion,
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
      const targets = normalizeBuiltManifest();
      // DNT can inline workspace source trees for local imports; published
      // Tufa should depend on npm packages instead of carrying duplicate
      // generated keri/cesr implementation trees. The temporary import map
      // should prevent this, and these removals are a defensive final cleanup.
      removeIfExistsSync(`${OUT_DIR}/esm/keri`, { recursive: true });
      removeIfExistsSync(`${OUT_DIR}/esm/cesr`, { recursive: true });
      Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
      Deno.copyFileSync("../../LICENSE", `${OUT_DIR}/LICENSE`);

      // Convert the package-relative `./...` bin target into an output-directory
      // child path before adding the executable shebang.
      const binPath = `${OUT_DIR}/${targets.bin.replace(/^\.\//, "")}`;
      // DNT emits an ESM file; npm executables still need a shebang and
      // executable mode for global installs and Docker smoke tests.
      prependShebangIfMissing(binPath);
    },
  });
} finally {
  try {
    Deno.removeSync(DNT_IMPORT_MAP_PATH);
  } catch {
    // no-op
  }
}
