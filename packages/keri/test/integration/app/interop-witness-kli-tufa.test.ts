/**
 * Real witness receipting interoperability tests.
 *
 * These scenarios prove witness behavior against explicit KERIpy witnesses
 * instead of relying on all-Tufa witness topologies.
 */
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import {
  createInteropContext,
  extractPrefix,
  inspectCompatHabery,
  requireSuccess,
  runCmd,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
  spawnChild,
  startKeriPyWitnessHarness,
  stopChild,
  waitForHealth,
} from "./interop-test-helpers.ts";

const PASSCODE = "MyPasscodeARealSecret";
const SALT = "0AAwMTIzNDU2Nzg5YWJjZGVm";

interface TufaWitnessHost {
  name: string;
  alias: string;
  pre: string;
  httpPort: number;
  tcpPort: number;
  httpOrigin: string;
  controllerOobi: string;
  witnessOobi: string;
}

/** Initialize one unencrypted Tufa store. */
async function initTufaStore(
  name: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<void> {
  await requireSuccess(
    `${name} init`,
    runTufa(
      [
        "init",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--nopasscode",
      ],
      env,
      repoRoot,
    ),
  );
}

/** Incept one non-transferable Tufa witness identity. */
async function inceptTufaWitnessIdentity(
  name: string,
  alias: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<string> {
  const incepted = await requireSuccess(
    `${name} incept`,
    runTufa(
      [
        "incept",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--alias",
        alias,
        "--icount",
        "1",
        "--isith",
        "1",
        "--toad",
        "0",
      ],
      env,
      repoRoot,
    ),
  );
  return extractPrefix(incepted.stdout);
}

/** Start one long-lived Tufa witness host. */
function startTufaWitnessHost(
  name: string,
  alias: string,
  headDirPath: string,
  httpPort: number,
  tcpPort: number,
  env: Record<string, string>,
  repoRoot: string,
) {
  return spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "witness",
      "start",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--alias",
      alias,
      "--url",
      `http://127.0.0.1:${httpPort}`,
      "--tcp-url",
      `tcp://127.0.0.1:${tcpPort}`,
      "--listen-host",
      "127.0.0.1",
    ],
    env,
    repoRoot,
  );
}

/** Create and start one Tufa witness host. */
async function createStartedTufaWitnessHost(
  name: string,
  alias: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<TufaWitnessHost & { child: ReturnType<typeof spawnChild> }> {
  await initTufaStore(name, headDirPath, env, repoRoot);
  const pre = await inceptTufaWitnessIdentity(name, alias, headDirPath, env, repoRoot);
  const httpPort = 20_000 + Math.floor(Math.random() * 20_000);
  const tcpPort = 20_000 + Math.floor(Math.random() * 20_000);
  const child = startTufaWitnessHost(
    name,
    alias,
    headDirPath,
    httpPort,
    tcpPort,
    env,
    repoRoot,
  );
  await waitForHealth(httpPort);
  return {
    child,
    name,
    alias,
    pre,
    httpPort,
    tcpPort,
    httpOrigin: `http://127.0.0.1:${httpPort}`,
    controllerOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/controller`,
    witnessOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/witness/${pre}`,
  };
}

/** Require the latest establishment event to carry every expected witness receipt. */
function assertFullyWitnessed(
  hby: Habery,
  pre: string,
  sn: number,
  expectedWitnessCount: number,
): string {
  const said = hby.db.kels.getLast(pre, sn);
  assertExists(said);
  assertEquals(hby.db.wigs.get(dgKey(pre, said)).length, expectedWitnessCount);
  return said;
}

/** Verify that one witness serves KEL replay for the controller at or beyond `sn`. */
async function assertWitnessKelVisible(
  origin: string,
  pre: string,
  sn: number,
  said: string,
): Promise<void> {
  const url = new URL("/query", origin);
  url.searchParams.set("typ", "kel");
  url.searchParams.set("pre", pre);
  url.searchParams.set("sn", String(sn));

  const response = await fetch(url);
  const body = await response.text();
  assertEquals(
    response.status,
    200,
    `Expected witness KEL replay from ${url}, got ${response.status}: ${body}`,
  );
  assertStringIncludes(body, `"i":"${pre}"`);
  assertStringIncludes(body, said);
}

/** Verify that one witness serves stored receipts for the controller event. */
async function assertWitnessReceiptVisible(
  origin: string,
  pre: string,
  said: string,
  sn: number,
): Promise<void> {
  const bySn = new URL("/receipts", origin);
  bySn.searchParams.set("pre", pre);
  bySn.searchParams.set("sn", String(sn));

  const bySaid = new URL("/receipts", origin);
  bySaid.searchParams.set("pre", pre);
  bySaid.searchParams.set("said", said);

  for (const url of [bySn, bySaid]) {
    const response = await fetch(url);
    const body = await response.text();
    assertEquals(
      response.status,
      200,
      `Expected witness receipt from ${url}, got ${response.status}: ${body}`,
    );
    assertStringIncludes(body, `"i":"${pre}"`);
    assertStringIncludes(body, `"d":"${said}"`);
  }
}

/** Resolve witness OOBIs into a Tufa controller store. */
async function resolveWitnessesForTufa(
  controllerName: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
  witnesses: readonly { alias: string; controllerOobi?: string; witnessOobi?: string }[],
): Promise<void> {
  for (const witness of witnesses) {
    const urls = [witness.controllerOobi, witness.witnessOobi].filter(
      (url, index, all): url is string => typeof url === "string" && all.indexOf(url) === index,
    );
    for (const url of urls) {
      await requireSuccess(
        `tufa resolve ${witness.alias} ${url}`,
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            controllerName,
            "--head-dir",
            headDirPath,
            "--url",
            url,
            "--oobi-alias",
            witness.alias,
          ],
          env,
          repoRoot,
          20_000,
        ),
      );
    }
  }
}

/** Resolve witness OOBIs into a KLI controller store. */
async function resolveWitnessesForKli(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  witnesses: readonly { alias: string; controllerOobi?: string; witnessOobi?: string }[],
): Promise<void> {
  for (const witness of witnesses) {
    const urls = [witness.controllerOobi, witness.witnessOobi].filter(
      (url, index, all): url is string => typeof url === "string" && all.indexOf(url) === index,
    );
    for (const url of urls) {
      await requireSuccess(
        `kli resolve ${witness.alias} ${url}`,
        runCmdWithTimeout(
          kliCommand,
          [
            "oobi",
            "resolve",
            "--name",
            name,
            "--base",
            base,
            "--passcode",
            PASSCODE,
            "--oobi",
            url,
            "--oobi-alias",
            witness.alias,
          ],
          env,
          20_000,
        ),
      );
    }
  }
}

/** Submit the current KLI controller event to witnesses until the store converges. */
async function submitKliWitnessReceipts(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  alias: string,
): Promise<void> {
  await requireSuccess(
    `kli witness submit ${alias}`,
    runCmdWithTimeout(
      kliCommand,
      [
        "witness",
        "submit",
        "--name",
        name,
        "--base",
        base,
        "--passcode",
        PASSCODE,
        "--alias",
        alias,
        "--receipt-endpoint",
      ],
      env,
      30_000,
    ),
  );
}

/** Query KEL updates for one prefix into a KLI controller store. */
async function queryKliPrefix(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  alias: string,
  prefix: string,
): Promise<void> {
  await requireSuccess(
    `kli query ${alias}`,
    runCmdWithTimeout(
      kliCommand,
      [
        "query",
        "--name",
        name,
        "--base",
        base,
        "--passcode",
        PASSCODE,
        "--alias",
        alias,
        "--prefix",
        prefix,
      ],
      env,
      20_000,
    ),
  );
}

/** Assert KERIpy witness stores converged on the controller event and receipts. */
async function assertKeriPyWitnessStores(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  harness: Awaited<ReturnType<typeof startKeriPyWitnessHarness>>,
  activeAliases: readonly string[],
  controllerPre: string,
  sn: number,
  expectedWitnessCount: number,
): Promise<void> {
  const compatCtx = { ...ctx, home: harness.home, env: harness.env };
  for (const alias of activeAliases) {
    const node = harness.node(alias);
    await run(() =>
      inspectCompatHabery(
        compatCtx,
        {
          name: node.name,
          base: harness.base,
          compat: true,
          readonly: true,
          skipConfig: true,
          skipSignator: true,
        },
        (hby) => {
          const latestSn = hby.db.getKever(controllerPre)?.sn;
          assertExists(latestSn);
          assertEquals(latestSn >= sn, true);
          assertFullyWitnessed(hby, controllerPre, sn, expectedWitnessCount);
        },
      )
    );
  }
}

/** Assert Tufa witness stores converged on the controller event and receipts. */
async function assertTufaWitnessStores(
  headDirPath: string,
  activeWitnesses: readonly { name: string }[],
  controllerPre: string,
  sn: number,
  expectedWitnessCount: number,
): Promise<void> {
  await run(function*() {
    const stores = [];
    for (const witness of activeWitnesses) {
      stores.push(
        yield* createHabery({
          name: witness.name,
          headDirPath,
          skipConfig: true,
          skipSignator: true,
        }),
      );
    }

    try {
      for (const hby of stores) {
        const latestSn = hby.db.getKever(controllerPre)?.sn;
        assertExists(latestSn);
        assertEquals(latestSn >= sn, true);
        assertFullyWitnessed(hby, controllerPre, sn, expectedWitnessCount);
      }
    } finally {
      for (const hby of [...stores].reverse()) {
        yield* hby.close();
      }
    }
  });
}

Deno.test("Interop witness: tufa controller completes fully witnessed inception and rotations using only KERIpy witnesses", async () => {
  const ctx = await createInteropContext();
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-keripy-witnesses-" });
  const controllerName = `tufa-wit-ctrl-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const harness = await startKeriPyWitnessHarness(ctx, {
    aliases: ["wan", "wil", "wes", "wit"],
  });

  try {
    const initialWitnesses = harness.activeWitnesses(3);
    const spareWitness = harness.node("wit");

    await initTufaStore(controllerName, headDirPath, ctx.env, ctx.repoRoot);
    await resolveWitnessesForTufa(
      controllerName,
      headDirPath,
      ctx.env,
      ctx.repoRoot,
      initialWitnesses,
    );
    await resolveWitnessesForTufa(
      controllerName,
      headDirPath,
      ctx.env,
      ctx.repoRoot,
      [spareWitness],
    );

    const incepted = await requireSuccess(
      "tufa incept with keripy witnesses",
      runTufaWithTimeout(
        [
          "incept",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
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
          "3",
          "--receipt-endpoint",
          "--wits",
          initialWitnesses[0]!.pre,
          "--wits",
          initialWitnesses[1]!.pre,
          "--wits",
          initialWitnesses[2]!.pre,
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    const controllerPre = extractPrefix(incepted.stdout);

    await requireSuccess(
      "tufa rotate with same witnesses",
      runTufaWithTimeout(
        [
          "rotate",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--toad",
          "3",
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );

    await requireSuccess(
      "tufa rotate cut/add keripy witness",
      runTufaWithTimeout(
        [
          "rotate",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--witness-cut",
          initialWitnesses[2]!.pre,
          "--witness-add",
          spareWitness.pre,
          "--toad",
          "3",
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );

    let inceptionSaid = "";
    let firstRotationSaid = "";
    let secondRotationSaid = "";
    await run(function*() {
      const controllerHby = yield* createHabery({
        name: controllerName,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        inceptionSaid = assertFullyWitnessed(controllerHby, controllerPre, 0, 3);
        firstRotationSaid = assertFullyWitnessed(controllerHby, controllerPre, 1, 3);
        secondRotationSaid = assertFullyWitnessed(controllerHby, controllerPre, 2, 3);
      } finally {
        yield* controllerHby.close();
      }
    });

    const finalWitnesses = ["wan", "wil", "wit"] as const;
    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil", "wes"], controllerPre, 0, 3);
    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil", "wes"], controllerPre, 1, 3);
    await assertKeriPyWitnessStores(ctx, harness, finalWitnesses, controllerPre, 2, 3);

    for (const witness of initialWitnesses) {
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 0, inceptionSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, inceptionSaid, 0);
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 1, firstRotationSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, firstRotationSaid, 1);
    }

    for (const alias of finalWitnesses) {
      const witness = harness.node(alias);
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 2, secondRotationSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, secondRotationSaid, 2);
    }
  } finally {
    await harness.close();
  }
});

Deno.test("Interop witness: KLI controller completes fully witnessed inception and rotations using only KERIpy witnesses", async () => {
  const ctx = await createInteropContext();
  const controllerName = `kli-wit-ctrl-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const base = `kli-wit-base-${crypto.randomUUID().slice(0, 8)}`;
  const harness = await startKeriPyWitnessHarness(ctx, {
    aliases: ["wan", "wil", "wes"],
  });

  try {
    const initialWitnesses = harness.activeWitnesses(3);

    await requireSuccess(
      "kli init controller",
      runCmd(
        ctx.kliCommand,
        [
          "init",
          "--name",
          controllerName,
          "--base",
          base,
          "--passcode",
          PASSCODE,
          "--salt",
          SALT,
        ],
        ctx.env,
      ),
    );
    await resolveWitnessesForKli(
      ctx.kliCommand,
      ctx.env,
      controllerName,
      base,
      initialWitnesses,
    );

    const incepted = await requireSuccess(
      "kli incept with keripy witnesses",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "incept",
          "--name",
          controllerName,
          "--base",
          base,
          "--passcode",
          PASSCODE,
          "--alias",
          controllerAlias,
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
          "3",
          "--receipt-endpoint",
          "--wits",
          initialWitnesses[0]!.pre,
          "--wits",
          initialWitnesses[1]!.pre,
          "--wits",
          initialWitnesses[2]!.pre,
        ],
        ctx.env,
        30_000,
      ),
    );
    const controllerPre = extractPrefix(incepted.stdout);
    await submitKliWitnessReceipts(
      ctx.kliCommand,
      ctx.env,
      controllerName,
      base,
      controllerAlias,
    );

    await requireSuccess(
      "kli rotate same witnesses",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "rotate",
          "--name",
          controllerName,
          "--base",
          base,
          "--passcode",
          PASSCODE,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--toad",
          "3",
        ],
        ctx.env,
        30_000,
      ),
    );
    await submitKliWitnessReceipts(
      ctx.kliCommand,
      ctx.env,
      controllerName,
      base,
      controllerAlias,
    );

    await requireSuccess(
      "kli rotate same witnesses again",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "rotate",
          "--name",
          controllerName,
          "--base",
          base,
          "--passcode",
          PASSCODE,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--toad",
          "3",
        ],
        ctx.env,
        30_000,
      ),
    );
    await submitKliWitnessReceipts(
      ctx.kliCommand,
      ctx.env,
      controllerName,
      base,
      controllerAlias,
    );
    await queryKliPrefix(
      ctx.kliCommand,
      ctx.env,
      controllerName,
      base,
      controllerAlias,
      controllerPre,
    );

    let inceptionSaid = "";
    let firstRotationSaid = "";
    let secondRotationSaid = "";
    await run(() =>
      inspectCompatHabery(
        ctx,
        {
          name: controllerName,
          base,
          compat: true,
          readonly: true,
          skipConfig: true,
          skipSignator: true,
          bran: PASSCODE,
        },
        (hby) => {
          inceptionSaid = assertFullyWitnessed(hby, controllerPre, 0, 3);
          firstRotationSaid = assertFullyWitnessed(hby, controllerPre, 1, 3);
          secondRotationSaid = assertFullyWitnessed(hby, controllerPre, 2, 3);
        },
      )
    );

    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil", "wes"], controllerPre, 0, 3);
    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil", "wes"], controllerPre, 1, 3);
    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil", "wes"], controllerPre, 2, 3);

    for (const witness of harness.activeWitnesses(3)) {
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 0, inceptionSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, inceptionSaid, 0);
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 1, firstRotationSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, firstRotationSaid, 1);
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 2, secondRotationSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, secondRotationSaid, 2);
    }
  } finally {
    await harness.close();
  }
});

Deno.test("Interop witness: tufa controller completes fully witnessed rotations with mixed Tufa and KERIpy witnesses", async () => {
  const ctx = await createInteropContext();
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-mixed-witnesses-" });
  const controllerName = `tufa-mixed-ctrl-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const harness = await startKeriPyWitnessHarness(ctx, {
    aliases: ["wan", "wil"],
  });

  const tufaWitness1 = await createStartedTufaWitnessHost(
    `tufa-wit1-${crypto.randomUUID().slice(0, 8)}`,
    "twit1",
    headDirPath,
    ctx.env,
    ctx.repoRoot,
  );
  const tufaWitness2 = await createStartedTufaWitnessHost(
    `tufa-wit2-${crypto.randomUUID().slice(0, 8)}`,
    "twit2",
    headDirPath,
    ctx.env,
    ctx.repoRoot,
  );

  try {
    await initTufaStore(controllerName, headDirPath, ctx.env, ctx.repoRoot);
    await resolveWitnessesForTufa(
      controllerName,
      headDirPath,
      ctx.env,
      ctx.repoRoot,
      [...harness.activeWitnesses(2), tufaWitness1, tufaWitness2],
    );

    const incepted = await requireSuccess(
      "tufa incept mixed witnesses",
      runTufaWithTimeout(
        [
          "incept",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
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
          "3",
          "--receipt-endpoint",
          "--wits",
          harness.node("wan").pre,
          "--wits",
          harness.node("wil").pre,
          "--wits",
          tufaWitness1.pre,
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    const controllerPre = extractPrefix(incepted.stdout);

    await requireSuccess(
      "tufa rotate same mixed witnesses",
      runTufaWithTimeout(
        [
          "rotate",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--toad",
          "3",
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );

    await requireSuccess(
      "tufa rotate replace keripy witness with tufa witness",
      runTufaWithTimeout(
        [
          "rotate",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--witness-cut",
          harness.node("wil").pre,
          "--witness-add",
          tufaWitness2.pre,
          "--toad",
          "3",
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );

    let inceptionSaid = "";
    let firstRotationSaid = "";
    let secondRotationSaid = "";
    await run(function*() {
      const controllerHby = yield* createHabery({
        name: controllerName,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        inceptionSaid = assertFullyWitnessed(controllerHby, controllerPre, 0, 3);
        firstRotationSaid = assertFullyWitnessed(controllerHby, controllerPre, 1, 3);
        secondRotationSaid = assertFullyWitnessed(controllerHby, controllerPre, 2, 3);
      } finally {
        yield* controllerHby.close();
      }
    });

    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil"], controllerPre, 0, 3);
    await assertKeriPyWitnessStores(ctx, harness, ["wan", "wil"], controllerPre, 1, 3);
    await assertKeriPyWitnessStores(ctx, harness, ["wan"], controllerPre, 2, 3);

    await assertTufaWitnessStores(headDirPath, [tufaWitness1], controllerPre, 0, 3);
    await assertTufaWitnessStores(headDirPath, [tufaWitness1], controllerPre, 1, 3);
    await assertTufaWitnessStores(
      headDirPath,
      [tufaWitness1, tufaWitness2],
      controllerPre,
      2,
      3,
    );

    for (const witness of [harness.node("wan"), harness.node("wil"), tufaWitness1]) {
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 0, inceptionSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, inceptionSaid, 0);
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 1, firstRotationSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, firstRotationSaid, 1);
    }

    for (const witness of [harness.node("wan"), tufaWitness1, tufaWitness2]) {
      await assertWitnessKelVisible(witness.httpOrigin, controllerPre, 2, secondRotationSaid);
      await assertWitnessReceiptVisible(witness.httpOrigin, controllerPre, secondRotationSaid, 2);
    }
  } finally {
    await Promise.all([harness.close(), stopChild(tufaWitness1.child), stopChild(tufaWitness2.child)]);
  }
});

Deno.test({
  name: "Interop witness: manual 6-witness KERIpy soak reaches full receipt convergence",
  ignore: true,
  async fn() {
    const ctx = await createInteropContext();
    const headDirPath = await Deno.makeTempDir({ prefix: "tufa-keripy-soak-" });
    const controllerName = `tufa-keripy-soak-${crypto.randomUUID().slice(0, 8)}`;
    const controllerAlias = "controller";
    const harness = await startKeriPyWitnessHarness(ctx);

    try {
      await initTufaStore(controllerName, headDirPath, ctx.env, ctx.repoRoot);
      await resolveWitnessesForTufa(
        controllerName,
        headDirPath,
        ctx.env,
        ctx.repoRoot,
        harness.nodes,
      );

      const incepted = await requireSuccess(
        "tufa incept six keripy witnesses",
        runTufaWithTimeout(
          [
            "incept",
            "--name",
            controllerName,
            "--head-dir",
            headDirPath,
            "--alias",
            controllerAlias,
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
            "6",
            "--receipt-endpoint",
            "--wits",
            harness.node("wan").pre,
            "--wits",
            harness.node("wil").pre,
            "--wits",
            harness.node("wes").pre,
            "--wits",
            harness.node("wit").pre,
            "--wits",
            harness.node("wub").pre,
            "--wits",
            harness.node("wyz").pre,
          ],
          ctx.env,
          ctx.repoRoot,
          60_000,
        ),
      );
      const controllerPre = extractPrefix(incepted.stdout);

      for (let index = 0; index < 2; index++) {
        await requireSuccess(
          `tufa six-witness rotate ${index + 1}`,
          runTufaWithTimeout(
            [
              "rotate",
              "--name",
              controllerName,
              "--head-dir",
              headDirPath,
              "--alias",
              controllerAlias,
              "--receipt-endpoint",
              "--toad",
              "6",
            ],
            ctx.env,
            ctx.repoRoot,
            60_000,
          ),
        );
      }

      await run(function*() {
        const controllerHby = yield* createHabery({
          name: controllerName,
          headDirPath,
          skipConfig: true,
          skipSignator: true,
        });
        try {
          assertFullyWitnessed(controllerHby, controllerPre, 0, 6);
          assertFullyWitnessed(controllerHby, controllerPre, 1, 6);
          assertFullyWitnessed(controllerHby, controllerPre, 2, 6);
        } finally {
          yield* controllerHby.close();
        }
      });

      await assertKeriPyWitnessStores(
        ctx,
        harness,
        ["wan", "wil", "wes", "wit", "wub", "wyz"],
        controllerPre,
        2,
        6,
      );
    } finally {
      await harness.close();
    }
  },
});
