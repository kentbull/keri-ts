// @file-test-lane interop-delegation

/**
 * Cross-implementation delegation matrix.
 *
 * Current executable rows:
 * - Tufa delegate -> KLI delegator, single-key and 2-of-2 threshold
 *   delegate profiles, witness-mailbox transport plus witness-backed
 *   delegator approval discovery, explicit proxy, `dip` + `drt`
 * - KLI delegate -> Tufa delegator, single-key and 2-of-2 threshold delegate
 *   profiles, witness-mailbox transport, explicit proxy, `dip` + `drt`
 *
 * This file intentionally proves the real durable seams:
 * - witness-hosted mailbox OOBIs for delegated controller-to-controller transport
 * - witness OOBIs for witness-backed delegate inception/rotation
 * - Tufa `delegables` as the protocol source for `delegate confirm`
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  addKliMailbox,
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
  waitForChildSuccess,
} from "./interop-delegation-helpers.ts";
import { stopChild } from "./interop-test-helpers.ts";
import {
  createInteropContext,
  extractPrefix,
  requireSuccess,
  runCmd,
  runCmdWithTimeout,
  runTufaWithTimeout,
  spawnChild,
  startTufaWitnessHarness,
} from "./interop-test-helpers.ts";

/** JSON shape emitted by the Tufa notifications CLI in delegation scenarios. */
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

/** Delegate key material profile used to exercise single-key and threshold paths. */
interface DelegateKeyProfile {
  label: string;
  inceptIsith: string;
  inceptIcount: string;
  nextNsith: string;
  nextNcount: string;
}

const DELEGATE_KEY_PROFILES: readonly DelegateKeyProfile[] = [
  {
    label: "single-key",
    inceptIsith: "1",
    inceptIcount: "1",
    nextNsith: "1",
    nextNcount: "1",
  },
  {
    label: "2-of-2-threshold",
    inceptIsith: "2",
    inceptIcount: "2",
    nextNsith: "2",
    nextNcount: "2",
  },
];

/** Expected number of local signing keys generated for a delegate profile. */
function expectedSigningKeyCount(profile: DelegateKeyProfile): number {
  return Number.parseInt(profile.inceptIcount, 10);
}

/** KLI rotation args that preserve the tested delegate threshold profile. */
function kliRotateKeyArgs(profile: DelegateKeyProfile): string[] {
  return [
    "--isith",
    profile.inceptIsith,
    "--nsith",
    profile.nextNsith,
    "--next-count",
    profile.nextNcount,
  ];
}

/** Read delegation notification sidecars through the public Tufa CLI. */
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

for (const profile of DELEGATE_KEY_PROFILES) {
  Deno.test(`Interop delegation: ${profile.label} tufa delegate with explicit proxy is approved and rotated by a KLI delegator over witness-mailbox transport with witness-backed approval discovery`, async () => {
    const ctx = await createInteropContext();
    let delegatedIncept: ReturnType<typeof spawnChild> | null = null;
    let delegatedRotate: ReturnType<typeof spawnChild> | null = null;
    let confirmDip: ReturnType<typeof spawnChild> | null = null;
    let confirmDrt: ReturnType<typeof spawnChild> | null = null;
    const base = `interop-delegation-tufa-kli-${profile.label}-${crypto.randomUUID().slice(0, 8)}`;
    const tufaHeadDir = `${ctx.home}/interop-delegation-tufa-kli-${profile.label}-head`;
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
        oobi: delegatorWitness.mailboxOobi,
        alias: delegatorWitness.alias,
      });
      const delegatorMailboxAdd = await addKliMailbox(ctx, {
        name: delegatorName,
        base,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
        mailbox: delegatorWitness.alias,
      });
      assertStringIncludes(delegatorMailboxAdd.stdout, delegatorWitness.pre);
      const delegatorMailboxOobi = await generateKliMailboxOobi(ctx, {
        name: delegatorName,
        base,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
      });
      assertStringIncludes(delegatorMailboxOobi, delegatorWitness.pre);

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
      // KERIpy `Anchorer` provisions the delegation communication proxy with the
      // delegate's witness set so witness-driven `replay` responses have a real
      // return path through the same witness+mailbox runtime.
      const proxyPre = await inceptTufaAlias(ctx, {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: proxyAlias,
        wits: delegateWitnesses.map((witness) => witness.pre),
        toad: 1,
      });
      await resolveTufaOobi(ctx, {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        url: delegateWitnesses[0]!.mailboxOobi,
        alias: delegateWitnesses[0]!.alias,
      });
      const proxyMailboxAdd = await addTufaMailbox(ctx, {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: proxyAlias,
        mailbox: delegateWitnesses[0]!.alias,
      });
      assertStringIncludes(
        proxyMailboxAdd.stdout,
        `added ${delegateWitnesses[0]!.pre}`,
      );
      const proxyMailboxOobi = await generateTufaMailboxOobi(ctx, {
        name: delegateName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: proxyAlias,
      });
      assertStringIncludes(proxyMailboxOobi, delegateWitnesses[0]!.pre);
      await resolveKliOobi(ctx, {
        name: delegatorName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: proxyMailboxOobi,
        alias: proxyAlias,
      });
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
          profile.inceptIsith,
          "--icount",
          profile.inceptIcount,
          "--nsith",
          profile.nextNsith,
          "--ncount",
          profile.nextNcount,
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
      assertStringIncludes(confirmDipOutput, "inception event committed");

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
            keyCount: kever?.verfers.length ?? null,
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
      assertEquals(delegateState.keyCount, expectedSigningKeyCount(profile));
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
        waitForChildSuccess("kli delegate confirm drt", confirmDrt, 60_000, {
          allowFailureIf: (output) =>
            output.includes("rotation event committed")
            && output.includes("No delegation seal"),
        }),
      ]);
      delegatedRotate = null;
      confirmDrt = null;
      assertStringIncludes(confirmDrtOutput, "rotation event committed");
      assertStringIncludes(delegatedRotateOutput, "New Sequence No.  1");
      // KERIpy main currently returns from `delegate confirm` before consuming the
      // source-sealed replay that advances the delegated rotation in its kever.
      // A mailbox poll makes that durable state catch up without patching KERIpy.
      await requireSuccess(
        `${delegatorName} poll delegate rotation replay`,
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "kevers",
            "--name",
            delegatorName,
            "--base",
            base,
            "--passcode",
            INTEROP_PASSCODE,
            "--prefix",
            delegatePre,
            "--poll",
          ],
          ctx.env,
          20_000,
        ),
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
    }
  });
}

for (const profile of DELEGATE_KEY_PROFILES) {
  Deno.test(`Interop delegation: ${profile.label} kli delegate is approved by a Tufa delegator over witness-mailbox transport`, async () => {
    const ctx = await createInteropContext();
    const base = `interop-delegation-kli-tufa-${profile.label}-${crypto.randomUUID().slice(0, 8)}`;
    const tufaHeadDir = `${ctx.home}/interop-delegation-kli-tufa-${profile.label}-head`;
    const mailboxWitnessHarness = await startTufaWitnessHarness(ctx, {
      aliases: ["mwan", "mwil"],
    });
    const delegatorMailboxWitness = mailboxWitnessHarness.node("mwan");
    const proxyMailboxWitness = mailboxWitnessHarness.node("mwil");
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
      await resolveTufaOobi(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        url: delegatorMailboxWitness.witnessOobi,
        alias: delegatorMailboxWitness.alias,
      });
      const delegatorPre = await inceptTufaAlias(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
        wits: [delegatorMailboxWitness.pre],
        toad: 1,
      });
      await resolveTufaOobi(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        url: delegatorMailboxWitness.mailboxOobi,
        alias: delegatorMailboxWitness.alias,
      });
      const delegatorMailboxAdd = await addTufaMailbox(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
        mailbox: delegatorMailboxWitness.alias,
      });
      assertStringIncludes(
        delegatorMailboxAdd.stdout,
        `added ${delegatorMailboxWitness.pre}`,
      );
      const delegatorMailboxOobi = await generateTufaMailboxOobi(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        alias: delegatorAlias,
      });
      assertStringIncludes(delegatorMailboxOobi, delegatorMailboxWitness.pre);

      const delegateName = `kli-delegate-${crypto.randomUUID().slice(0, 8)}`;
      const proxyAlias = "proxy";
      const delegateAlias = "delegate";
      await initKliStore(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        salt: INTEROP_SALT,
      });
      await resolveKliOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: proxyMailboxWitness.witnessOobi,
        alias: proxyMailboxWitness.alias,
      });
      const proxyPre = await inceptKliAlias(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        alias: proxyAlias,
      });
      await resolveKliOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: proxyMailboxWitness.mailboxOobi,
        alias: proxyMailboxWitness.alias,
      });
      const proxyMailboxAdd = await addKliMailbox(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        alias: proxyAlias,
        mailbox: proxyMailboxWitness.alias,
      });
      assertStringIncludes(proxyMailboxAdd.stdout, proxyMailboxWitness.pre);
      const proxyMailboxOobi = await generateKliMailboxOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        alias: proxyAlias,
      });
      assertStringIncludes(proxyMailboxOobi, proxyMailboxWitness.pre);

      await resolveTufaOobi(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        url: proxyMailboxWitness.witnessOobi,
        alias: proxyMailboxWitness.alias,
      });
      await resolveTufaOobi(ctx, {
        name: delegatorName,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        url: proxyMailboxOobi,
        alias: proxyAlias,
      });
      await resolveKliOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: delegatorMailboxWitness.witnessOobi,
        alias: delegatorMailboxWitness.alias,
      });
      await resolveKliOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: delegatorMailboxWitness.mailboxOobi,
        alias: delegatorMailboxWitness.alias,
      });
      await resolveKliOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: delegatorMailboxOobi,
        alias: delegatorAlias,
      });
      await resolveKliOobi(ctx, {
        name: delegateName,
        base,
        passcode: INTEROP_PASSCODE,
        oobi: `${delegatorMailboxWitness.httpOrigin}/oobi/${delegatorPre}/witness/${delegatorMailboxWitness.pre}`,
        alias: `${delegatorAlias}-${delegatorMailboxWitness.alias}`,
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
          profile.inceptIsith,
          "--icount",
          profile.inceptIcount,
          "--nsith",
          profile.nextNsith,
          "--ncount",
          profile.nextNcount,
          "--toad",
          "1",
          "--wits",
          proxyMailboxWitness.pre,
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
          hby.db.delegables.cnt() >= 1
          || (runtime.notifier?.count() ?? 0) >= 1,
        { maxTurns: 160 },
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
          60_000,
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
      assertEquals(
        await inspectTufaHabery(
          {
            name: delegatorName,
            base,
            headDirPath: tufaHeadDir,
            passcode: INTEROP_PASSCODE,
          },
          (hby) => hby.db.getKever(delegatePre)?.verfers.length ?? null,
        ),
        expectedSigningKeyCount(profile),
      );

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
          ...kliRotateKeyArgs(profile),
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
          hby.db.delegables.cnt() >= 1
          || (runtime.notifier?.count() ?? 0) >= 1,
        { maxTurns: 160 },
      );

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
          60_000,
        ),
      );
      assertStringIncludes(confirmDrt.stdout, "Approved delegated drt");

      const rotateOutput = await waitForChildSuccess(
        "kli delegated rotate",
        delegatedRotate,
        90_000,
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
      if (delegatedRotate) {
        await stopChild(delegatedRotate);
      }
      if (delegatedIncept) {
        await stopChild(delegatedIncept);
      }
      await mailboxWitnessHarness.close();
    }
  });
}
