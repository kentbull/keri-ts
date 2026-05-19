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
  exports?: Record<string, unknown>;
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

function normalizeBuiltManifest(): void {
  const packageJsonPath = `${OUT_DIR}/package.json`;
  const raw = Deno.readTextFileSync(packageJsonPath);
  const manifest = JSON.parse(raw) as BuiltNpmPackageManifest;
  manifest.name = "@keri-ts/tufa";
  manifest.exports = {
    ".": {
      import: NPM_MAIN_PATH,
      types: NPM_TYPES_PATH,
    },
  };
  Deno.writeTextFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (!Deno.env.has("NPM_CONFIG_IGNORE_SCRIPTS")) {
  Deno.env.set("NPM_CONFIG_IGNORE_SCRIPTS", "true");
}

await emptyDir(OUT_DIR);
const keriPackageVersion = resolveWorkspacePackageVersion("../keri/package.json");
const cesrPackageVersion = resolveWorkspacePackageVersion("../cesr/package.json");
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
      normalizeBuiltManifest();
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

      const binPath = `${OUT_DIR}/${NPM_BIN_PATH.replace(/^\.\//, "")}`;
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
