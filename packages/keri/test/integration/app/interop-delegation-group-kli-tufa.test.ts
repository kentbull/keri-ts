// @file-test-lane interop-delegation

/**
 * Focused KERIpy/Tufa group delegation interop.
 *
 * The KERIpy side is intentionally driven only through public `kli` commands.
 * The Tufa side may use Tufa runtime APIs for Tufa-owned group material, but it
 * must not open or mutate KERIpy stores.
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { action, type Operation, run } from "npm:effection@^3.6.0";
import type { SerderKERI } from "../../../../cesr/mod.ts";
import { createAgentRuntime, processRuntimeTurn, settleRuntimeIngress } from "../../../src/app/agent-runtime.ts";
import { buildCesrStreamRequest } from "../../../src/app/cesr-http.ts";
import { DELEGATE_REQUEST_ROUTE } from "../../../src/app/delegating.ts";
import { createHabery, eventPayloadMessage } from "../../../src/app/habbing.ts";
import type { Habery } from "../../../src/app/habbing.ts";
import { DELEGATE_MAILBOX_TOPIC } from "../../../src/core/mailbox-topics.ts";
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
import {
  createInteropContext,
  extractLastNonEmptyLine,
  extractPrefix,
  type InteropContext,
  requireSuccess,
  runTufaWithTimeout,
  spawnChild,
  type SpawnedChild,
  startTufaWitnessHarness,
  stopChild,
  type TufaWitnessNode,
} from "./interop-test-helpers.ts";

interface KliParticipant {
  name: string;
  base: string;
  passcode: string;
  alias: string;
  pre: string;
  witnessOobi: string;
  mailboxOobi: string;
}

interface TufaAID {
  name: string;
  base: string;
  headDirPath: string;
  passcode: string;
  alias: string;
  pre: string;
  witnessOobi: string;
  mailboxOobi: string;
}

interface TufaGeneratedGroupEvent {
  group: string;
  said: string;
  snh: string;
  serder?: SerderKERI;
  message?: Uint8Array;
}

/** Bridge a Promise into the Effection operation used by runtime helpers. */
function* awaitPromise<T>(promise: Promise<T>): Operation<T> {
  return yield* action<T>((resolve, reject) => {
    promise.then(resolve, reject);
    return () => {};
  });
}

/** Ask one Tufa witness host to receipt a serialized group event. */
function* requestTufaWitnessReceipt(
  witness: TufaWitnessNode,
  message: Uint8Array,
): Operation<Uint8Array> {
  const request = buildCesrStreamRequest(message, {
    destination: witness.pre,
  });
  const response = yield* awaitPromise(
    fetch(`${witness.httpOrigin}/receipts`, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    }),
  );
  const body = new Uint8Array(yield* awaitPromise(response.arrayBuffer()));
  if (response.status !== 200) {
    throw new Error(
      `Tufa witness ${witness.alias} did not receipt delegated group event: HTTP ${response.status} ${
        new TextDecoder().decode(body)
      }`,
    );
  }
  return body;
}

/** Parse KLI output across command variants that say either Prefix or Identifier. */
function extractKliIdentifier(output: string): string {
  try {
    return extractPrefix(output);
  } catch {
    const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith("Identifier:"));
    if (!line) {
      throw new Error(`Unable to parse identifier from output:\n${output}`);
    }
    return line.trim().split(/\s+/).at(-1)!;
  }
}

/** Generate a role-specific Tufa OOBI through the CLI. */
async function generateTufaOobi(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    alias: string;
    role: "witness" | "mailbox";
  },
): Promise<string> {
  const result = await requireSuccess(
    `${args.name} ${args.role} oobi ${args.alias}`,
    runTufaWithTimeout(
      [
        "oobi",
        "generate",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--role",
        args.role,
      ],
      ctx.env,
      ctx.repoRoot,
      20_000,
    ),
  );
  return extractLastNonEmptyLine(result.stdout);
}

/**
 * Create one witnessed KLI participant with mailbox routing enabled.
 *
 * The participant is suitable for both multisig member traffic and delegation
 * proxy delivery because witness and mailbox OOBIs are both advertised.
 */
async function createKliParticipant(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    alias: string;
    witness: TufaWitnessNode;
  },
): Promise<KliParticipant> {
  await initKliStore(ctx, {
    name: args.name,
    base: args.base,
    passcode: INTEROP_PASSCODE,
    salt: INTEROP_SALT,
  });
  await resolveKliOobi(ctx, {
    name: args.name,
    base: args.base,
    passcode: INTEROP_PASSCODE,
    oobi: args.witness.witnessOobi,
    alias: args.witness.alias,
  });
  const pre = await inceptKliAlias(ctx, {
    name: args.name,
    base: args.base,
    passcode: INTEROP_PASSCODE,
    alias: args.alias,
    wits: [args.witness.pre],
    toad: 1,
  });
  await resolveKliOobi(ctx, {
    name: args.name,
    base: args.base,
    passcode: INTEROP_PASSCODE,
    oobi: args.witness.mailboxOobi,
    alias: args.witness.alias,
  });
  const mailboxAdd = await addKliMailbox(ctx, {
    name: args.name,
    base: args.base,
    passcode: INTEROP_PASSCODE,
    alias: args.alias,
    mailbox: args.witness.alias,
  });
  assertStringIncludes(mailboxAdd.stdout, args.witness.pre);
  return {
    name: args.name,
    base: args.base,
    passcode: INTEROP_PASSCODE,
    alias: args.alias,
    pre,
    witnessOobi: `${args.witness.httpOrigin}/oobi/${pre}/witness/${args.witness.pre}`,
    mailboxOobi: await generateKliMailboxOobi(ctx, {
      name: args.name,
      base: args.base,
      passcode: INTEROP_PASSCODE,
      alias: args.alias,
    }),
  };
}

/** Teach one KLI participant how to reach another participant's mailbox. */
async function resolveKliParticipantOobis(
  ctx: InteropContext,
  participant: KliParticipant,
  remote: KliParticipant,
): Promise<void> {
  await resolveKliOobi(ctx, {
    name: participant.name,
    base: participant.base,
    passcode: participant.passcode,
    oobi: remote.mailboxOobi,
    alias: `${remote.alias}-mailbox`,
  });
}

/** Create one witnessed Tufa AID with mailbox routing enabled. */
async function createTufaAIDWithMailbox(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    alias: string;
    witness: TufaWitnessNode;
  },
): Promise<TufaAID> {
  await initTufaStore(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: INTEROP_PASSCODE,
    salt: INTEROP_SALT,
  });
  await resolveTufaOobi(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: INTEROP_PASSCODE,
    url: args.witness.witnessOobi,
    alias: args.witness.alias,
  });
  const pre = await inceptTufaAlias(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: INTEROP_PASSCODE,
    alias: args.alias,
    wits: [args.witness.pre],
    toad: 1,
  });
  await resolveTufaOobi(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: INTEROP_PASSCODE,
    url: args.witness.mailboxOobi,
    alias: args.witness.alias,
  });
  const mailboxAdd = await addTufaMailbox(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: INTEROP_PASSCODE,
    alias: args.alias,
    mailbox: args.witness.alias,
  });
  assertStringIncludes(mailboxAdd.stdout, args.witness.pre);
  return {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: INTEROP_PASSCODE,
    alias: args.alias,
    pre,
    witnessOobi: await generateTufaOobi(ctx, {
      name: args.name,
      base: args.base,
      headDirPath: args.headDirPath,
      passcode: INTEROP_PASSCODE,
      alias: args.alias,
      role: "witness",
    }),
    mailboxOobi: await generateTufaMailboxOobi(ctx, {
      name: args.name,
      base: args.base,
      headDirPath: args.headDirPath,
      passcode: INTEROP_PASSCODE,
      alias: args.alias,
    }),
  };
}

/** Teach a Tufa controller how to reach a KLI participant mailbox. */
async function resolveTufaKnownKliParticipant(
  ctx: InteropContext,
  tufa: TufaAID,
  participant: KliParticipant,
): Promise<void> {
  await resolveTufaOobi(ctx, {
    name: tufa.name,
    base: tufa.base,
    headDirPath: tufa.headDirPath,
    passcode: tufa.passcode,
    url: participant.mailboxOobi,
    alias: `${participant.alias}-mailbox`,
  });
}

/** Teach a KLI participant how to reach a Tufa controller mailbox. */
async function resolveKliKnownTufaAID(
  ctx: InteropContext,
  kli: KliParticipant | {
    name: string;
    base: string;
    passcode: string;
  },
  tufa: TufaAID,
): Promise<void> {
  await resolveKliOobi(ctx, {
    name: kli.name,
    base: kli.base,
    passcode: kli.passcode,
    oobi: tufa.mailboxOobi,
    alias: `${tufa.alias}-mailbox`,
  });
}

/** Write the KLI multisig config that delegates the group to a Tufa AID. */
async function writeKliMultisigConfig(args: {
  member1: KliParticipant;
  member2: KliParticipant;
  witness: TufaWitnessNode;
  delpre: string;
}): Promise<string> {
  const file = await Deno.makeTempFile({
    prefix: "kli-group-delegation-",
    suffix: ".json",
  });
  await Deno.writeTextFile(
    file,
    JSON.stringify(
      {
        transferable: true,
        aids: [args.member1.pre, args.member2.pre],
        rmids: [args.member1.pre, args.member2.pre],
        isith: "2",
        nsith: "2",
        toad: 1,
        wits: [args.witness.pre],
        delpre: args.delpre,
      },
      null,
      2,
    ),
  );
  return file;
}

/** Start the KLI multisig join side and leave it running until completion. */
function spawnKliMultisigJoin(
  ctx: InteropContext,
  participant: KliParticipant,
  groupAlias: string,
): SpawnedChild {
  return spawnChild(
    ctx.kliCommand,
    [
      "multisig",
      "join",
      "--name",
      participant.name,
      "--base",
      participant.base,
      "--passcode",
      participant.passcode,
      "--group",
      groupAlias,
      "--auto",
    ],
    ctx.env,
  );
}

/** Start the KLI multisig incept side and leave it running until completion. */
function spawnKliMultisigIncept(
  ctx: InteropContext,
  participant: KliParticipant,
  groupAlias: string,
  configFile: string,
): SpawnedChild {
  return spawnChild(
    ctx.kliCommand,
    [
      "multisig",
      "incept",
      "--name",
      participant.name,
      "--base",
      participant.base,
      "--passcode",
      participant.passcode,
      "--alias",
      participant.alias,
      "--group",
      groupAlias,
      "--file",
      configFile,
      "--wait",
      "60",
    ],
    ctx.env,
  );
}

/**
 * Build the full KLI group-delegate to Tufa-delegator fixture.
 *
 * This uses only public KLI commands for the KERIpy side, then resolves enough
 * cross-OOBIs for multisig coordination, mailbox transport, and delegation
 * confirmation to run without hidden store mutations.
 */
async function setupKliGroupDelegateToTufaDelegator(args: {
  ctx: InteropContext;
  base: string;
  headDirPath: string;
  aliases: readonly [string, string, string];
}): Promise<{
  delegator: TufaAID;
  member1: KliParticipant;
  member2: KliParticipant;
  configFile: string;
  close(): Promise<void>;
}> {
  const witnessHarness = await startTufaWitnessHarness(args.ctx, {
    aliases: args.aliases,
  });
  try {
    const delegatorWitness = witnessHarness.node(args.aliases[0]);
    const member1Witness = witnessHarness.node(args.aliases[1]);
    const member2Witness = witnessHarness.node(args.aliases[2]);
    const delegator = await createTufaAIDWithMailbox(args.ctx, {
      name: `tufa-group-delegator-${crypto.randomUUID().slice(0, 8)}`,
      base: args.base,
      headDirPath: args.headDirPath,
      alias: "delegator",
      witness: delegatorWitness,
    });
    const member1 = await createKliParticipant(args.ctx, {
      name: `kli-group-member1-${crypto.randomUUID().slice(0, 8)}`,
      base: args.base,
      alias: "member1",
      witness: member1Witness,
    });
    const member2 = await createKliParticipant(args.ctx, {
      name: `kli-group-member2-${crypto.randomUUID().slice(0, 8)}`,
      base: args.base,
      alias: "member2",
      witness: member2Witness,
    });

    await resolveKliParticipantOobis(args.ctx, member1, member2);
    await resolveKliParticipantOobis(args.ctx, member2, member1);
    await resolveKliKnownTufaAID(args.ctx, member1, delegator);
    await resolveKliKnownTufaAID(args.ctx, member2, delegator);
    await resolveTufaKnownKliParticipant(args.ctx, delegator, member1);
    await resolveTufaKnownKliParticipant(args.ctx, delegator, member2);

    const groupWitness = member1Witness;
    await resolveKliOobi(args.ctx, {
      name: member2.name,
      base: member2.base,
      passcode: member2.passcode,
      oobi: groupWitness.witnessOobi,
      alias: groupWitness.alias,
    });
    await resolveTufaOobi(args.ctx, {
      name: delegator.name,
      base: delegator.base,
      headDirPath: delegator.headDirPath,
      passcode: delegator.passcode,
      url: groupWitness.witnessOobi,
      alias: groupWitness.alias,
    });
    const configFile = await writeKliMultisigConfig({
      member1,
      member2,
      witness: groupWitness,
      delpre: delegator.pre,
    });

    return {
      delegator,
      member1,
      member2,
      configFile,
      close: async () => {
        await witnessHarness.close();
      },
    };
  } catch (error) {
    await witnessHarness.close();
    throw error;
  }
}

/** Wait until the Tufa delegator has escrowed the KLI group event in `delegables`. */
async function waitForTufaDelegable(
  delegator: TufaAID,
): Promise<TufaGeneratedGroupEvent> {
  let event: TufaGeneratedGroupEvent | null = null;
  await pumpTufaRuntimeUntil(
    delegator,
    ({ hby }) => {
      for (const [keys, said] of hby.db.delegables.getTopItemIter()) {
        const group = keys[0];
        if (!group) {
          continue;
        }
        const serder = hby.db.getEvtSerder(group, said);
        if (!serder?.said || !serder.snh) {
          continue;
        }
        event = { group, said: serder.said, snh: serder.snh };
        return true;
      }
      return false;
    },
    { maxTurns: 256 },
  );
  if (!event) {
    throw new Error("Expected a Tufa delegable group event.");
  }
  return event;
}

/** Approve the current Tufa `delegables` item through the CLI confirmation path. */
async function approveTufaDelegableWithTufaCli(
  ctx: InteropContext,
  delegator: TufaAID,
): Promise<void> {
  const result = await requireSuccess(
    "tufa delegate confirm group dip",
    runTufaWithTimeout(
      [
        "delegate",
        "confirm",
        "--name",
        delegator.name,
        "--base",
        delegator.base,
        "--head-dir",
        delegator.headDirPath,
        "--passcode",
        delegator.passcode,
        "--alias",
        delegator.alias,
        "--interact",
      ],
      ctx.env,
      ctx.repoRoot,
      45_000,
    ),
  );
  assertStringIncludes(result.stdout, "Approved delegated dip");
}

/** Wait for both KLI multisig processes and require them to agree on the group AID. */
async function waitForKliGroupCompletion(args: {
  member1: KliParticipant;
  member2: KliParticipant;
  incept: SpawnedChild;
  join: SpawnedChild;
}): Promise<string> {
  const [inceptOutput, joinOutput] = await Promise.all([
    waitForChildSuccess("kli multisig group incept", args.incept, 120_000),
    waitForChildSuccess("kli multisig group join", args.join, 120_000),
  ]);
  const inceptPrefix = extractKliIdentifier(inceptOutput);
  const joinPrefix = extractKliIdentifier(joinOutput);
  assertEquals(joinPrefix, inceptPrefix);
  return inceptPrefix;
}

/** Generate a Tufa group event without accepting it so the test can wire receipts. */
function makeTufaGeneratedGroupEvent(
  hby: Habery,
  args: {
    member1Alias: string;
    member2Alias: string;
    groupAlias: string;
    delpre: string;
    witness?: string;
  },
): TufaGeneratedGroupEvent {
  const member1 = hby.habByName(args.member1Alias);
  const member2 = hby.habByName(args.member2Alias);
  if (!member1 || !member2) {
    throw new Error("Expected local Tufa group members.");
  }
  const group = hby.makeGroupHab(
    args.groupAlias,
    member1,
    [member1.pre, member2.pre],
    [member1.pre, member2.pre],
    undefined,
    {
      isith: "2",
      nsith: "2",
      toad: args.witness ? 1 : 0,
      wits: args.witness ? [args.witness] : [],
      delpre: args.delpre,
    },
  );
  if (!group.serder.pre || !group.serder.said || !group.serder.snh) {
    throw new Error("Expected generated group event pre, said, and snh.");
  }
  return {
    group: group.serder.pre,
    said: group.serder.said,
    snh: group.serder.snh,
    serder: group.serder,
    message: group.message,
  };
}

/**
 * Generate a Tufa delegated group event and post the request to a KLI delegator.
 *
 * The event is optionally receipted by a live Tufa witness first, then sent both
 * as an embedded delegation request and as raw mailbox bytes so the KLI side can
 * satisfy the same event-payload and replay paths it uses in production.
 */
async function postTufaGroupDelegationRequest(args: {
  store: TufaAID;
  member1Alias: string;
  member2Alias: string;
  groupAlias: string;
  delegatorPre: string;
  witness?: TufaWitnessNode;
}): Promise<TufaGeneratedGroupEvent> {
  return await run(function*() {
    const hby = yield* createHabery({
      name: args.store.name,
      base: args.store.base,
      headDirPath: args.store.headDirPath,
      bran: args.store.passcode,
      skipConfig: true,
      skipSignator: false,
    });
    try {
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      try {
        const member1 = hby.habByName(args.member1Alias);
        const member2 = hby.habByName(args.member2Alias);
        if (!member1 || !member2) {
          throw new Error("Expected local Tufa group members.");
        }
        const group = makeTufaGeneratedGroupEvent(hby, {
          member1Alias: args.member1Alias,
          member2Alias: args.member2Alias,
          groupAlias: args.groupAlias,
          delpre: args.delegatorPre,
          witness: args.witness?.pre,
        });
        const message = group.message;
        if (!message) {
          throw new Error("Expected Tufa group delegation message bytes.");
        }
        // Witness receipts are ingested before extracting the wire payload so
        // the embedded event includes the indexed witness signatures that KLI
        // expects for a witnessed delegated group inception.
        const receiptMessage = args.witness
          ? yield* requestTufaWitnessReceipt(args.witness, message)
          : null;
        if (receiptMessage) {
          settleRuntimeIngress(runtime, [receiptMessage], { local: false });
        }
        let wireMessage = message;
        if (receiptMessage) {
          if (!group.serder) {
            throw new Error("Expected Tufa group event serder.");
          }
          wireMessage = eventPayloadMessage(hby, group.serder);
        }
        yield* runtime.poster.sendExchange(member1, {
          recipient: args.delegatorPre,
          exchangeRecipient: null,
          route: DELEGATE_REQUEST_ROUTE,
          payload: {
            delpre: args.delegatorPre,
            aids: [member1.pre, member2.pre],
          },
          topic: DELEGATE_MAILBOX_TOPIC,
          embeds: { evt: wireMessage },
        });
        yield* runtime.poster.sendBytes(member1, {
          recipient: args.delegatorPre,
          topic: DELEGATE_MAILBOX_TOPIC,
          message: wireMessage,
        });
        yield* processRuntimeTurn(runtime, {
          hab: member1,
          pollMailbox: true,
        });
        return group;
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close();
    }
  });
}

/** Create a KLI delegator through the participant helper for naming clarity. */
async function createKliDelegatorWithMailbox(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    alias: string;
    witness: TufaWitnessNode;
  },
): Promise<KliParticipant> {
  return await createKliParticipant(ctx, args);
}

Deno.test("Interop delegation: KLI GroupHab delegated inception reaches Tufa approval escrow through public KLI multisig", async () => {
  const ctx = await createInteropContext();
  const fixture = await setupKliGroupDelegateToTufaDelegator({
    ctx,
    base: `group-kli-tufa-escrow-${crypto.randomUUID().slice(0, 8)}`,
    headDirPath: `${ctx.home}/group-kli-tufa-escrow-head`,
    aliases: ["gwan", "gwil", "gwes"],
  });
  const groupAlias = "delegate-group";
  let join: SpawnedChild | null = null;
  let incept: SpawnedChild | null = null;

  try {
    join = spawnKliMultisigJoin(ctx, fixture.member2, groupAlias);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    incept = spawnKliMultisigIncept(
      ctx,
      fixture.member1,
      groupAlias,
      fixture.configFile,
    );

    const delegable = await waitForTufaDelegable(fixture.delegator);
    assertEquals(delegable.snh, "0");
    assertEquals(
      await inspectTufaHabery(
        fixture.delegator,
        (hby) => hby.db.getKever(delegable.group)?.sn ?? null,
      ),
      null,
    );
    assertEquals(
      await inspectTufaHabery(
        fixture.delegator,
        (hby) => [...hby.db.delegables.getTopItemIter()].length,
      ),
      1,
    );
  } finally {
    if (join) {
      await stopChild(join);
    }
    if (incept) {
      await stopChild(incept);
    }
    await fixture.close();
  }
});

Deno.test("Interop delegation: Tufa approval completes a public KLI GroupHab delegated inception", async () => {
  const ctx = await createInteropContext();
  const fixture = await setupKliGroupDelegateToTufaDelegator({
    ctx,
    base: `group-kli-tufa-complete-${crypto.randomUUID().slice(0, 8)}`,
    headDirPath: `${ctx.home}/group-kli-tufa-complete-head`,
    aliases: ["cwan", "cwil", "cwes"],
  });
  const groupAlias = "delegate-group";
  let join: SpawnedChild | null = null;
  let incept: SpawnedChild | null = null;

  try {
    join = spawnKliMultisigJoin(ctx, fixture.member2, groupAlias);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    incept = spawnKliMultisigIncept(
      ctx,
      fixture.member1,
      groupAlias,
      fixture.configFile,
    );

    const delegable = await waitForTufaDelegable(fixture.delegator);
    await approveTufaDelegableWithTufaCli(ctx, fixture.delegator);
    const groupPre = await waitForKliGroupCompletion({
      member1: fixture.member1,
      member2: fixture.member2,
      incept,
      join,
    });
    incept = null;
    join = null;

    assertEquals(groupPre, delegable.group);
    assertEquals(
      await inspectTufaHabery(
        fixture.delegator,
        (hby) => hby.db.getKever(groupPre)?.sn ?? null,
      ),
      0,
    );
    assertEquals(
      await inspectCompatKeverSn(ctx, fixture.member1, groupPre),
      0,
    );
    assertEquals(
      await inspectCompatKeverSn(ctx, fixture.member2, groupPre),
      0,
    );
  } finally {
    if (join) {
      await stopChild(join);
    }
    if (incept) {
      await stopChild(incept);
    }
    await fixture.close();
  }
});

Deno.test("Interop delegation: public KLI approval completes a Tufa-generated delegated group inception", async () => {
  const ctx = await createInteropContext();
  const base = `group-tufa-kli-${crypto.randomUUID().slice(0, 8)}`;
  const headDirPath = `${ctx.home}/group-tufa-kli-head`;
  const witnessHarness = await startTufaWitnessHarness(ctx, {
    aliases: ["twan", "twil", "twes"],
  });
  let confirm: SpawnedChild | null = null;

  try {
    const delegator = await createKliDelegatorWithMailbox(ctx, {
      name: `kli-group-delegator-${crypto.randomUUID().slice(0, 8)}`,
      base,
      alias: "delegator",
      witness: witnessHarness.node("twan"),
    });
    const member1 = await createTufaAIDWithMailbox(ctx, {
      name: `tufa-group-members-${crypto.randomUUID().slice(0, 8)}`,
      base,
      headDirPath,
      alias: "member1",
      witness: witnessHarness.node("twil"),
    });
    await resolveTufaOobi(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      url: witnessHarness.node("twes").witnessOobi,
      alias: witnessHarness.node("twes").alias,
    });
    const member2Pre = await inceptTufaAlias(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      alias: "member2",
      wits: [witnessHarness.node("twes").pre],
      toad: 1,
    });
    await resolveTufaOobi(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      url: witnessHarness.node("twes").mailboxOobi,
      alias: witnessHarness.node("twes").alias,
    });
    await addTufaMailbox(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      alias: "member2",
      mailbox: witnessHarness.node("twes").alias,
    });
    const member2: TufaAID = {
      ...member1,
      alias: "member2",
      pre: member2Pre,
      witnessOobi: await generateTufaOobi(ctx, {
        name: member1.name,
        base,
        headDirPath,
        passcode: INTEROP_PASSCODE,
        alias: "member2",
        role: "witness",
      }),
      mailboxOobi: await generateTufaMailboxOobi(ctx, {
        name: member1.name,
        base,
        headDirPath,
        passcode: INTEROP_PASSCODE,
        alias: "member2",
      }),
    };

    await resolveTufaOobi(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      url: delegator.witnessOobi,
      alias: `${delegator.alias}-witness`,
    });
    await resolveTufaOobi(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      url: delegator.mailboxOobi,
      alias: `${delegator.alias}-mailbox`,
    });
    await resolveKliKnownTufaAID(ctx, delegator, member1);
    await resolveKliKnownTufaAID(ctx, delegator, member2);

    const group = await postTufaGroupDelegationRequest({
      store: member1,
      member1Alias: "member1",
      member2Alias: "member2",
      groupAlias: "tufa-generated-group",
      delegatorPre: delegator.pre,
      witness: witnessHarness.node("twes"),
    });
    confirm = spawnChild(
      ctx.kliCommand,
      [
        "delegate",
        "confirm",
        "--name",
        delegator.name,
        "--base",
        delegator.base,
        "--passcode",
        delegator.passcode,
        "--alias",
        delegator.alias,
        "--interact",
        "--auto",
      ],
      ctx.env,
    );
    const confirmOutput = await waitForChildSuccess(
      "kli delegate confirm tufa group dip",
      confirm,
      90_000,
    );
    confirm = null;
    assertStringIncludes(confirmOutput, "inception event committed");

    await resolveTufaOobi(ctx, {
      name: member1.name,
      base,
      headDirPath,
      passcode: INTEROP_PASSCODE,
      url: delegator.witnessOobi,
      alias: `${delegator.alias}-witness-after-approval`,
    });
    await pumpTufaRuntimeUntil(
      member1,
      ({ hby }) => hby.db.getKever(group.group)?.sn === 0,
      { maxTurns: 256 },
    );

    assertEquals(
      await inspectTufaHabery(
        member1,
        (hby) => hby.db.getKever(group.group)?.sn ?? null,
      ),
      0,
    );
    assertEquals(
      await inspectCompatKeverSn(ctx, delegator, group.group),
      0,
    );
  } finally {
    if (confirm) {
      await stopChild(confirm);
    }
    await witnessHarness.close();
  }
});
