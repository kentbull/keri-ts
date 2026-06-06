import { build, emptyDir } from "@deno/dnt";

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

interface PackageManifest {
  version?: string;
}

interface BuiltNpmPackageManifest {
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, unknown>;
}

interface NpmExportTarget {
  import: string;
  types: string;
}

interface NpmExportTargets {
  root: NpmExportTarget;
  cli: NpmExportTarget;
  runtime: NpmExportTarget;
  db: NpmExportTarget;
}

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

function listFilesSync(dir: string): string[] {
  const files: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...listFilesSync(path));
    } else if (entry.isFile) {
      files.push(path);
    }
  }
  return files;
}

function toPackagePath(path: string): string {
  return `./${path.replace(`${OUT_DIR}/`, "")}`;
}

function findGeneratedEntrypoint(
  root: string,
  fileName: string,
  marker: string,
): string {
  const matches = listFilesSync(root).filter((path) => {
    if (!path.endsWith(`/${fileName}`)) {
      return false;
    }
    return Deno.readTextFileSync(path).includes(marker);
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one generated ${fileName} containing ${
        JSON.stringify(marker)
      } under ${root}, found ${matches.length}: ${matches.join(", ")}`,
    );
  }

  return toPackagePath(matches[0]);
}

function assertPackagePathExists(path: string): void {
  const relative = path.replace(/^\.\//, "");
  const fullPath = `${OUT_DIR}/${relative}`;
  const stat = Deno.statSync(fullPath);
  if (!stat.isFile) {
    throw new Error(`Expected npm package path to be a file: ${path}`);
  }
}

function resolveGeneratedExportTargets(): NpmExportTargets {
  const targets = {
    root: {
      import: findGeneratedEntrypoint(
        `${OUT_DIR}/esm`,
        "index.js",
        ENTRYPOINT_MARKERS.root,
      ),
      types: findGeneratedEntrypoint(
        `${OUT_DIR}/types`,
        "index.d.ts",
        ENTRYPOINT_MARKERS.root,
      ),
    },
    cli: {
      import: findGeneratedEntrypoint(
        `${OUT_DIR}/esm`,
        "cli.js",
        ENTRYPOINT_MARKERS.cli,
      ),
      types: findGeneratedEntrypoint(
        `${OUT_DIR}/types`,
        "cli.d.ts",
        ENTRYPOINT_MARKERS.cli,
      ),
    },
    runtime: {
      import: findGeneratedEntrypoint(
        `${OUT_DIR}/esm`,
        "runtime.js",
        ENTRYPOINT_MARKERS.runtime,
      ),
      types: findGeneratedEntrypoint(
        `${OUT_DIR}/types`,
        "runtime.d.ts",
        ENTRYPOINT_MARKERS.runtime,
      ),
    },
    db: {
      import: findGeneratedEntrypoint(
        `${OUT_DIR}/esm`,
        "db.js",
        ENTRYPOINT_MARKERS.db,
      ),
      types: findGeneratedEntrypoint(
        `${OUT_DIR}/types`,
        "db.d.ts",
        ENTRYPOINT_MARKERS.db,
      ),
    },
  };

  for (const target of Object.values(targets)) {
    assertPackagePathExists(target.import);
    assertPackagePathExists(target.types);
  }

  return targets;
}

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
  Deno.writeTextFileSync(
    packageJsonPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
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
