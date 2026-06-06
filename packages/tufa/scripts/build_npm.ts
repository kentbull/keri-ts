import { build, emptyDir } from "@deno/dnt";

const ENTRYPOINT = "./src/npm/index.ts";
const NODE_CLI_ENTRYPOINT = "./src/app/cli-node.ts";
const OUT_DIR = "./npm";
const DNT_IMPORT_MAP_PATH = "./.dnt.import-map.json";
const NPM_MAIN_PATH = "./esm/tufa/npm/src/npm/index.js";
const NPM_TYPES_PATH = "./types/npm/index.d.ts";
const NPM_BIN_PATH = "./esm/tufa/npm/src/app/cli-node.js";

interface PackageManifest {
  version?: string;
}

interface BuiltNpmPackageManifest {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
}

interface TufaNpmTargets {
  root: {
    import: string;
    types: string;
  };
  bin: string;
}

const ROOT_ENTRYPOINT_MARKER = "Minimal npm module surface for the `tufa` application package.";
const BIN_ENTRYPOINT_MARKER = "run(() => tufa(argv.slice(2)))";

function resolvePackageVersion(): string {
  const raw = Deno.readTextFileSync("./package.json");
  const pkg = JSON.parse(raw) as PackageManifest;
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error("Missing version in ./package.json");
  }
  return version;
}

function resolveWorkspacePackageVersion(path: string): string {
  const raw = Deno.readTextFileSync(path);
  const pkg = JSON.parse(raw) as PackageManifest;
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error(`Missing version in ${path}`);
  }
  return version;
}

function writeDntImportMap(
  keriVersion: string,
  cesrVersion: string,
): void {
  const importMap = {
    imports: {
      "keri-ts": `npm:keri-ts@${keriVersion}`,
      "keri-ts/cli": `npm:keri-ts@${keriVersion}/cli`,
      "keri-ts/runtime": `npm:keri-ts@${keriVersion}/runtime`,
      "keri-ts/db": `npm:keri-ts@${keriVersion}/db`,
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

function resolveGeneratedTargets(): TufaNpmTargets {
  const targets = {
    root: {
      import: findGeneratedEntrypoint(
        `${OUT_DIR}/esm`,
        "index.js",
        ROOT_ENTRYPOINT_MARKER,
      ),
      types: findGeneratedEntrypoint(
        `${OUT_DIR}/types`,
        "index.d.ts",
        ROOT_ENTRYPOINT_MARKER,
      ),
    },
    bin: findGeneratedEntrypoint(
      `${OUT_DIR}/esm`,
      "cli-node.js",
      BIN_ENTRYPOINT_MARKER,
    ),
  };

  assertPackagePathExists(targets.root.import);
  assertPackagePathExists(targets.root.types);
  assertPackagePathExists(targets.bin);

  return targets;
}

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
    tufa: targets.bin,
  };
  Deno.writeTextFileSync(
    packageJsonPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return targets;
}

if (!Deno.env.has("NPM_CONFIG_IGNORE_SCRIPTS")) {
  Deno.env.set("NPM_CONFIG_IGNORE_SCRIPTS", "true");
}

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
      try {
        Deno.removeSync(`${OUT_DIR}/esm/keri`, { recursive: true });
      } catch {
        // no-op
      }
      try {
        Deno.removeSync(`${OUT_DIR}/esm/cesr`, { recursive: true });
      } catch {
        // no-op
      }
      Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
      Deno.copyFileSync("../../LICENSE", `${OUT_DIR}/LICENSE`);

      const binPath = `${OUT_DIR}/${targets.bin.replace(/^\.\//, "")}`;
      const current = Deno.readTextFileSync(binPath);
      if (!current.startsWith("#!/usr/bin/env node\n")) {
        Deno.writeTextFileSync(binPath, `#!/usr/bin/env node\n${current}`);
      }
      Deno.chmodSync(binPath, 0o755);
    },
  });
} finally {
  try {
    Deno.removeSync(DNT_IMPORT_MAP_PATH);
  } catch {
    // no-op
  }
}
