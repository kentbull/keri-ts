import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(
  new URL("../../packages/keri/", import.meta.url),
);

const GROUP = Deno.args[0];

if (!GROUP) {
  console.error("Usage: run_keri_test_group.ts <group>");
  Deno.exit(1);
}

const COMMON_ARGS = ["test", "--allow-all", "--unstable-ffi"];
const DB_FAST_ARGS = ["test", "--allow-all"];

const DB_FAST_CORE_FILES = [
  "test/unit/db/core/lmdber-core-parity.test.ts",
  "test/unit/db/core/lmdber-dup.test.ts",
  "test/unit/db/core/lmdber-helpers.test.ts",
  "test/unit/db/core/lmdber-ioset.test.ts",
  "test/unit/db/core/lmdber-lifecycle.test.ts",
  "test/unit/db/core/lmdber-on.test.ts",
  "test/unit/db/core/lmdber-plain.test.ts",
  "test/unit/db/core/path-manager.test.ts",
  "test/unit/db/core/keys.test.ts",
];

const DB_FAST_WRAPPER_FILES = [
  "test/unit/db/basing.test.ts",
  "test/unit/db/escrowing.test.ts",
  "test/unit/db/keeping.test.ts",
  "test/unit/db/koming.test.ts",
  "test/unit/db/subing.test.ts",
];

const APP_LIGHT_FILES = [
  "test/integration/app/main.test.ts",
  "test/integration/app/effection.test.ts",
  "test/integration/app/db-dump.test.ts",
  "test/unit/app/annotate.test.ts",
  "test/unit/app/benchmark.test.ts",
  "test/unit/app/version.test.ts",
  "test/unit/app/configing.test.ts",
];

const APP_STATEFUL_A_FILES = [
  "test/unit/app/cli.test.ts",
  "test/unit/app/incept.test.ts",
  "test/unit/app/habbing.test.ts",
];

const APP_STATEFUL_B_FILES = [
  "test/unit/app/list-aid.test.ts",
  "test/unit/app/export.test.ts",
  "test/unit/app/compat-list-aid.test.ts",
];

function childEnv(): Record<string, string> {
  const keep = [
    "CI",
    "DENO_DIR",
    "DENO_JOBS",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "NO_COLOR",
    "PATH",
    "RUST_BACKTRACE",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
  ];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = Deno.env.get(key);
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

async function runDeno(args: string[], label: string): Promise<void> {
  console.log(label);
  const child = new Deno.Command(Deno.execPath(), {
    args,
    clearEnv: true,
    cwd: PACKAGE_DIR,
    env: childEnv(),
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  if (!status.success) {
    Deno.exit(status.code);
  }
}

async function runParallelGroup(
  argsBase: string[],
  files: string[],
  label: string,
): Promise<void> {
  await runDeno([...argsBase, "--parallel", ...files], label);
}

async function runIsolatedFiles(
  argsBase: string[],
  files: string[],
  labelPrefix: string,
): Promise<void> {
  for (const file of files) {
    await runDeno([...argsBase, file], `${labelPrefix}${file}`);
  }
}

async function runDbFastGroups(): Promise<void> {
  console.log("==> Running db-fast core group");
  await runIsolatedFiles(
    DB_FAST_ARGS,
    DB_FAST_CORE_FILES,
    "==> Running db-fast isolated file: ",
  );

  console.log("==> Running db-fast wrapper group");
  await runParallelGroup(
    DB_FAST_ARGS,
    DB_FAST_WRAPPER_FILES,
    `==> Running db-fast parallel-safe group: ${DB_FAST_WRAPPER_FILES.join(" ")}`,
  );
}

async function runQualityGroups(): Promise<void> {
  await runGroup("db-fast");
  await runGroup("app-light");
  await runGroup("app-stateful-a");
  await runGroup("app-stateful-b");
  await runGroup("interop-parity");
  await runGroup("interop-gates-b");
  await runGroup("interop-gates-c");
}

async function runGroup(group: string): Promise<void> {
  switch (group) {
    case "db-fast":
      await runDbFastGroups();
      return;
    case "app-light":
      await runIsolatedFiles(
        COMMON_ARGS,
        APP_LIGHT_FILES,
        "==> Running isolated file: ",
      );
      return;
    case "app-stateful-a":
      await runIsolatedFiles(
        COMMON_ARGS,
        APP_STATEFUL_A_FILES,
        "==> Running isolated file: ",
      );
      return;
    case "app-stateful-b":
      await runIsolatedFiles(
        COMMON_ARGS,
        APP_STATEFUL_B_FILES,
        "==> Running isolated file: ",
      );
      return;
    case "interop-parity":
      await runIsolatedFiles(
        COMMON_ARGS,
        ["test/integration/app/interop-kli-tufa.test.ts"],
        "==> Running isolated file: ",
      );
      return;
    case "interop-gates-b":
      await runDeno(
        [
          ...COMMON_ARGS,
          "--filter",
          "Interop gate harness ready scenario: B-",
          "test/integration/app/interop-gates-harness.test.ts",
        ],
        "==> Running interop gate scenarios for Gate B",
      );
      return;
    case "interop-gates-c":
      await runDeno(
        [
          ...COMMON_ARGS,
          "--filter",
          "Interop gate harness matrix covers Gate A-G",
          "test/integration/app/interop-gates-harness.test.ts",
        ],
        "==> Running interop gate scenarios for Gate C and matrix coverage",
      );
      await runDeno(
        [
          ...COMMON_ARGS,
          "--filter",
          "Interop gate harness ready scenario: C-KLI-COMPAT-STORE-OPEN",
          "test/integration/app/interop-gates-harness.test.ts",
        ],
        "==> Running interop gate scenario C-KLI-COMPAT-STORE-OPEN",
      );
      return;
    case "server":
      await runIsolatedFiles(
        COMMON_ARGS,
        ["test/integration/app/server.test.ts"],
        "==> Running isolated file: ",
      );
      return;
    case "quality":
      await runQualityGroups();
      return;
    case "full":
      await runQualityGroups();
      await runGroup("server");
      return;
    default:
      console.error(`Unknown keri test group: ${group}`);
      Deno.exit(1);
  }
}

await runGroup(GROUP);
