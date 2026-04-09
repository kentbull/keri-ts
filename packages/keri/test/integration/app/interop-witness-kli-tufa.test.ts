// @file-test-lane interop-witness

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
  runTufaWithTimeout,
  startKeriPyWitnessHarness,
  startTufaWitnessHarness,
  type TufaWitnessHarness,
} from "./interop-test-helpers.ts";

const PASSCODE = "MyPasscodeARealSecret";
const SALT = "0AAwMTIzNDU2Nzg5YWJjZGVm";

/** Initialize one unencrypted Tufa controller store. */
async function initTufaStore(
  name: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<void> {
  await requireSuccess(
    `${name} init`,
    runTufaWithTimeout(
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
      20_000,
    ),
  );
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
  witnesses: readonly {
    alias: string;
    controllerOobi?: string;
    witnessOobi?: string;
  }[],
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
  witnesses: readonly {
    alias: string;
    controllerOobi?: string;
    witnessOobi?: string;
  }[],
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

/** Dump targeted DB state via `tufa db dump` for interop debugging. */
async function dumpTufaDbTargets(
  {
    name,
    headDirPath,
    base,
    compat = false,
  }: {
    name: string;
    headDirPath?: string;
    base?: string;
    compat?: boolean;
  },
  env: Record<string, string>,
  repoRoot: string,
  prefix?: string,
): Promise<string> {
  const targets = [
    "baser.kels",
    "baser.wigs",
    "baser.states",
    "baser.locs",
    "baser.ends",
  ];
  const sections: string[] = [];
  for (const target of targets) {
    const args = [
      "db",
      "dump",
      target,
      "--name",
      name,
      ...(base ? ["--base", base] : []),
      ...(headDirPath ? ["--head-dir", headDirPath] : []),
      ...(compat ? ["--compat"] : []),
      ...(prefix ? ["--prefix", prefix] : []),
      "--limit",
      "20",
    ];
    const result = await runTufaWithTimeout(args, env, repoRoot, 20_000);
    sections.push(
      `## ${target}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return sections.join("\n\n");
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

/** Assert one KLI controller store converged on the controller event and receipts. */
async function assertKliControllerStore(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  name: string,
  base: string,
  controllerPre: string,
  sn: number,
  expectedWitnessCount: number,
): Promise<string> {
  let said = "";
  await run(() =>
    inspectCompatHabery(
      ctx,
      {
        name,
        base,
        compat: true,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: PASSCODE,
      },
      (hby) => {
        said = assertFullyWitnessed(
          hby,
          controllerPre,
          sn,
          expectedWitnessCount,
        );
      },
    )
  );
  return said;
}

/** Drive a KLI controller store to full witness convergence for one event. */
async function convergeKliControllerStore(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  {
    name,
    base,
    alias,
    controllerPre,
    sn,
    expectedWitnessCount,
    allowQuery = false,
    attempts = 4,
  }: {
    name: string;
    base: string;
    alias: string;
    controllerPre: string;
    sn: number;
    expectedWitnessCount: number;
    allowQuery?: boolean;
    attempts?: number;
  },
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await submitKliWitnessReceipts(
      ctx.kliCommand,
      ctx.env,
      name,
      base,
      alias,
    );
    if (allowQuery) {
      await queryKliPrefix(
        ctx.kliCommand,
        ctx.env,
        name,
        base,
        alias,
        controllerPre,
      );
    }
    try {
      return await assertKliControllerStore(
        ctx,
        name,
        base,
        controllerPre,
        sn,
        expectedWitnessCount,
      );
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}

Deno.test("Interop witness: tufa controller completes fully witnessed inception and rotations using only KERIpy witnesses", async () => {
  const ctx = await createInteropContext();
  const headDirPath = await Deno.makeTempDir({
    prefix: "tufa-keripy-witnesses-",
  });
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

    await requireSuccess(
      "tufa interact with keripy witnesses",
      runTufaWithTimeout(
        [
          "interact",
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
          "--receipt-endpoint",
          "--data",
          "{\"anchor\":\"acdc\"}",
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );

    let inceptionSaid = "";
    let firstRotationSaid = "";
    let secondRotationSaid = "";
    let interactionSaid = "";
    await run(function*() {
      const controllerHby = yield* createHabery({
        name: controllerName,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        inceptionSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          0,
          3,
        );
        firstRotationSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          1,
          3,
        );
        secondRotationSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          2,
          3,
        );
        interactionSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          3,
          3,
        );
      } finally {
        yield* controllerHby.close();
      }
    });

    const finalWitnesses = ["wan", "wil", "wit"] as const;
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil", "wes"],
      controllerPre,
      0,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil", "wes"],
      controllerPre,
      1,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      finalWitnesses,
      controllerPre,
      2,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      finalWitnesses,
      controllerPre,
      3,
      3,
    );

    for (const witness of initialWitnesses) {
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        0,
        inceptionSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        inceptionSaid,
        0,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        1,
        firstRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        firstRotationSaid,
        1,
      );
    }

    for (const alias of finalWitnesses) {
      const witness = harness.node(alias);
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        2,
        secondRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        secondRotationSaid,
        2,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        3,
        interactionSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        interactionSaid,
        3,
      );
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
    const inceptionSaid = await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 0,
      expectedWitnessCount: 3,
      allowQuery: true,
    });
    const firstRotationSaid = await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 1,
      expectedWitnessCount: 3,
      allowQuery: true,
    });
    const secondRotationSaid = await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 2,
      expectedWitnessCount: 3,
      allowQuery: true,
    });

    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil", "wes"],
      controllerPre,
      0,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil", "wes"],
      controllerPre,
      1,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil", "wes"],
      controllerPre,
      2,
      3,
    );

    for (const witness of harness.activeWitnesses(3)) {
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        0,
        inceptionSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        inceptionSaid,
        0,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        1,
        firstRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        firstRotationSaid,
        1,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        2,
        secondRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        secondRotationSaid,
        2,
      );
    }
  } finally {
    await harness.close();
  }
});

Deno.test("Interop witness: KLI controller completes fully witnessed inception and rotations using only Tufa witnesses", async () => {
  const ctx = await createInteropContext();
  const controllerName = `kli-tufa-only-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const base = `kli-tufa-only-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twan", "twil", "twes"],
  });

  try {
    const activeWitnesses = tufaHarness.activeWitnesses(3);

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
      activeWitnesses,
    );

    const incepted = await requireSuccess(
      "kli incept with tufa witnesses",
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
          activeWitnesses[0]!.pre,
          "--wits",
          activeWitnesses[1]!.pre,
          "--wits",
          activeWitnesses[2]!.pre,
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

    for (let index = 0; index < 2; index++) {
      await requireSuccess(
        `kli rotate same tufa witnesses ${index + 1}`,
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
    }

    let inceptionSaid = "";
    let firstRotationSaid = "";
    let secondRotationSaid = "";
    try {
      inceptionSaid = await assertKliControllerStore(
        ctx,
        controllerName,
        base,
        controllerPre,
        0,
        3,
      );
      firstRotationSaid = await assertKliControllerStore(
        ctx,
        controllerName,
        base,
        controllerPre,
        1,
        3,
      );
      secondRotationSaid = await assertKliControllerStore(
        ctx,
        controllerName,
        base,
        controllerPre,
        2,
        3,
      );
    } catch (error) {
      const controllerDump = await dumpTufaDbTargets(
        { name: controllerName, base, compat: true },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      const witnessDump = await dumpTufaDbTargets(
        {
          name: activeWitnesses[0]!.name,
          headDirPath: tufaHarness.headDirPath,
        },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }\n\n# KLI controller dump\n${controllerDump}\n\n# First Tufa witness dump\n${witnessDump}`,
      );
    }

    try {
      await assertTufaWitnessStores(
        tufaHarness.headDirPath,
        activeWitnesses,
        controllerPre,
        0,
        3,
      );
      await assertTufaWitnessStores(
        tufaHarness.headDirPath,
        activeWitnesses,
        controllerPre,
        1,
        3,
      );
      await assertTufaWitnessStores(
        tufaHarness.headDirPath,
        activeWitnesses,
        controllerPre,
        2,
        3,
      );
    } catch (error) {
      const controllerDump = await dumpTufaDbTargets(
        { name: controllerName, base, compat: true },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      const witnessDump = await dumpTufaDbTargets(
        {
          name: activeWitnesses[0]!.name,
          headDirPath: tufaHarness.headDirPath,
        },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }\n\n# KLI controller dump\n${controllerDump}\n\n# First Tufa witness dump\n${witnessDump}`,
      );
    }

    for (const witness of activeWitnesses) {
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        0,
        inceptionSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        inceptionSaid,
        0,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        1,
        firstRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        firstRotationSaid,
        1,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        2,
        secondRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        secondRotationSaid,
        2,
      );
    }
  } finally {
    await tufaHarness.close();
  }
});

Deno.test("Interop witness: tufa controller completes fully witnessed rotations with mixed Tufa and KERIpy witnesses", async () => {
  const ctx = await createInteropContext();
  const headDirPath = await Deno.makeTempDir({
    prefix: "tufa-mixed-witnesses-",
  });
  const controllerName = `tufa-mixed-ctrl-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const harness = await startKeriPyWitnessHarness(ctx, {
    aliases: ["wan", "wil"],
  });
  const tufaHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twit1", "twit2"],
    headDirPath,
  });

  try {
    const tufaWitness1 = tufaHarness.node("twit1");
    const tufaWitness2 = tufaHarness.node("twit2");
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
        inceptionSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          0,
          3,
        );
        firstRotationSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          1,
          3,
        );
        secondRotationSaid = assertFullyWitnessed(
          controllerHby,
          controllerPre,
          2,
          3,
        );
      } finally {
        yield* controllerHby.close();
      }
    });

    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil"],
      controllerPre,
      0,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      harness,
      ["wan", "wil"],
      controllerPre,
      1,
      3,
    );
    await assertKeriPyWitnessStores(ctx, harness, ["wan"], controllerPre, 2, 3);

    await assertTufaWitnessStores(
      headDirPath,
      [tufaWitness1],
      controllerPre,
      0,
      3,
    );
    await assertTufaWitnessStores(
      headDirPath,
      [tufaWitness1],
      controllerPre,
      1,
      3,
    );
    await assertTufaWitnessStores(
      headDirPath,
      [tufaWitness1, tufaWitness2],
      controllerPre,
      2,
      3,
    );

    for (
      const witness of [harness.node("wan"), harness.node("wil"), tufaWitness1]
    ) {
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        0,
        inceptionSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        inceptionSaid,
        0,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        1,
        firstRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        firstRotationSaid,
        1,
      );
    }

    for (const witness of [harness.node("wan"), tufaWitness1, tufaWitness2]) {
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        2,
        secondRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        secondRotationSaid,
        2,
      );
    }
  } finally {
    await Promise.all([harness.close(), tufaHarness.close()]);
  }
});

Deno.test("Interop witness: KLI controller completes fully witnessed rotations with mixed Tufa and KERIpy witnesses", async () => {
  const ctx = await createInteropContext();
  const controllerName = `kli-mixed-wit-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const base = `kli-mixed-base-${crypto.randomUUID().slice(0, 8)}`;
  const keriPyHarness = await startKeriPyWitnessHarness(ctx, {
    aliases: ["wan", "wil"],
  });
  const tufaHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twan", "twil"],
  });

  try {
    const inceptionWitnesses = [
      keriPyHarness.node("wan"),
      keriPyHarness.node("wil"),
      tufaHarness.node("twan"),
    ] as const;

    await requireSuccess(
      "kli init mixed controller",
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
      [...inceptionWitnesses, tufaHarness.node("twil")],
    );

    const incepted = await requireSuccess(
      "kli incept mixed witnesses",
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
          inceptionWitnesses[0]!.pre,
          "--wits",
          inceptionWitnesses[1]!.pre,
          "--wits",
          inceptionWitnesses[2]!.pre,
        ],
        ctx.env,
        30_000,
      ),
    );
    const controllerPre = extractPrefix(incepted.stdout);
    await requireSuccess(
      "kli rotate same mixed witnesses",
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
    await requireSuccess(
      "kli rotate same mixed witnesses again",
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
    let inceptionSaid = "";
    let firstRotationSaid = "";
    let secondRotationSaid = "";
    try {
      inceptionSaid = await convergeKliControllerStore(ctx, {
        name: controllerName,
        base,
        alias: controllerAlias,
        controllerPre,
        sn: 0,
        expectedWitnessCount: 3,
        allowQuery: true,
      });
      firstRotationSaid = await convergeKliControllerStore(ctx, {
        name: controllerName,
        base,
        alias: controllerAlias,
        controllerPre,
        sn: 1,
        expectedWitnessCount: 3,
        allowQuery: true,
      });
      secondRotationSaid = await convergeKliControllerStore(ctx, {
        name: controllerName,
        base,
        alias: controllerAlias,
        controllerPre,
        sn: 2,
        expectedWitnessCount: 3,
        allowQuery: true,
        attempts: 6,
      });
    } catch (error) {
      const controllerDump = await dumpTufaDbTargets(
        { name: controllerName, base, compat: true },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      const keriPyDump = await dumpTufaDbTargets(
        {
          name: keriPyHarness.node("wan").name,
          base: keriPyHarness.base,
          compat: true,
        },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      const tufaDump = await dumpTufaDbTargets(
        {
          name: tufaHarness.node("twan").name,
          headDirPath: tufaHarness.headDirPath,
        },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }\n\n# KLI controller dump\n${controllerDump}\n\n# KERIpy witness dump\n${keriPyDump}\n\n# First Tufa witness dump\n${tufaDump}`,
      );
    }

    await assertKeriPyWitnessStores(
      ctx,
      keriPyHarness,
      ["wan", "wil"],
      controllerPre,
      0,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      keriPyHarness,
      ["wan", "wil"],
      controllerPre,
      1,
      3,
    );
    await assertKeriPyWitnessStores(
      ctx,
      keriPyHarness,
      ["wan", "wil"],
      controllerPre,
      2,
      3,
    );

    try {
      await assertTufaWitnessStores(
        tufaHarness.headDirPath,
        [tufaHarness.node("twan")],
        controllerPre,
        0,
        3,
      );
      await assertTufaWitnessStores(
        tufaHarness.headDirPath,
        [tufaHarness.node("twan")],
        controllerPre,
        1,
        3,
      );
      await assertTufaWitnessStores(
        tufaHarness.headDirPath,
        [tufaHarness.node("twan")],
        controllerPre,
        2,
        3,
      );
    } catch (error) {
      const controllerDump = await dumpTufaDbTargets(
        { name: controllerName, base, compat: true },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      const tufaDump = await dumpTufaDbTargets(
        {
          name: tufaHarness.node("twan").name,
          headDirPath: tufaHarness.headDirPath,
        },
        ctx.env,
        ctx.repoRoot,
        controllerPre,
      );
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }\n\n# KLI controller dump\n${controllerDump}\n\n# First Tufa witness dump\n${tufaDump}`,
      );
    }

    for (const witness of inceptionWitnesses) {
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        0,
        inceptionSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        inceptionSaid,
        0,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        1,
        firstRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        firstRotationSaid,
        1,
      );
      await assertWitnessKelVisible(
        witness.httpOrigin,
        controllerPre,
        2,
        secondRotationSaid,
      );
      await assertWitnessReceiptVisible(
        witness.httpOrigin,
        controllerPre,
        secondRotationSaid,
        2,
      );
    }
  } finally {
    await Promise.all([keriPyHarness.close(), tufaHarness.close()]);
  }
});

Deno.test("Interop witness: KLI controller mixed Tufa/KERIpy witness replacement converges fully", async () => {
  const ctx = await createInteropContext();
  const controllerName = `kli-mixed-repl-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const base = `kli-mixed-repl-base-${crypto.randomUUID().slice(0, 8)}`;
  const keriPyHarness = await startKeriPyWitnessHarness(ctx, {
    aliases: ["wan", "wil"],
  });
  const tufaHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twan", "twil"],
  });

  try {
    const initialWitnesses = [
      keriPyHarness.node("wan"),
      keriPyHarness.node("wil"),
      tufaHarness.node("twan"),
    ] as const;
    const replacementWitness = tufaHarness.node("twil");

    await requireSuccess(
      "kli init mixed replacement controller",
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
      [...initialWitnesses, replacementWitness],
    );

    const incepted = await requireSuccess(
      "kli incept mixed replacement witnesses",
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

    await requireSuccess(
      "kli rotate mixed replacement witnesses",
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
          "--witness-cut",
          keriPyHarness.node("wil").pre,
          "--witness-add",
          replacementWitness.pre,
          "--toad",
          "3",
        ],
        ctx.env,
        30_000,
      ),
    );

    await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 0,
      expectedWitnessCount: 3,
      allowQuery: true,
    });
    await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 1,
      expectedWitnessCount: 3,
      allowQuery: true,
      attempts: 6,
    });
  } finally {
    await Promise.all([keriPyHarness.close(), tufaHarness.close()]);
  }
});

Deno.test("Interop witness: KLI controller reaches full replacement convergence using only Tufa witnesses", async () => {
  const ctx = await createInteropContext();
  const controllerName = `kli-tufa-replace-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const base = `kli-tufa-replace-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twan", "twil", "twes", "twit"],
  });

  try {
    const initialWitnesses = tufaHarness.activeWitnesses(3);
    const replacementWitness = tufaHarness.node("twit");

    await requireSuccess(
      "kli init all-tufa replacement controller",
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
      [...initialWitnesses, replacementWitness],
    );

    const incepted = await requireSuccess(
      "kli incept all-tufa replacement witnesses",
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
      "kli rotate all-tufa replacement witnesses",
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
          "--witness-cut",
          initialWitnesses[2]!.pre,
          "--witness-add",
          replacementWitness.pre,
          "--toad",
          "3",
        ],
        ctx.env,
        30_000,
      ),
    );
    await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 0,
      expectedWitnessCount: 3,
      allowQuery: true,
    });
    await convergeKliControllerStore(ctx, {
      name: controllerName,
      base,
      alias: controllerAlias,
      controllerPre,
      sn: 1,
      expectedWitnessCount: 3,
      allowQuery: true,
      attempts: 6,
    });
  } finally {
    await tufaHarness.close();
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
