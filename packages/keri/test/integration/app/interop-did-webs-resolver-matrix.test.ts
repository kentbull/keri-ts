// @file-test-lane interop-did-webs

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  createInteropContext,
  DID_WEBS_RESOLVER_INTEROP_COMMIT,
  ensurePinnedDidWebsResolver,
  extractPrefix,
  type InteropContext,
  type KeriPyWitnessNode,
  randomPort,
  requireSuccess,
  runCmdWithTimeout,
  runTufaWithTimeout,
  spawnChild,
  type SpawnedChild,
  startKeriPyWitnessDemoHarness,
  stopChild,
  waitForHealth,
} from "./interop-test-helpers.ts";

const DA_SCHEMA_SAID = "EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5";
const DA_REGISTRY_NAME = "did:webs_designated_aliases";
const DID_PATH = "dws";

interface TufaController {
  readonly name: string;
  readonly alias: string;
  readonly headDirPath: string;
  readonly aid: string;
  readonly witness: KeriPyWitnessNode;
}

interface PythonController {
  readonly name: string;
  readonly base: string;
  readonly alias: string;
  readonly aid: string;
  readonly witness: KeriPyWitnessNode;
}

function siblingCommand(command: string, name: string): string {
  return `${command.slice(0, command.lastIndexOf("/"))}/${name}`;
}

function didFor(port: number, aid: string): string {
  return `did:webs:127.0.0.1%3A${port}:${DID_PATH}:${aid}`;
}

function didKeri(aid: string): string {
  return `did:keri:${aid}`;
}

async function initTufaStore(
  ctx: InteropContext,
  name: string,
  headDirPath: string,
): Promise<void> {
  await requireSuccess(
    `${name} init`,
    runTufaWithTimeout(
      ["init", "--name", name, "--head-dir", headDirPath, "--nopasscode"],
      ctx.env,
      ctx.repoRoot,
      20_000,
    ),
  );
}

async function resolveWitnessesForTufa(
  ctx: InteropContext,
  name: string,
  headDirPath: string,
  witness: KeriPyWitnessNode,
): Promise<void> {
  for (const url of [witness.controllerOobi, witness.witnessOobi]) {
    await requireSuccess(
      `tufa resolve witness ${url}`,
      runTufaWithTimeout(
        [
          "oobi",
          "resolve",
          "--name",
          name,
          "--head-dir",
          headDirPath,
          "--url",
          url,
          "--oobi-alias",
          witness.alias,
        ],
        ctx.env,
        ctx.repoRoot,
        20_000,
      ),
    );
  }
}

async function inceptTufaController(
  ctx: InteropContext,
  witness: KeriPyWitnessNode,
): Promise<TufaController> {
  const headDirPath = await Deno.makeTempDir({ prefix: "did-webs-tufa-" });
  const name = `dws-tufa-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "controller";
  await initTufaStore(ctx, name, headDirPath);
  await resolveWitnessesForTufa(ctx, name, headDirPath, witness);
  const incepted = await requireSuccess(
    "tufa witnessed incept",
    runTufaWithTimeout(
      [
        "incept",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--alias",
        alias,
        "--transferable",
        "--icount",
        "1",
        "--isith",
        "1",
        "--ncount",
        "1",
        "--nsith",
        "1",
        "--toad",
        "1",
        "--receipt-endpoint",
        "--wits",
        witness.pre,
      ],
      ctx.env,
      ctx.repoRoot,
      30_000,
    ),
  );
  return { name, alias, headDirPath, aid: extractPrefix(incepted.stdout), witness };
}

async function bindTufaDesignatedAliases(
  ctx: InteropContext,
  controller: TufaController,
  did: string,
): Promise<void> {
  await requireSuccess(
    "tufa dws bind designated aliases",
    runTufaWithTimeout(
      [
        "dws",
        "bind",
        "--name",
        controller.name,
        "--head-dir",
        controller.headDirPath,
        "--alias",
        controller.alias,
        "--did",
        didKeri(controller.aid),
        "--did",
        did,
      ],
      ctx.env,
      ctx.repoRoot,
      30_000,
    ),
  );
}

async function generateTufaArtifacts(
  ctx: InteropContext,
  controller: TufaController,
  did: string,
  webRoot: string,
): Promise<void> {
  await requireSuccess(
    "tufa dws generate artifacts",
    runTufaWithTimeout(
      [
        "dws",
        "generate",
        "--name",
        controller.name,
        "--head-dir",
        controller.headDirPath,
        "--alias",
        controller.alias,
        "--did",
        did,
        "--output-dir",
        webRoot,
      ],
      ctx.env,
      ctx.repoRoot,
      30_000,
    ),
  );
}

async function startTufaStaticResolver(
  ctx: InteropContext,
  headDirPath: string,
  webRoot: string,
  port: number,
): Promise<SpawnedChild> {
  const name = `dws-static-${crypto.randomUUID().slice(0, 8)}`;
  await initTufaStore(ctx, name, headDirPath);
  const child = spawnChild(
    Deno.execPath(),
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "packages/tufa/mod.ts",
      "dws",
      "resolver",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--port",
      String(port),
      "--listen-host",
      "127.0.0.1",
      "--static-files-dir",
      webRoot,
      "--did-path",
      DID_PATH,
    ],
    ctx.env,
    ctx.repoRoot,
  );
  await waitForHealth(port);
  return child;
}

async function initKliStore(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  config?: { readonly dir: string; readonly file: string },
): Promise<string> {
  const args = ["init", "--name", name, "--base", base, "--nopasscode"];
  if (config) {
    args.push("--config-dir", config.dir, "--config-file", config.file);
  }
  const initialized = await requireSuccess(
    `${name} init`,
    runCmdWithTimeout(
      kliCommand,
      args,
      env,
      config ? 60_000 : 20_000,
    ),
  );
  return `${initialized.stdout}\n${initialized.stderr}`;
}

async function inceptPythonController(
  ctx: InteropContext,
  kliCommand: string,
  witness: KeriPyWitnessNode,
  didWebsResolverRoot: string,
): Promise<PythonController> {
  const name = `dws-python-${crypto.randomUUID().slice(0, 8)}`;
  const base = `dws-python-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "controller";
  const initOutput = await initKliStore(kliCommand, ctx.env, name, base, {
    dir: `${didWebsResolverRoot}/local/config/controller`,
    file: "dws-controller",
  });
  assertKliInitLoadedWitnessOobi(initOutput, witness);
  const incepted = await requireSuccess(
    "kli witnessed incept",
    runCmdWithTimeout(
      kliCommand,
      [
        "incept",
        "--name",
        name,
        "--base",
        base,
        "--alias",
        alias,
        "--file",
        `${didWebsResolverRoot}/local/config/controller/incept-with-wan-wit.json`,
      ],
      ctx.env,
      30_000,
    ),
  );
  await requireSuccess(
    "kli witness submit",
    runCmdWithTimeout(
      kliCommand,
      [
        "witness",
        "submit",
        "--name",
        name,
        "--base",
        base,
        "--alias",
        alias,
        "--receipt-endpoint",
      ],
      ctx.env,
      30_000,
    ),
  );
  return { name, base, alias, aid: extractPrefix(incepted.stdout), witness };
}

function assertKliInitLoadedWitnessOobi(
  initOutput: string,
  witness: KeriPyWitnessNode,
): void {
  if (
    !initOutput.includes(witness.controllerOobi)
    || !initOutput.includes("succeeded")
  ) {
    throw new Error(
      `Python controller init did not resolve configured witness controller OOBI before inception.\n`
        + `Expected ${witness.controllerOobi} to succeed.\n`
        + `kli init output:\n${initOutput.trim() || "<empty>"}`,
    );
  }
}

async function issuePythonDesignatedAliases(
  tooling: { readonly root: string; readonly pythonCommand: string },
  kliCommand: string,
  env: Record<string, string>,
  controller: PythonController,
  did: string,
): Promise<void> {
  await requireSuccess(
    "pin Python DA schema resource",
    runCmdWithTimeout(
      tooling.pythonCommand,
      [
        "-c",
        [
          "import sys",
          "from dws.core import habs, schemaing",
          "name, base = sys.argv[1], sys.argv[2]",
          "hby, _ = habs.get_habery_and_doer(name, base, None, None)",
          "try:",
          "    schemaing.pin_designated_aliases_schema(hby)",
          "finally:",
          "    hby.close(clear=False)",
        ].join("\n"),
        controller.name,
        controller.base,
      ],
      env,
      20_000,
    ),
  );
  await assertPythonWitnessEndpointKnown(kliCommand, env, controller);
  await requireSuccess(
    "kli DA registry incept",
    runCmdWithTimeout(
      kliCommand,
      [
        "vc",
        "registry",
        "incept",
        "--name",
        controller.name,
        "--base",
        controller.base,
        "--alias",
        controller.alias,
        "--registry-name",
        DA_REGISTRY_NAME,
      ],
      env,
      45_000,
    ),
  );
  await submitPythonWitnessReceipts(kliCommand, env, controller);

  const dataPath = await Deno.makeTempFile({ prefix: "did-webs-da-", suffix: ".json" });
  const time = await requireSuccess(
    "kli time",
    runCmdWithTimeout(kliCommand, ["time"], env, 10_000),
  );
  const ids = [didKeri(controller.aid), did].sort();
  await Deno.writeTextFile(
    dataPath,
    `${
      JSON.stringify(
        {
          d: "",
          dt: time.stdout.trim(),
          ids,
        },
        null,
        2,
      )
    }\n`,
  );
  await requireSuccess(
    "kli saidify DA data",
    runCmdWithTimeout(kliCommand, ["saidify", "--file", dataPath], env, 20_000),
  );
  await requireSuccess(
    "kli DA credential create",
    runCmdWithTimeout(
      kliCommand,
      [
        "vc",
        "create",
        "--name",
        controller.name,
        "--base",
        controller.base,
        "--alias",
        controller.alias,
        "--registry-name",
        DA_REGISTRY_NAME,
        "--schema",
        DA_SCHEMA_SAID,
        "--data",
        `@${dataPath}`,
        "--rules",
        `@${tooling.root}/local/schema/rules/desig-aliases-public-schema-rules.json`,
      ],
      env,
      60_000,
    ),
  );
  await submitPythonWitnessReceipts(kliCommand, env, controller);
  await Deno.remove(dataPath).catch(() => undefined);
}

async function assertPythonWitnessEndpointKnown(
  kliCommand: string,
  env: Record<string, string>,
  controller: PythonController,
): Promise<void> {
  const listed = await requireSuccess(
    "kli list witness endpoints",
    runCmdWithTimeout(
      kliCommand,
      [
        "ends",
        "list",
        "--name",
        controller.name,
        "--base",
        controller.base,
        "--alias",
        controller.alias,
        "--aid",
        controller.witness.pre,
      ],
      env,
      10_000,
    ),
  );
  const output = `${listed.stdout}\n${listed.stderr}`.trim();
  if (!output.includes("http") || !output.includes(String(controller.witness.httpPort))) {
    throw new Error(
      `Python controller store is missing witness endpoint material for ${controller.witness.pre}.\n`
        + `Expected HTTP endpoint on port ${controller.witness.httpPort} before DA registry inception.\n`
        + `kli ends list output:\n${output || "<empty>"}`,
    );
  }
}

async function submitPythonWitnessReceipts(
  kliCommand: string,
  env: Record<string, string>,
  controller: PythonController,
): Promise<void> {
  await requireSuccess(
    "kli witness submit",
    runCmdWithTimeout(
      kliCommand,
      [
        "witness",
        "submit",
        "--name",
        controller.name,
        "--base",
        controller.base,
        "--alias",
        controller.alias,
        "--receipt-endpoint",
      ],
      env,
      30_000,
    ),
  );
}

async function generatePythonArtifacts(
  dwsCommand: string,
  env: Record<string, string>,
  controller: PythonController,
  did: string,
  webRoot: string,
): Promise<void> {
  await requireSuccess(
    "python dws generate artifacts",
    runCmdWithTimeout(
      dwsCommand,
      [
        "did",
        "webs",
        "generate",
        "--name",
        controller.name,
        "--base",
        controller.base,
        "--did",
        did,
        "--output-dir",
        `${webRoot}/${DID_PATH}`,
      ],
      env,
      60_000,
    ),
  );
}

async function assertTufaResolvesDidWebs(
  ctx: InteropContext,
  did: string,
): Promise<void> {
  const headDirPath = await Deno.makeTempDir({ prefix: "did-webs-tufa-resolver-" });
  const name = `dws-tufa-resolver-${crypto.randomUUID().slice(0, 8)}`;
  await initTufaStore(ctx, name, headDirPath);
  const resolved = await requireSuccess(
    "tufa dws resolve",
    runTufaWithTimeout(
      ["dws", "resolve", "--name", name, "--head-dir", headDirPath, "--did", did],
      ctx.env,
      ctx.repoRoot,
      60_000,
    ),
  );
  assertStringIncludes(resolved.stdout, `"id": "${did}"`);
}

async function assertPythonResolvesDidWebs(
  dwsCommand: string,
  kliCommand: string,
  env: Record<string, string>,
  did: string,
): Promise<void> {
  const name = `dws-python-resolver-${crypto.randomUUID().slice(0, 8)}`;
  const base = `dws-python-resolver-${crypto.randomUUID().slice(0, 8)}`;
  await initKliStore(kliCommand, env, name, base);
  const resolved = await requireSuccess(
    "python dws resolve",
    runCmdWithTimeout(
      dwsCommand,
      ["did", "webs", "resolve", "--name", name, "--base", base, "--did", did, "--verbose"],
      env,
      60_000,
    ),
  );
  assertStringIncludes(resolved.stdout, `did:webs verification success for ${did}`);
}

async function assertPythonResolvesDidKeri(
  dwsCommand: string,
  kliCommand: string,
  env: Record<string, string>,
  did: string,
  oobi: string,
): Promise<void> {
  const name = `dws-python-dkr-${crypto.randomUUID().slice(0, 8)}`;
  const base = `dws-python-dkr-${crypto.randomUUID().slice(0, 8)}`;
  await initKliStore(kliCommand, env, name, base);
  const resolved = await requireSuccess(
    "python dws did:keri resolve",
    runCmdWithTimeout(
      dwsCommand,
      ["did", "keri", "resolve", "--name", name, "--base", base, "--did", did, "--oobi", oobi, "--verbose"],
      env,
      60_000,
    ),
  );
  assertStringIncludes(resolved.stdout, `did:keri verification success for ${did}`);
}

async function assertTufaResolvesDidKeri(
  ctx: InteropContext,
  did: string,
  oobi: string,
): Promise<void> {
  const headDirPath = await Deno.makeTempDir({ prefix: "did-keri-tufa-resolver-" });
  const name = `dkr-tufa-resolver-${crypto.randomUUID().slice(0, 8)}`;
  await initTufaStore(ctx, name, headDirPath);
  const resolved = await requireSuccess(
    "tufa dkr resolve",
    runTufaWithTimeout(
      ["dkr", "resolve", "--name", name, "--head-dir", headDirPath, "--did", did, "--oobi", oobi],
      ctx.env,
      ctx.repoRoot,
      60_000,
    ),
  );
  assertStringIncludes(resolved.stdout, `"id": "${did}"`);
}

Deno.test("interop/did-webs-resolver - Tufa-generated witnessed did:webs artifacts resolve with Python did-webs-resolver", async () => {
  const ctx = await createInteropContext();
  const tooling = await ensurePinnedDidWebsResolver(ctx.env);
  const pyKli = siblingCommand(tooling.dwsCommand, "kli");
  const harness = await startKeriPyWitnessDemoHarness(ctx, {
    kliCommand: pyKli,
    useBase: false,
  });
  let staticServer: SpawnedChild | undefined;
  try {
    const controller = await inceptTufaController(ctx, harness.node("wan"));
    const port = randomPort();
    const webRoot = await Deno.makeTempDir({ prefix: "did-webs-tufa-web-" });
    const did = didFor(port, controller.aid);
    await bindTufaDesignatedAliases(ctx, controller, did);
    await generateTufaArtifacts(ctx, controller, did, webRoot);
    staticServer = await startTufaStaticResolver(ctx, controller.headDirPath, webRoot, port);
    await assertPythonResolvesDidWebs(tooling.dwsCommand, pyKli, ctx.env, did);
  } finally {
    if (staticServer) {
      await stopChild(staticServer);
    }
    await harness.close();
  }
});

Deno.test("interop/did-webs-resolver - Python-generated witnessed did:webs artifacts resolve with Tufa", async () => {
  const ctx = await createInteropContext();
  const tooling = await ensurePinnedDidWebsResolver(ctx.env);
  const pyKli = siblingCommand(tooling.dwsCommand, "kli");
  const harness = await startKeriPyWitnessDemoHarness(ctx, {
    kliCommand: pyKli,
    useBase: false,
  });
  let staticServer: SpawnedChild | undefined;
  try {
    const controller = await inceptPythonController(ctx, pyKli, harness.node("wan"), tooling.root);
    const port = randomPort();
    const webRoot = await Deno.makeTempDir({ prefix: "did-webs-python-web-" });
    const did = didFor(port, controller.aid);
    await issuePythonDesignatedAliases(tooling, pyKli, ctx.env, controller, did);
    await generatePythonArtifacts(tooling.dwsCommand, ctx.env, controller, did, webRoot);
    const staticHeadDir = await Deno.makeTempDir({ prefix: "did-webs-python-static-" });
    staticServer = await startTufaStaticResolver(ctx, staticHeadDir, webRoot, port);
    await assertTufaResolvesDidWebs(ctx, did);
  } finally {
    if (staticServer) {
      await stopChild(staticServer);
    }
    await harness.close();
  }
});

Deno.test("interop/did-webs-resolver - Tufa witnessed did:keri AID resolves with Python did-webs-resolver", async () => {
  const ctx = await createInteropContext();
  const tooling = await ensurePinnedDidWebsResolver(ctx.env);
  const pyKli = siblingCommand(tooling.dwsCommand, "kli");
  const harness = await startKeriPyWitnessDemoHarness(ctx, {
    kliCommand: pyKli,
    useBase: false,
  });
  try {
    const controller = await inceptTufaController(ctx, harness.node("wan"));
    await assertPythonResolvesDidKeri(
      tooling.dwsCommand,
      pyKli,
      ctx.env,
      didKeri(controller.aid),
      `http://127.0.0.1:${controller.witness.httpPort}/oobi/${controller.aid}/witness/${controller.witness.pre}`,
    );
  } finally {
    await harness.close();
  }
});

Deno.test("interop/did-webs-resolver - Python witnessed did:keri AID resolves with Tufa", async () => {
  const ctx = await createInteropContext();
  const tooling = await ensurePinnedDidWebsResolver(ctx.env);
  const pyKli = siblingCommand(tooling.dwsCommand, "kli");
  const harness = await startKeriPyWitnessDemoHarness(ctx, {
    kliCommand: pyKli,
    useBase: false,
  });
  try {
    const controller = await inceptPythonController(ctx, pyKli, harness.node("wan"), tooling.root);
    await assertTufaResolvesDidKeri(
      ctx,
      didKeri(controller.aid),
      `http://127.0.0.1:${controller.witness.httpPort}/oobi/${controller.aid}/witness/${controller.witness.pre}`,
    );
  } finally {
    await harness.close();
  }
});

Deno.test("interop/did-webs-resolver - pinned Python resolver SHA is explicit", () => {
  assertEquals(
    DID_WEBS_RESOLVER_INTEROP_COMMIT,
    "8395277f32b37129fa6ef734c9f3902bb6cbbcbc",
  );
});
