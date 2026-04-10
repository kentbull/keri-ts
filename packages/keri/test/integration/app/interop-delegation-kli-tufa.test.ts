// @file-test-lane interop-delegation

/**
 * Cross-implementation single-sig delegation matrix.
 *
 * Current executable rows:
 * - Tufa delegate -> KLI delegator, mailbox transport plus delegate witness OOBI, explicit proxy, `dip` + `drt`
 * - KLI delegate -> Tufa delegator, mailbox-only, explicit proxy, `dip` + `drt`
 *
 * This file intentionally proves the real durable seams:
 * - mailbox OOBIs for delegated controller-to-controller transport
 * - witness OOBIs for witness-backed delegate inception/rotation
 * - Tufa `Notifier` visibility before `delegate confirm`
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  addKliHostedRoute,
  addKliMailbox,
  addTufaHostedRoute,
  addTufaMailbox,
  generateKliMailboxOobi,
  generateTufaMailboxOobi,
  inceptKliAlias,
  inceptTufaAlias,
  initKliStore,
  initTufaStore,
  inspectCompatKeverSn,
  inspectTufaHabery,
  INTEROP_PASSCODE,
  INTEROP_SALT,
  pumpTufaRuntimeUntil,
  resolveKliOobi,
  resolveTufaOobi,
  setupTufaMailboxProvider,
  startKliMailboxHost,
  startTufaAgentHost,
  waitForChildSuccess,
} from "./interop-delegation-helpers.ts";
import { stopChild } from "./interop-test-helpers.ts";
import {
  createInteropContext,
  extractPrefix,
  randomPort,
  requireSuccess,
  resolvePythonCommand,
  runCmd,
  runCmdWithTimeout,
  runTufaWithTimeout,
  spawnChild,
  startTufaWitnessHarness,
} from "./interop-test-helpers.ts";

interface NotificationList {
  total: number;
  start: number;
  limit: number;
  notices: Array<{
    rid: string;
    dt: string;
    read: boolean;
    attrs: Record<string, unknown>;
  }>;
}

async function listTufaNotifications(args: {
  env: Record<string, string>;
  repoRoot: string;
  name: string;
  base: string;
  headDirPath: string;
  passcode: string;
  limit?: number;
}): Promise<NotificationList> {
  const result = await requireSuccess(
    `${args.name} notifications list`,
    runTufaWithTimeout(
      [
        "notifications",
        "list",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--limit",
        String(args.limit ?? 25),
      ],
      args.env,
      args.repoRoot,
      20_000,
    ),
  );
  return JSON.parse(result.stdout) as NotificationList;
}

Deno.test("Interop delegation: tufa delegate with explicit proxy is approved and rotated by a KLI delegator over mailbox transport", async () => {
  const ctx = await createInteropContext();
  let delegatedIncept: ReturnType<typeof spawnChild> | null = null;
  let delegatedRotate: ReturnType<typeof spawnChild> | null = null;
  let confirmDip: ReturnType<typeof spawnChild> | null = null;
  let confirmDrt: ReturnType<typeof spawnChild> | null = null;
  const base = `interop-delegation-tufa-kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHeadDir = `${ctx.home}/interop-delegation-tufa-kli-head`;
  const provider = await setupTufaMailboxProvider(ctx, {
    name: `tufa-relay-${crypto.randomUUID().slice(0, 8)}`,
    base,
    headDirPath: tufaHeadDir,
    passcode: INTEROP_PASSCODE,
    salt: INTEROP_SALT,
    port: randomPort(),
  });
  const delegateWitnessHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["wan", "wil"],
  });

  try {
    const delegatorName = `kli-delegator-${crypto.randomUUID().slice(0, 8)}`;
    const delegatorAlias = "delegator";
    const delegatorWitness = delegateWitnessHarness.node("wil");
    await initKliStore(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      salt: INTEROP_SALT,
    });
    await resolveKliOobi(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: delegatorWitness.witnessOobi,
      alias: delegatorWitness.alias,
    });
    const delegatorPre = await inceptKliAlias(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
      wits: [delegatorWitness.pre],
      toad: 1,
    });
    await resolveKliOobi(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: provider.mailboxOobi,
      alias: provider.alias,
    });
    const delegatorMailboxAdd = await addKliMailbox(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
      mailbox: provider.alias,
    });
    assertStringIncludes(delegatorMailboxAdd.stdout, provider.pre);
    const delegatorMailboxOobi = await generateKliMailboxOobi(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
    });
    assertStringIncludes(delegatorMailboxOobi, provider.pre);

    const delegateName = `tufa-delegate-${crypto.randomUUID().slice(0, 8)}`;
    const proxyAlias = "proxy";
    const delegateAlias = "delegate";
    const delegateWitnesses = [delegateWitnessHarness.node("wan")];
    await initTufaStore(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      salt: INTEROP_SALT,
    });
    const proxyPre = await inceptTufaAlias(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
    });
    await resolveTufaOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: provider.mailboxOobi,
      alias: provider.alias,
    });
    const proxyMailboxAdd = await addTufaMailbox(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
      mailbox: provider.alias,
    });
    assertStringIncludes(proxyMailboxAdd.stdout, `added ${provider.pre}`);
    const proxyMailboxOobi = await generateTufaMailboxOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
    });
    assertStringIncludes(proxyMailboxOobi, provider.pre);
    await resolveKliOobi(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: proxyMailboxOobi,
      alias: proxyAlias,
    });
    for (const witness of delegateWitnesses) {
      await resolveTufaOobi(ctx, {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        url: witness.witnessOobi,
        alias: witness.alias,
      });
      await resolveKliOobi(ctx, {
        name: delegatorName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: witness.witnessOobi,
        alias: witness.alias,
      });
    }
    await resolveTufaOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: delegatorMailboxOobi,
      alias: delegatorAlias,
    });
    await resolveTufaOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: `${delegatorWitness.httpOrigin}/oobi/${delegatorPre}/witness/${delegatorWitness.pre}`,
      alias: `${delegatorAlias}-${delegatorWitness.alias}`,
    });

    delegatedIncept = spawnChild(
      Deno.execPath(),
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/tufa/mod.ts",
        "incept",
        "--name",
        delegateName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        INTEROP_PASSCODE,
        "--alias",
        delegateAlias,
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
        "1",
        "--wits",
        delegateWitnesses[0]!.pre,
        "--delpre",
        delegatorPre,
        "--proxy",
        proxyAlias,
      ],
      ctx.env,
      ctx.repoRoot,
    );

    confirmDip = spawnChild(
      ctx.kliCommand,
      [
        "delegate",
        "confirm",
        "--name",
        delegatorName,
        "--base",
        base,
        "--passcode",
        INTEROP_PASSCODE,
        "--alias",
        delegatorAlias,
        "-Y",
      ],
      ctx.env,
    );
    const [delegatedInceptOutput, confirmDipOutput] = await Promise.all([
      waitForChildSuccess("tufa delegated incept", delegatedIncept, 60_000),
      waitForChildSuccess("kli delegate confirm dip", confirmDip, 60_000),
    ]);
    delegatedIncept = null;
    confirmDip = null;
    const delegatePre = extractPrefix(delegatedInceptOutput);
    assertStringIncludes(confirmDipOutput, "Approved delegated dip");

    const delegateState = await inspectTufaHabery(
      {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
      },
      (hby) => {
        const kever = hby.db.getKever(delegatePre);
        return {
          sn: kever?.sn ?? null,
          delpre: kever?.delpre ?? null,
          dpwe: hby.db.dpwe.cnt(),
          dune: hby.db.dune.cnt(),
          dpub: hby.db.dpub.cnt(),
          cdel: hby.db.cdel.cntOn(delegatePre),
          aess: hby.db.aess.cnt(),
        };
      },
    );
    assertEquals(delegateState.sn, 0);
    assertEquals(delegateState.delpre, delegatorPre);
    assertEquals(delegateState.dpwe, 0);
    assertEquals(delegateState.dune, 0);
    assertEquals(delegateState.dpub, 0);
    assertEquals(delegateState.cdel, 1);
    assertEquals(delegateState.aess, 1);
    assertEquals(
      await inspectCompatKeverSn(
        ctx,
        { name: delegatorName, base, passcode: INTEROP_PASSCODE },
        delegatePre,
      ),
      0,
    );

    delegatedRotate = spawnChild(
      Deno.execPath(),
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/tufa/mod.ts",
        "rotate",
        "--name",
        delegateName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        INTEROP_PASSCODE,
        "--alias",
        delegateAlias,
        "--proxy",
        proxyAlias,
      ],
      ctx.env,
      ctx.repoRoot,
    );

    confirmDrt = spawnChild(
      ctx.kliCommand,
      [
        "delegate",
        "confirm",
        "--name",
        delegatorName,
        "--base",
        base,
        "--passcode",
        INTEROP_PASSCODE,
        "--alias",
        delegatorAlias,
        "-Y",
      ],
      ctx.env,
    );
    const [delegatedRotateOutput, confirmDrtOutput] = await Promise.all([
      waitForChildSuccess("tufa delegated rotate", delegatedRotate, 60_000),
      waitForChildSuccess("kli delegate confirm drt", confirmDrt, 60_000),
    ]);
    delegatedRotate = null;
    confirmDrt = null;
    assertStringIncludes(confirmDrtOutput, "Approved delegated drt");
    assertStringIncludes(delegatedRotateOutput, "New Sequence No.  1");
    assertEquals(
      await inspectCompatKeverSn(
        ctx,
        { name: delegatorName, base, passcode: INTEROP_PASSCODE },
        delegatePre,
      ),
      1,
    );
  } finally {
    if (confirmDrt) {
      await stopChild(confirmDrt);
    }
    if (confirmDip) {
      await stopChild(confirmDip);
    }
    if (delegatedRotate) {
      await stopChild(delegatedRotate);
    }
    if (delegatedIncept) {
      await stopChild(delegatedIncept);
    }
    await delegateWitnessHarness.close();
    await provider.close();
  }
});

Deno.test("Interop delegation: kli delegate with explicit proxy notifies and is approved by a Tufa delegator over mailbox transport", async () => {
  const ctx = await createInteropContext();
  const pythonCommand = await resolvePythonCommand(ctx.env, ctx.kliCommand);
  const base = `interop-delegation-kli-tufa-${crypto.randomUUID().slice(0, 8)}`;
  const tufaHeadDir = `${ctx.home}/interop-delegation-kli-tufa-head`;
  const provider = await setupTufaMailboxProvider(ctx, {
    name: `tufa-relay-${crypto.randomUUID().slice(0, 8)}`,
    base,
    headDirPath: tufaHeadDir,
    passcode: INTEROP_PASSCODE,
    salt: INTEROP_SALT,
    port: randomPort(),
  });
  let proxyHost: ReturnType<typeof spawnChild> | null = null;
  let delegatorAgent: ReturnType<typeof spawnChild> | null = null;
  let delegatedIncept: ReturnType<typeof spawnChild> | null = null;
  let delegatedRotate: ReturnType<typeof spawnChild> | null = null;

  try {
    const delegatorName = `tufa-delegator-${crypto.randomUUID().slice(0, 8)}`;
    const delegatorAlias = "delegator";
    await initTufaStore(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      salt: INTEROP_SALT,
    });
    const delegatorPre = await inceptTufaAlias(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
    });
    const delegatorPort = randomPort();
    const delegatorOrigin = `http://127.0.0.1:${delegatorPort}`;
    await addTufaHostedRoute(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
      url: delegatorOrigin,
      eid: delegatorPre,
    });
    delegatorAgent = await startTufaAgentHost(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      port: delegatorPort,
    });
    await resolveTufaOobi(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: provider.mailboxOobi,
      alias: provider.alias,
    });
    const delegatorMailboxAdd = await addTufaMailbox(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
      mailbox: provider.alias,
    });
    assertStringIncludes(delegatorMailboxAdd.stdout, `added ${provider.pre}`);
    const delegatorMailboxOobi = await generateTufaMailboxOobi(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
    });
    assertStringIncludes(delegatorMailboxOobi, provider.pre);

    const delegateName = `kli-delegate-${crypto.randomUUID().slice(0, 8)}`;
    const proxyAlias = "proxy";
    const proxyHostAlias = "host";
    const delegateAlias = "delegate";
    await initKliStore(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      salt: INTEROP_SALT,
    });
    const proxyPre = await inceptKliAlias(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
    });
    const proxyHostPre = await inceptKliAlias(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyHostAlias,
      transferable: false,
    });
    const proxyPort = randomPort();
    const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
    await addKliHostedRoute(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyHostAlias,
      url: proxyOrigin,
      eid: proxyHostPre,
      mailbox: true,
    });
    await addKliHostedRoute(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
      url: proxyOrigin,
      eid: proxyPre,
      mailbox: true,
    });
    const proxyMailboxOobi = await generateKliMailboxOobi(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
    });
    proxyHost = await startKliMailboxHost(ctx, {
      pythonCommand,
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyHostAlias,
      port: proxyPort,
    });

    await resolveTufaOobi(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: proxyMailboxOobi,
      alias: proxyAlias,
    });
    await stopChild(proxyHost);
    proxyHost = null;
    await resolveKliOobi(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: provider.mailboxOobi,
      alias: provider.alias,
    });
    await resolveKliOobi(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: delegatorMailboxOobi,
      alias: delegatorAlias,
    });

    delegatedIncept = spawnChild(
      ctx.kliCommand,
      [
        "incept",
        "--name",
        delegateName,
        "--base",
        base,
        "--passcode",
        INTEROP_PASSCODE,
        "--alias",
        delegateAlias,
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
        "--delpre",
        delegatorPre,
        "--proxy",
        proxyAlias,
      ],
      ctx.env,
    );

    await pumpTufaRuntimeUntil(
      {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
      },
      ({ hby, runtime }) => (runtime.notifier?.count() ?? 0) >= 1 && hby.db.delegables.cnt() >= 1,
      { maxTurns: 160 },
    );

    const notificationsAfterDip = await listTufaNotifications({
      env: ctx.env,
      repoRoot: ctx.repoRoot,
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      limit: 10,
    });
    const dipNotice = notificationsAfterDip.notices.find((notice) =>
      notice.attrs["r"] === "/delegate/request"
      && notice.attrs["src"] === proxyPre
      && notice.attrs["delpre"] === delegatorPre
    );
    assert(dipNotice);
    assertEquals(
      (dipNotice.attrs["ked"] as Record<string, unknown>)["t"],
      "dip",
    );

    const confirmDip = await requireSuccess(
      "tufa delegate confirm dip",
      runTufaWithTimeout(
        [
          "delegate",
          "confirm",
          "--name",
          delegatorName,
          "--base",
          base,
          "--head-dir",
          tufaHeadDir,
          "--passcode",
          INTEROP_PASSCODE,
          "--alias",
          delegatorAlias,
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    assertStringIncludes(confirmDip.stdout, "Approved delegated dip");

    const inceptOutput = await waitForChildSuccess(
      "kli delegated incept",
      delegatedIncept,
      45_000,
    );
    delegatedIncept = null;
    const delegatePre = extractPrefix(inceptOutput);
    assertStringIncludes(inceptOutput, "Waiting for delegation approval");

    const delegatorDipSn = await inspectTufaHabery(
      {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
      },
      (hby) => hby.db.getKever(delegatePre)?.sn ?? null,
    );
    assertEquals(delegatorDipSn, 0);

    delegatedRotate = spawnChild(
      ctx.kliCommand,
      [
        "rotate",
        "--name",
        delegateName,
        "--base",
        base,
        "--passcode",
        INTEROP_PASSCODE,
        "--alias",
        delegateAlias,
        "--proxy",
        proxyAlias,
      ],
      ctx.env,
    );

    await pumpTufaRuntimeUntil(
      {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
      },
      ({ hby, runtime }) => (runtime.notifier?.count() ?? 0) >= 2 && hby.db.delegables.cnt() >= 1,
      { maxTurns: 160 },
    );

    const notificationsAfterDrt = await listTufaNotifications({
      env: ctx.env,
      repoRoot: ctx.repoRoot,
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      limit: 10,
    });
    const drtNotice = notificationsAfterDrt.notices.find((notice) =>
      notice.attrs["r"] === "/delegate/request"
      && notice.attrs["src"] === proxyPre
      && (notice.attrs["ked"] as Record<string, unknown>)["t"] === "drt"
    );
    assert(drtNotice);

    const confirmDrt = await requireSuccess(
      "tufa delegate confirm drt",
      runTufaWithTimeout(
        [
          "delegate",
          "confirm",
          "--name",
          delegatorName,
          "--base",
          base,
          "--head-dir",
          tufaHeadDir,
          "--passcode",
          INTEROP_PASSCODE,
          "--alias",
          delegatorAlias,
        ],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    assertStringIncludes(confirmDrt.stdout, "Approved delegated drt");

    const rotateOutput = await waitForChildSuccess(
      "kli delegated rotate",
      delegatedRotate,
      45_000,
    );
    delegatedRotate = null;
    assertStringIncludes(rotateOutput, "New Sequence No.  1");

    const delegatorDrtSn = await inspectTufaHabery(
      {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
      },
      (hby) => hby.db.getKever(delegatePre)?.sn ?? null,
    );
    assertEquals(delegatorDrtSn, 1);
    assertEquals(
      await inspectCompatKeverSn(
        ctx,
        { name: delegateName, base, passcode: INTEROP_PASSCODE },
        delegatePre,
      ),
      1,
    );
  } finally {
    if (delegatorAgent) {
      await stopChild(delegatorAgent);
    }
    if (delegatedRotate) {
      await stopChild(delegatedRotate);
    }
    if (delegatedIncept) {
      await stopChild(delegatedIncept);
    }
    if (proxyHost) {
      await stopChild(proxyHost);
    }
    await provider.close();
  }
});
