import { build, emptyDir } from "@deno/dnt";

const ENTRYPOINT = "./mod.ts";
const NODE_CLI_ENTRYPOINT = "./src/annotate/cli-node.ts";
const OUT_DIR = "./npm";

interface PackageManifest {
  version?: string;
}

function resolvePackageVersion(): string {
  const fromEnv = Deno.env.get("CESR_NPM_VERSION");
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

await emptyDir(OUT_DIR);

await build({
  entryPoints: [ENTRYPOINT, NODE_CLI_ENTRYPOINT],
  outDir: OUT_DIR,
  shims: {
    deno: false,
  },
  typeCheck: false,
  test: false,
  declaration: "separate",
  scriptModule: false,
  package: {
    name: "cesr-ts",
    version: resolvePackageVersion(),
    description:
      "CESR parser, primitives, and annotation tooling for TypeScript/JavaScript",
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
    main: "./esm/mod.js",
    module: "./esm/mod.js",
    types: "./types/mod.d.ts",
    exports: {
      ".": {
        import: "./esm/mod.js",
        types: "./types/mod.d.ts",
      },
    },
    bin: {
      "cesr-annotate": "./esm/src/annotate/cli-node.js",
    },
    files: ["esm", "types", "README.md", "LICENSE"],
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
    Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
    Deno.copyFileSync("../../LICENSE", `${OUT_DIR}/LICENSE`);

    const binPath = `${OUT_DIR}/esm/src/annotate/cli-node.js`;
    const current = Deno.readTextFileSync(binPath);
    if (!current.startsWith("#!/usr/bin/env node\n")) {
      Deno.writeTextFileSync(binPath, `#!/usr/bin/env node\n${current}`);
    }
    Deno.chmodSync(binPath, 0o755);
  },
});
