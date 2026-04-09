// @file-test-lane interop-delegation

/**
 * Cross-implementation single-sig delegation matrix.
 *
 * Current executable rows:
 * - Tufa delegate -> KLI delegator, mailbox-only, explicit proxy, `dip` + `drt`
 * - KLI delegate -> Tufa delegator, mailbox-only, explicit proxy, `dip` + `drt`
 *
 * This file intentionally proves the real durable seams:
 * - proxy-hosted controller OOBIs for `"/delegate/request"` verification
 * - mailbox OOBIs for the delegated AID before delegator approval replay
 * - Tufa `Notifier` visibility before `delegate confirm`
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { stopChild } from "./interop-test-helpers.ts";
import {
  addKliHostedRoute,
  addKliMailbox,
  addTufaHostedRoute,
  addTufaMailbox,
  generateKliMailboxOobi,
  generateTufaMailboxOobi,
  initKliStore,
  initTufaStore,
  inceptKliAlias,
  inceptTufaAlias,
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
import {
  createInteropContext,
  extractPrefix,
  randomPort,
  requireSuccess,
  resolvePythonCommand,
  runCmd,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
  spawnChild,
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
  const pythonCommand = await resolvePythonCommand(ctx.env, ctx.kliCommand);
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
  let delegateAgent: ReturnType<typeof spawnChild> | null = null;
  let delegatorHost: ReturnType<typeof spawnChild> | null = null;

  try {
    const delegatorName = `kli-delegator-${crypto.randomUUID().slice(0, 8)}`;
    const delegatorAlias = "delegator";
    await initKliStore(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      salt: INTEROP_SALT,
    });
    const delegatorPre = await inceptKliAlias(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
    });
    const delegatorPort = randomPort();
    const delegatorOrigin = `http://127.0.0.1:${delegatorPort}`;
    await addKliHostedRoute(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
      url: delegatorOrigin,
      eid: delegatorPre,
      mailbox: true,
    });
    delegatorHost = await startKliMailboxHost(ctx, {
      pythonCommand,
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: delegatorAlias,
      port: delegatorPort,
    });
    await resolveKliOobi(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: provider.controllerOobi,
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
    const delegatePort = randomPort();
    const delegateOrigin = `http://127.0.0.1:${delegatePort}`;
    await addTufaHostedRoute(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
      url: delegateOrigin,
      eid: proxyPre,
    });
    delegateAgent = await startTufaAgentHost(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      port: delegatePort,
    });

    await resolveKliOobi(ctx, {
      name: delegatorName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: `${delegateOrigin}/oobi/${proxyPre}/controller`,
      alias: proxyAlias,
    });
    await stopChild(delegateAgent);
    delegateAgent = null;
    await resolveTufaOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: provider.controllerOobi,
      alias: provider.alias,
    });
    await resolveTufaOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: `${delegatorOrigin}/oobi/${delegatorPre}/controller`,
      alias: delegatorAlias,
    });
    await resolveTufaOobi(ctx, {
      name: delegateName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: delegatorMailboxOobi,
      alias: delegatorAlias,
    });

    const delegatedIncept = await requireSuccess(
      "tufa delegated incept",
      runTufa(
        [
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
          "0",
          "--delpre",
          delegatorPre,
          "--proxy",
          proxyAlias,
        ],
        ctx.env,
        ctx.repoRoot,
      ),
    );
    const delegatePre = extractPrefix(delegatedIncept.stdout);
    assertStringIncludes(
      delegatedIncept.stdout,
      "Delegation status  waitingDelegatorAnchor",
    );

    const confirmDip = await requireSuccess(
      "kli delegate confirm dip",
      runCmdWithTimeout(
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
        30_000,
      ),
    );
    assertStringIncludes(confirmDip.stdout, "Approved delegated dip");
    await requireSuccess(
      "tufa query delegator after delegated inception approval",
      runTufaWithTimeout(
        [
          "query",
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
          "--prefix",
          delegatorPre,
        ],
        ctx.env,
        ctx.repoRoot,
        20_000,
      ),
    );

    await pumpTufaRuntimeUntil(
      {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegateAlias,
      },
      ({ hby }) => {
        const kever = hby.db.getKever(delegatePre);
        return (kever?.sn ?? -1) === 0
          && hby.db.dpwe.cnt() === 0
          && hby.db.dune.cnt() === 0
          && hby.db.dpub.cnt() === 0;
      },
      { maxTurns: 160 },
    );

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
        };
      },
    );
    assertEquals(delegateState.sn, 0);
    assertEquals(delegateState.delpre, delegatorPre);
    assertEquals(delegateState.dpwe, 0);
    assertEquals(delegateState.dune, 0);
    assertEquals(delegateState.dpub, 0);
    assertEquals(
      await inspectCompatKeverSn(
        ctx,
        { name: delegatorName, base, passcode: INTEROP_PASSCODE },
        delegatePre,
      ),
      0,
    );

    const delegatedRotate = await requireSuccess(
      "tufa delegated rotate",
      runTufa(
        [
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
      ),
    );
    assertStringIncludes(
      delegatedRotate.stdout,
      "Delegation status  waitingDelegatorAnchor",
    );

    const confirmDrt = await requireSuccess(
      "kli delegate confirm drt",
      runCmdWithTimeout(
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
        30_000,
      ),
    );
    assertStringIncludes(confirmDrt.stdout, "Approved delegated drt");
    await requireSuccess(
      "tufa query delegator after delegated rotation approval",
      runTufaWithTimeout(
        [
          "query",
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
          "--prefix",
          delegatorPre,
        ],
        ctx.env,
        ctx.repoRoot,
        20_000,
      ),
    );

    await pumpTufaRuntimeUntil(
      {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegateAlias,
      },
      ({ hby }) => {
        const kever = hby.db.getKever(delegatePre);
        return (kever?.sn ?? -1) === 1
          && hby.db.dpwe.cnt() === 0
          && hby.db.dune.cnt() === 0
          && hby.db.dpub.cnt() === 0;
      },
      { maxTurns: 160 },
    );
    assertEquals(
      await inspectCompatKeverSn(
        ctx,
        { name: delegatorName, base, passcode: INTEROP_PASSCODE },
        delegatePre,
      ),
      1,
    );
  } finally {
    if (delegatorHost) {
      await stopChild(delegatorHost);
    }
    if (delegateAgent) {
      await stopChild(delegateAgent);
    }
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
      url: provider.controllerOobi,
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
    const proxyPort = randomPort();
    const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
    await addKliHostedRoute(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
      url: proxyOrigin,
      eid: proxyPre,
      mailbox: true,
    });
    proxyHost = await startKliMailboxHost(ctx, {
      pythonCommand,
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      alias: proxyAlias,
      port: proxyPort,
    });

    await resolveTufaOobi(ctx, {
      name: delegatorName,
      base,
      headDirPath: tufaHeadDir,
      passcode: INTEROP_PASSCODE,
      url: `${proxyOrigin}/oobi/${proxyPre}/controller`,
      alias: proxyAlias,
    });
    await stopChild(proxyHost);
    proxyHost = null;
    await resolveKliOobi(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: provider.controllerOobi,
      alias: provider.alias,
    });
    await resolveKliOobi(ctx, {
      name: delegateName,
      base,
      passcode: INTEROP_PASSCODE,
      oobi: `${delegatorOrigin}/oobi/${delegatorPre}/controller`,
      alias: delegatorAlias,
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
      ({ hby, runtime }) =>
        (runtime.notifier?.count() ?? 0) >= 1 && hby.db.delegables.cnt() >= 1,
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
      ({ hby, runtime }) =>
        (runtime.notifier?.count() ?? 0) >= 2 && hby.db.delegables.cnt() >= 1,
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
