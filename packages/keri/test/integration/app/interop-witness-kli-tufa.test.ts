/** Live witness receipting matrix with unchanged participant topologies. */
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
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

import {
  assertFullyWitnessed,
  assertKeriPyWitnessStores,
  assertKliControllerStore,
  assertTufaWitnessStores,
  assertWitnessKelVisible,
  assertWitnessReceiptVisible,
  convergeKliControllerStore,
  dumpTufaDbTargets,
  initTufaStore,
  PASSCODE,
  queryKliPrefix,
  resolveWitnessesForKli,
  resolveWitnessesForTufa,
  SALT,
  submitKliWitnessReceipts,
} from "./interop-witness-helpers.ts";

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
          "--data",
          JSON.stringify({ i: controllerPre, s: "0", d: controllerPre }),
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );

    let inceptionSaid = "";
    let inceptionWire: Uint8Array = new Uint8Array();
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
        assertEquals(inceptionSaid, controllerPre);
        inceptionWire = controllerHby.db.cloneEvtMsg(controllerPre, 0, inceptionSaid);
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

    // Start a different controller with only the subject's fully witnessed inception.
    // KERIpy must answer the anchor-filtered logs query for the later interaction.
    const readerName = `${controllerName}-reader`;
    await initTufaStore(readerName, headDirPath, ctx.env, ctx.repoRoot);
    await resolveWitnessesForTufa(readerName, headDirPath, ctx.env, ctx.repoRoot, initialWitnesses);
    await requireSuccess(
      "incept anchor-query reader",
      runTufaWithTimeout(
        [
          "incept",
          "--name",
          readerName,
          "--head-dir",
          headDirPath,
          "--alias",
          "reader",
          "--transferable",
          "--receipt-endpoint",
          "--toad",
          "3",
          "--wits",
          initialWitnesses[0]!.pre,
          "--wits",
          initialWitnesses[1]!.pre,
          "--wits",
          initialWitnesses[2]!.pre,
        ],
        ctx.env,
        ctx.repoRoot,
      ),
    );
    await run(function*() {
      const reader = yield* createHabery({ name: readerName, headDirPath, skipConfig: true, skipSignator: true });
      try {
        const runtime = yield* createAgentRuntime(reader);
        yield* runtime.reactor.processBytes(inceptionWire);
        assertEquals(reader.db.getKever(controllerPre)?.sn, 0);
      } finally {
        yield* reader.close();
      }
    });
    const anchorPath = `${headDirPath}/anchor.json`;
    await Deno.writeTextFile(anchorPath, JSON.stringify({ d: inceptionSaid, s: "0", i: controllerPre }));
    const queried = await requireSuccess(
      "query KERIpy witnesses with reverse-ordered anchor file",
      runTufaWithTimeout(
        [
          "query",
          "--name",
          readerName,
          "--head-dir",
          headDirPath,
          "--alias",
          "reader",
          "--prefix",
          controllerPre,
          "--anchor",
          anchorPath,
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    await run(function*() {
      const reader = yield* createHabery({ name: readerName, headDirPath, skipConfig: true, skipSignator: true });
      try {
        assertEquals(reader.db.getKever(controllerPre)?.sn, 3, `${queried.stdout}\n${queried.stderr}`);
        assertEquals(assertFullyWitnessed(reader, controllerPre, 3, 3), interactionSaid);
      } finally {
        yield* reader.close();
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
            "--version",
            "1.0",
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

Deno.test("Interop witness: KLI controller completes default witness-mode inception using one Tufa witness", async () => {
  const ctx = await createInteropContext();
  const controllerName = `kli-tufa-default-${crypto.randomUUID().slice(0, 8)}`;
  const controllerAlias = "controller";
  const base = `kli-tufa-default-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twil"],
  });

  try {
    const witness = tufaHarness.node("twil");

    await requireSuccess(
      "kli init controller",
      runCmd(
        ctx.kliCommand,
        [
          "init",
          "--version",
          "1.0",
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
      [witness],
    );

    const incepted = await requireSuccess(
      "kli incept with default witness mode against tufa witness",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "incept",
          "--version",
          "1.0",
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
          "1",
          "--wits",
          witness.pre,
        ],
        ctx.env,
        // An initial mailbox poll can precede inception. Allow KERIpy's
        // 30-second reconnect cycle plus its one-second retry and startup.
        45_000,
      ),
    );
    const controllerPre = extractPrefix(incepted.stdout);
    const said = await assertKliControllerStore(
      ctx,
      controllerName,
      base,
      controllerPre,
      0,
      1,
    );
    await assertTufaWitnessStores(
      tufaHarness.headDirPath,
      [witness],
      controllerPre,
      0,
      1,
    );
    await assertWitnessReceiptVisible(
      witness.httpOrigin,
      controllerPre,
      said,
      0,
    );
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
          "--version",
          "1.0",
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
