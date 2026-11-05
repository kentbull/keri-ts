import { action, type Operation, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { EndpointRoles } from "../../../src/core/roles.ts";
import {
  createScenarioContext,
  extractLastNonEmptyLine,
  extractPrefix,
  inspectHabery,
  promiseOp,
  runCmd,
  runTufa,
  type ScenarioContext,
} from "./interop-keystore-helpers.ts";

/** One subprocess owned by the OOBI bootstrap scenario. */
type SpawnedChild = Deno.ChildProcess;

/**
 * Poll a spawned agent's `/health` endpoint until it is reachable.
 *
 * Boundary note:
 * - this stays promise-based because it only wraps host `fetch()` plus timer
 *   polling and does not itself own any Effection-managed resource
 * - lifecycle-owning helpers such as `startTufaAgent()` adapt it locally at
 *   the subprocess boundary
 */
async function waitForHealth(
  port: number,
  attempts = 40,
): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Keep polling until the process is ready or we time out.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Spawn a raw `tufa agent` child process with piped stdio.
 *
 * This is intentionally the low-level host boundary. It does not own cleanup;
 * higher-level helpers such as `startTufaAgent()` express the subprocess
 * lifecycle inside Effection scopes.
 */
function spawnTufaProcess(
  args: string[],
  ctx: ScenarioContext,
): SpawnedChild {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "packages/tufa/mod.ts",
      ...args,
    ],
    env: ctx.env,
    cwd: ctx.packageRoot,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

/** Write the hosted controller URL consumed by the real agent command. */
async function writeTufaAgentControllerConfig(
  configRoot: string,
  configFile: string,
  alias: string,
  port: number,
): Promise<void> {
  const configDir = `${configRoot}/keri/cf/${configFile}`;
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.writeTextFile(
    `${configDir}/${configFile}.json`,
    `${
      JSON.stringify(
        {
          [alias]: {
            dt: "2026-06-08T00:00:00.000Z",
            curls: [`http://127.0.0.1:${port}/`],
          },
        },
        null,
        2,
      )
    }\n`,
  );
}

/** Best-effort host cleanup for one child stdio stream after shutdown. */
async function cancelChildStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!stream) {
    return;
  }

  try {
    await stream.cancel();
  } catch {
    // Streams may already be closed or fully consumed.
  }
}

/**
 * Perform the actual host-boundary subprocess shutdown and optional output
 * capture.
 *
 * This stays promise-based because Effection cleanup callbacks cannot `yield*`.
 * The public `stopChild()` operation wraps this path when shutdown itself needs
 * to stay inside an Effection task.
 */
async function stopChildNow(
  child: SpawnedChild,
  options: { captureOutput?: boolean } = {},
): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // Child may already be gone.
  }
  await child.status;
  if (options.captureOutput) {
    return await readChildOutput(child);
  }

  await Promise.all([
    cancelChildStream(child.stdout),
    cancelChildStream(child.stderr),
  ]);
  return "";
}

/**
 * Drain any remaining child stdout/stderr into a diagnostic string.
 *
 * This is used only after shutdown or startup failure so the harness can turn
 * opaque subprocess failures into actionable test messages.
 */
async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

/**
 * Stop one spawned child process inside the current Effection task.
 *
 * This is the structured-concurrency facade over the raw subprocess shutdown
 * path. It is intentionally an `Operation` so callers can keep shutdown inside
 * the same task tree that owned the process.
 */
function* stopChild(
  child: SpawnedChild,
  options: { captureOutput?: boolean } = {},
): Operation<string> {
  return yield* action((resolve, reject) => {
    stopChildNow(child, options).then(resolve, reject);
    return () => {};
  });
}

/**
 * Start `tufa agent` inside the current Effection task and wait for readiness.
 *
 * Responsibility split:
 * - this helper owns startup and startup-failure cleanup
 * - longer-lived ownership belongs to `withTufaAgent()`, which keeps the child
 *   alive for a scoped body and `yield* stopChild(...)` in `finally`
 *
 * The startup probe remains ordinary host-boundary async glue; the process is
 * only returned after `/health` is reachable.
 */
function* startTufaAgent(
  ctx: ScenarioContext,
  args: string[],
  port: number,
): Operation<SpawnedChild> {
  const child = spawnTufaProcess(args, ctx);
  try {
    yield* promiseOp(() => waitForHealth(port));
    return child;
  } catch (error) {
    const details = yield* stopChild(child, { captureOutput: true });
    throw new Error(
      `Failed to start tufa agent on port ${port}: ${
        error instanceof Error ? error.message : String(error)
      }\n${details}`,
    );
  }
}

/**
 * Own one started `tufa agent` subprocess for the duration of a scoped body.
 *
 * This is the structured-concurrency helper the harness should prefer when a
 * scenario needs a live protocol host across multiple assertions or CLI steps.
 */
function* withTufaAgent<T>(
  ctx: ScenarioContext,
  args: string[],
  port: number,
  body: (child: SpawnedChild) => Operation<T>,
): Operation<T> {
  const child = yield* startTufaAgent(ctx, args, port);
  try {
    return yield* body(child);
  } finally {
    yield* stopChild(child);
  }
}

/** Resolve both implementations' endpoint advertisements through the hosted runtime. */
async function runOobiBootstrapParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `oobi-bootstrap-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "bootstrap-aid";
  const resolveAlias = "resolved-peer";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const port = 8915;
  const tufaConfigDir = await Deno.makeTempDir({
    prefix: "tufa-oobi-agent-config-",
  });
  const tufaAgentConfig = "interop-aid-agent";
  const url = `http://127.0.0.1:${port}`;
  const kliSourceName = `kli-src-${crypto.randomUUID().slice(0, 8)}`;
  const tufaSourceName = `tufa-src-${crypto.randomUUID().slice(0, 8)}`;
  const kliTargetName = `kli-dst-${crypto.randomUUID().slice(0, 8)}`;
  const tufaTargetName = `tufa-dst-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }
  const kliPre = extractPrefix(kliIncept.stdout);

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }
  const tufaPre = extractPrefix(tufaIncept.stdout);
  assertEquals(tufaPre, kliPre);

  const kliLoc = await runCmd(ctx.kliCommand, [
    "location",
    "add",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--url",
    url,
  ], ctx.env);
  if (kliLoc.code !== 0) {
    throw new Error(
      `kli location add failed: ${kliLoc.stderr}\n${kliLoc.stdout}`,
    );
  }

  const tufaLoc = await runTufa(
    [
      "loc",
      "add",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--url",
      url,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaLoc.code !== 0) {
    throw new Error(
      `tufa loc add failed: ${tufaLoc.stderr}\n${tufaLoc.stdout}`,
    );
  }
  assertEquals(
    extractLastNonEmptyLine(kliLoc.stdout),
    extractLastNonEmptyLine(tufaLoc.stdout),
  );

  const kliEnds = await runCmd(ctx.kliCommand, [
    "ends",
    "add",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--role",
    "mailbox",
    "--eid",
    kliPre,
  ], ctx.env);
  if (kliEnds.code !== 0) {
    throw new Error(
      `kli ends add failed: ${kliEnds.stderr}\n${kliEnds.stdout}`,
    );
  }

  const tufaEnds = await runTufa(
    [
      "ends",
      "add",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--role",
      "mailbox",
      "--eid",
      tufaPre,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaEnds.code !== 0) {
    throw new Error(
      `tufa ends add failed: ${tufaEnds.stderr}\n${tufaEnds.stdout}`,
    );
  }

  await run(() =>
    inspectHabery(
      ctx,
      {
        name: kliSourceName,
        base,
        compat: true,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: passcode,
      },
      (hby) => {
        assertEquals(hby.db.getState(kliPre)?.i, kliPre);
        assertEquals(hby.db.locs.get([kliPre, "http"])?.url, url);
        assertEquals(
          hby.db.ends.get([kliPre, EndpointRoles.mailbox, kliPre])?.allowed,
          true,
        );
      },
    )
  );

  await run(() =>
    inspectHabery(
      ctx,
      {
        name: tufaSourceName,
        base,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: passcode,
      },
      (hby) => {
        assertEquals(hby.db.getState(tufaPre)?.i, tufaPre);
        assertEquals(hby.db.locs.get([tufaPre, "http"])?.url, url);
        assertEquals(
          hby.db.ends.get([tufaPre, EndpointRoles.mailbox, tufaPre])?.allowed,
          true,
        );
      },
    )
  );

  const kliOobi = await runCmd(ctx.kliCommand, [
    "oobi",
    "generate",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--role",
    "mailbox",
  ], ctx.env);
  if (kliOobi.code !== 0) {
    throw new Error(
      `kli oobi generate failed: ${kliOobi.stderr}\n${kliOobi.stdout}`,
    );
  }

  const tufaOobi = await runTufa(
    [
      "oobi",
      "generate",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--role",
      "mailbox",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaOobi.code !== 0) {
    throw new Error(
      `tufa oobi generate failed: ${tufaOobi.stderr}\n${tufaOobi.stdout}`,
    );
  }

  const kliMailboxUrl = extractLastNonEmptyLine(kliOobi.stdout);
  const tufaMailboxUrl = extractLastNonEmptyLine(tufaOobi.stdout);
  assertEquals(tufaMailboxUrl, kliMailboxUrl);
  await writeTufaAgentControllerConfig(
    tufaConfigDir,
    tufaAgentConfig,
    alias,
    port,
  );

  await run(function*(): Operation<void> {
    yield* withTufaAgent(
      ctx,
      [
        "agent",
        "--name",
        tufaSourceName,
        "--base",
        base,
        "--passcode",
        passcode,
        "--port",
        String(port),
        "--config-dir",
        tufaConfigDir,
        "--config-file",
        tufaAgentConfig,
      ],
      port,
      function*() {
        const kliTargetInit = yield* promiseOp(() =>
          runCmd(ctx.kliCommand, [
            "init",
            "--name",
            kliTargetName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--salt",
            salt,
          ], ctx.env)
        );
        if (kliTargetInit.code !== 0) {
          throw new Error(
            `kli target init failed: ${kliTargetInit.stderr}\n${kliTargetInit.stdout}`,
          );
        }

        const tufaTargetInit = yield* promiseOp(() =>
          runTufa(
            [
              "init",
              "--name",
              tufaTargetName,
              "--base",
              base,
              "--passcode",
              passcode,
              "--salt",
              salt,
            ],
            ctx.env,
            ctx.packageRoot,
          )
        );
        if (tufaTargetInit.code !== 0) {
          throw new Error(
            `tufa target init failed: ${tufaTargetInit.stderr}\n${tufaTargetInit.stdout}`,
          );
        }

        const kliResolve = yield* promiseOp(() =>
          runCmd(ctx.kliCommand, [
            "oobi",
            "resolve",
            "--name",
            kliTargetName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--oobi",
            tufaMailboxUrl,
            "--oobi-alias",
            resolveAlias,
          ], ctx.env)
        );
        if (kliResolve.code !== 0) {
          throw new Error(
            `kli oobi resolve failed: ${kliResolve.stderr}\n${kliResolve.stdout}`,
          );
        }

        const tufaResolve = yield* promiseOp(() =>
          runTufa(
            [
              "oobi",
              "resolve",
              "--name",
              tufaTargetName,
              "--base",
              base,
              "--passcode",
              passcode,
              "--url",
              tufaMailboxUrl,
              "--oobi-alias",
              resolveAlias,
            ],
            ctx.env,
            ctx.packageRoot,
          )
        );
        if (tufaResolve.code !== 0) {
          throw new Error(
            `tufa oobi resolve failed: ${tufaResolve.stderr}\n${tufaResolve.stdout}`,
          );
        }

        yield* inspectHabery(
          ctx,
          {
            name: kliTargetName,
            base,
            compat: true,
            readonly: true,
            skipConfig: true,
            skipSignator: true,
            bran: passcode,
          },
          (hby) => {
            assertEquals(hby.db.getState(kliPre)?.i, kliPre);
          },
        );

        yield* inspectHabery(
          ctx,
          {
            name: tufaTargetName,
            base,
            readonly: true,
            skipConfig: true,
            skipSignator: true,
            bran: passcode,
          },
          (hby) => {
            assertEquals(hby.db.getState(tufaPre)?.i, tufaPre);
            assertEquals(hby.db.locs.get([tufaPre, "http"])?.url, url);
            assertEquals(
              hby.db.ends.get([tufaPre, EndpointRoles.mailbox, tufaPre])
                ?.allowed,
              true,
            );
            assertEquals(hby.db.roobi.get(tufaMailboxUrl)?.state, "resolved");
          },
        );
      },
    );
  });
}

Deno.test("interop/endpoint roles and OOBI bootstrap match KERIpy", async () => {
  await runOobiBootstrapParity(await createScenarioContext());
});
