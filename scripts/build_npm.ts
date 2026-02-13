import { build, emptyDir } from "@deno/dnt";

const ENTRYPOINT = "./src/npm/index.ts";
const NODE_CLI_ENTRYPOINT = "./src/app/cli/cli-node.ts";
const OUT_DIR = "./npm";

// Avoid running native install scripts (for example lmdb build) during packaging.
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
    name: "keri-ts",
    version: Deno.env.get("KERI_TS_NPM_VERSION") ?? "0.1.0",
    description: "KERI TypeScript package with database primitives and CLI runtime",
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/kentbull/keri-ts.git",
    },
    bugs: {
      url: "https://github.com/kentbull/keri-ts/issues",
    },
    homepage: "https://github.com/kentbull/keri-ts",
    type: "module",
    sideEffects: false,
    main: "./esm/npm/index.js",
    module: "./esm/npm/index.js",
    types: "./types/npm/index.d.ts",
    exports: {
      ".": {
        import: "./esm/npm/index.js",
        types: "./types/npm/index.d.ts",
      },
    },
    bin: {
      kli: "./esm/app/cli/cli-node.js",
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
  postBuild() {
    Deno.copyFileSync("./README.md", `${OUT_DIR}/README.md`);
    Deno.copyFileSync("./LICENSE", `${OUT_DIR}/LICENSE`);

    const binPath = `${OUT_DIR}/esm/app/cli/cli-node.js`;
    const current = Deno.readTextFileSync(binPath);
    if (!current.startsWith("#!/usr/bin/env node\n")) {
      Deno.writeTextFileSync(binPath, `#!/usr/bin/env node\n${current}`);
    }
    Deno.chmodSync(binPath, 0o755);
  },
});
