/**
 * Build the `cesr-ts` npm package with DNT and normalize generated metadata.
 *
 * DNT accepts placeholder package paths before it knows the final emitted tree.
 * After DNT finishes, this script re-discovers the generated root module,
 * declaration module, and package-level CLI executable by marker comments, then
 * rewrites package.json so the packed tarball points at files that actually
 * exist.
 */
import { build, emptyDir } from "@deno/dnt";
import {
  assertPackagePathExists,
  findGeneratedEntrypoint,
  prependShebangIfMissing,
  readPackageVersionSync,
  writeJsonFileSync,
} from "../../../scripts/npm/dnt-helpers.ts";

const ENTRYPOINT = "./mod.ts";
const NODE_CLI_ENTRYPOINT = "./src/cli/node.ts";
const OUT_DIR = "./npm";
const NPM_MAIN_PATH = "./esm/mod.js";
const NPM_TYPES_PATH = "./types/mod.d.ts";
const NPM_BIN_PATH = "./esm/src/cli/node.js";

/** Manifest fields that this build script owns after DNT emits package.json. */
interface BuiltNpmPackageManifest {
  main?: string;
  module?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
}

// These marker comments live in source entrypoints and should survive DNT
// rewriting. They make generated target discovery resilient to path-depth drift.
const ROOT_ENTRYPOINT_MARKER = "cesr-ts npm package root entrypoint.";
const BIN_ENTRYPOINT_MARKER = "npm executable entrypoint for the package-level `cesr` CLI.";

/** Resolve this package version from package.json or a release override. */
function resolvePackageVersion(): string {
  return readPackageVersionSync("./package.json", { envOverride: "CESR_NPM_VERSION" });
}

/**
 * Rewrite DNT's placeholder package manifest to generated output facts.
 *
 * The initial package block below gives DNT enough metadata to build. The final
 * artifact must instead use the paths DNT actually emitted, because DNT can add
 * source-directory segments when entrypoints or imports move. This function
 * normalizes:
 *
 * - `main` and `module` to the discovered ESM root entrypoint
 * - `types` to the discovered declaration root entrypoint
 * - `exports["."]` to the same root import/types pair
 * - `bin["cesr"]` to the discovered package-level CLI file without a leading
 *   `./`
 *
 * Each normalized target is asserted before package.json is written so broken
 * manifest paths fail during build rather than during publish or smoke tests.
 */
function normalizeBuiltManifest(): string {
  const packageJsonPath = `${OUT_DIR}/package.json`;
  const raw = Deno.readTextFileSync(packageJsonPath);
  const manifest = JSON.parse(raw) as BuiltNpmPackageManifest;
  const rootImport = findGeneratedEntrypoint({
    root: `${OUT_DIR}/esm`,
    outDir: OUT_DIR,
    fileName: "mod.js",
    marker: ROOT_ENTRYPOINT_MARKER,
  });
  const rootTypes = findGeneratedEntrypoint({
    root: `${OUT_DIR}/types`,
    outDir: OUT_DIR,
    fileName: "mod.d.ts",
    marker: ROOT_ENTRYPOINT_MARKER,
  });
  const bin = findGeneratedEntrypoint({
    root: `${OUT_DIR}/esm`,
    outDir: OUT_DIR,
    fileName: "node.js",
    marker: BIN_ENTRYPOINT_MARKER,
  });

  assertPackagePathExists(OUT_DIR, rootImport);
  assertPackagePathExists(OUT_DIR, rootTypes);
  assertPackagePathExists(OUT_DIR, bin);

  manifest.main = rootImport;
  manifest.module = rootImport;
  manifest.types = rootTypes;
  manifest.exports = {
    ".": {
      import: rootImport,
      types: rootTypes,
    },
  };
  manifest.bin = {
    cesr: toNpmBinPath(bin),
  };
  writeJsonFileSync(packageJsonPath, manifest);
  return bin;
}

/**
 * Convert a DNT-discovered manifest path into npm `bin` path syntax.
 *
 * The discovery helper returns package targets in the same `./esm/...` shape
 * used by `main`, `module`, `types`, and `exports`. npm `bin` entries are
 * package-relative executable paths, so the leading `./` marker is noise there.
 * The regex intentionally strips only that first marker and leaves every real
 * generated path segment untouched.
 */
function toNpmBinPath(path: string): string {
  return path.replace(/^\.\//, "");
}

await emptyDir(OUT_DIR);

await build({
  entryPoints: [ENTRYPOINT, NODE_CLI_ENTRYPOINT],
  outDir: OUT_DIR,
  shims: {
    deno: false,
  },
  typeCheck: false,
  test: false,
  skipNpmInstall: true,
  declaration: "separate",
  scriptModule: false,
  package: {
    name: "cesr-ts",
    version: resolvePackageVersion(),
    description: "CESR parser, primitives, and annotation tooling for TypeScript/JavaScript",
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/kentbull/keri-ts.git",
      directory: "packages/cesr",
    },
    bugs: {
      url: "https://github.com/kentbull/keri-ts/issues",
    },
    homepage: "https://github.com/kentbull/keri-ts/tree/main/packages/cesr",
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
      cesr: NPM_BIN_PATH,
    },
    files: ["esm", "types", "README.md", "LICENSE"],
    dependencies: {
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
  compilerOptions: {
    lib: ["ES2022", "DOM"],
  },
  postBuild() {
    const bin = normalizeBuiltManifest();
    Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
    Deno.copyFileSync("../../LICENSE", `${OUT_DIR}/LICENSE`);

    // Convert the package-relative `./...` bin target into an output-directory
    // child path before adding the executable shebang.
    const binPath = `${OUT_DIR}/${toNpmBinPath(bin)}`;
    prependShebangIfMissing(binPath);
  },
});
