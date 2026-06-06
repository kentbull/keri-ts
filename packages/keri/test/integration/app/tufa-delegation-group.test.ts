// @file-test-lane runtime-medium

/**
 * Tufa-only delegation matrix for single and group AIDs.
 *
 * These scenarios exercise the same issue-hold-approve protocol seams as the
 * live KLI/Tufa tests without subprocess cost: delegation requests arrive over
 * an explicit communication AID, local delegators escrow into `delegables`,
 * approval pins source-seal hints, and replayed delegator KELs release partial
 * delegation escrow for the delegate.
 */
import { run } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes, Counter, CtrDexV1, Diger, SerderKERI, Siger } from "../../../../cesr/mod.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
} from "../../../src/app/agent-runtime.ts";
import { DELEGATE_REQUEST_ROUTE } from "../../../src/app/delegating.ts";
import { createHabery, eventPayloadMessage, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { receipt as receiptEvent } from "../../../src/core/protocol-eventing.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

type AidProfile =
  | { kind: "single" }
  | { kind: "group"; memberCount: 2; threshold: 2 }
  | { kind: "group"; memberCount: 3; threshold: 2 };

interface WitnessFixture {
  hby: Habery;
  hab: Hab;
}

interface ControlledAid {
  hby: Habery;
  hab: Hab;
  pre: string;
  serder: SerderKERI;
  communicationHab: Hab;
  members: Hab[];
  witnesses: WitnessFixture[];
}

interface MatrixCase {
  label: string;
  delegator: AidProfile;
  delegate: AidProfile;
  witnessed: boolean;
}

const MATRIX: readonly MatrixCase[] = [
  {
    label: "single delegator approves 2-of-2 group delegate",
    delegator: { kind: "single" },
    delegate: { kind: "group", memberCount: 2, threshold: 2 },
    witnessed: false,
  },
  {
    label: "2-of-2 group delegator approves single delegate",
    delegator: { kind: "group", memberCount: 2, threshold: 2 },
    delegate: { kind: "single" },
    witnessed: false,
  },
  {
    label: "2-of-2 group delegator approves 2-of-2 group delegate",
    delegator: { kind: "group", memberCount: 2, threshold: 2 },
    delegate: { kind: "group", memberCount: 2, threshold: 2 },
    witnessed: false,
  },
  {
    label: "witnessed 2-of-3 group delegator approves witnessed 2-of-3 group delegate",
    delegator: { kind: "group", memberCount: 3, threshold: 2 },
    delegate: { kind: "group", memberCount: 3, threshold: 2 },
    witnessed: true,
  },
];

/** Resolve an accepted or escrowed event serder by prefix/sequence number. */
function eventSerderFor(hby: Habery, pre: string, sn = 0): SerderKERI {
  const said = hby.db.kels.getLast(pre, sn)
    ?? hby.db.pdes.getOn(pre, sn)[0]
    ?? hby.db.delegables.get([pre])[0];
  assertExists(said);
  const serder = hby.db.getEvtSerder(pre, said);
  assertExists(serder);
  return serder;
}

/** Convert an event serder into the anchor data carried by delegator events. */
function eventAnchor(serder: SerderKERI): { i: string; s: string; d: string } {
  assertExists(serder.pre);
  assertExists(serder.snh);
  assertExists(serder.said);
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

/**
 * Attach synthetic witness indexed receipts to a local event.
 *
 * This keeps the matrix focused on delegation behavior while still proving
 * that witnessed delegated events carry and replay witness receipt attachments.
 */
function storeWitnessIndexedReceipts(
  hby: Habery,
  serder: SerderKERI,
  witnesses: readonly WitnessFixture[],
): void {
  if (witnesses.length === 0) {
    return;
  }
  assertExists(serder.pre);
  assertExists(serder.said);
  if (serder.sn === null) {
    throw new Error("Expected event sequence number for witness receipt.");
  }
  const reserder = receiptEvent(serder.pre, serder.sn, serder.said);
  for (const witness of witnesses) {
    hby.kevery.processReceipt({
      serder: reserder,
      cigars: [],
      wigers: witness.hab.sign(serder.raw, true) as Siger[],
      tsgs: [],
      local: false,
    });
  }
  hby.kevery.processEscrowUnverWitness();
  hby.kevery.processEscrowPartialWigs();
  assertEquals(
    hby.db.wigs.get(dgKey(serder.pre, serder.said)).length,
    witnesses.length,
  );
}

function witnessCounter(count: number): string {
  return new TextDecoder().decode(
    new Counter({
      code: CtrDexV1.WitnessIdxSigs,
      count,
      version: { major: 1, minor: 0 },
    }).qb64b,
  );
}

/** Assert that a replayed message contains the expected witness signature group. */
function assertHasWitnessIndexedSigs(message: Uint8Array, count: number): void {
  const serder = new SerderKERI({ raw: message });
  assertStringIncludes(
    new TextDecoder().decode(message.slice(serder.size)),
    witnessCounter(count),
  );
}

/** Build the `/delegate/request` exchange message used by delegation handlers. */
function delegationRequestMessage(
  sender: Hab,
  delpre: string,
  eventPayload: Uint8Array,
  aids: readonly string[] = [],
): Uint8Array {
  const [serder, attachments] = exchangeMessage(
    DELEGATE_REQUEST_ROUTE,
    {
      delpre,
      ...(aids.length > 0 ? { aids: [...aids] } : {}),
    },
    {
      sender: sender.pre,
      embeds: { evt: eventPayload },
    },
  );
  return concatBytes(
    sender.endorse(serder, { pipelined: false }),
    attachments,
  );
}

function createSingleAid(
  hby: Habery,
  alias: string,
  {
    delpre,
    witnesses = [],
    communicationHab,
  }: {
    delpre?: string;
    witnesses?: readonly WitnessFixture[];
    communicationHab?: Hab;
  } = {},
): ControlledAid {
  const hab = hby.makeHab(alias, undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    wits: witnesses.map((witness) => witness.hab.pre),
    toad: witnesses.length,
    delpre,
  });
  const serder = eventSerderFor(hby, hab.pre, 0);
  storeWitnessIndexedReceipts(hby, serder, witnesses);
  return {
    hby,
    hab,
    pre: hab.pre,
    serder,
    communicationHab: communicationHab ?? hab,
    members: [],
    witnesses: [...witnesses],
  };
}

function createGroupAid(
  hby: Habery,
  alias: string,
  profile: Extract<AidProfile, { kind: "group" }>,
  {
    delpre,
    witnesses = [],
  }: {
    delpre?: string;
    witnesses?: readonly WitnessFixture[];
  } = {},
): ControlledAid {
  const members = Array.from(
    { length: profile.memberCount },
    (_, index) =>
      hby.makeHab(`${alias}-member${index + 1}`, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }),
  );
  const group = hby.makeGroupHab(
    alias,
    members[0]!,
    members.map((member) => member.pre),
    members.map((member) => member.pre),
    undefined,
    {
      isith: profile.threshold.toString(16),
      nsith: profile.threshold.toString(16),
      toad: witnesses.length,
      wits: witnesses.map((witness) => witness.hab.pre),
      delpre,
    },
  );
  storeWitnessIndexedReceipts(hby, group.serder, witnesses);
  return {
    hby,
    hab: group.hab,
    pre: group.hab.pre,
    serder: group.serder,
    communicationHab: members[0]!,
    members,
    witnesses: [...witnesses],
  };
}

/** Create either a single-key or multisig local AID for the scenario matrix. */
function createControlledAid(
  hby: Habery,
  alias: string,
  profile: AidProfile,
  options: {
    delpre?: string;
    witnesses?: readonly WitnessFixture[];
    communicationHab?: Hab;
  } = {},
): ControlledAid {
  if (profile.kind === "single") {
    return createSingleAid(hby, alias, options);
  }
  return createGroupAid(hby, alias, profile, options);
}

/** Advance one runtime without polling mailboxes for a bounded number of turns. */
function* drainRuntime(
  runtime: AgentRuntime,
  hab: Hab,
  turns = 8,
) {
  for (let i = 0; i < turns; i += 1) {
    yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });
  }
}

/** Inject serialized messages and drain the runtime so escrows can settle. */
function* ingestMessages(
  runtime: AgentRuntime,
  hab: Hab,
  messages: Iterable<Uint8Array>,
  turns = 8,
) {
  for (const message of messages) {
    ingestKeriBytes(runtime, message);
  }
  yield* drainRuntime(runtime, hab, turns);
}

/** Replay one accepted KEL from a source store into a target runtime. */
function* transferAcceptedKel(
  source: Habery,
  target: AgentRuntime,
  targetHab: Hab,
  pre: string,
) {
  yield* ingestMessages(target, targetHab, source.db.clonePreIter(pre), 12);
}

/**
 * Approve one locally escrowed delegated event as a delegator.
 *
 * The explicit `.aess` pin mirrors the source-seal attachment that live
 * delegate confirmation sends after the delegator interaction is accepted.
 */
function approveDelegable(
  delegator: ControlledAid,
  delegated: ControlledAid,
): SerderKERI {
  delegator.hab.interact({ data: [eventAnchor(delegated.serder)] });
  const approving = eventSerderFor(
    delegator.hby,
    delegator.pre,
    delegator.hab.kever?.sn ?? 1,
  );
  storeWitnessIndexedReceipts(delegator.hby, approving, delegator.witnesses);
  assertExists(approving.sner);
  assertExists(approving.said);
  assertExists(delegated.serder.pre);
  assertExists(delegated.serder.said);
  delegator.hby.db.aess.pin(
    dgKey(delegated.serder.pre, delegated.serder.said),
    [approving.sner, new Diger({ qb64: approving.said })],
  );
  delegator.hby.kevery.processEscrowDelegables();
  return approving;
}

for (const spec of MATRIX) {
  Deno.test(`Tufa-only group delegation matrix: ${spec.label}`, async () => {
    await run(function*() {
      const delegatorHby = yield* createHabery({
        name: `tufa-matrix-delegator-${crypto.randomUUID()}`,
        temp: true,
      });
      const delegateHby = yield* createHabery({
        name: `tufa-matrix-delegate-${crypto.randomUUID()}`,
        temp: true,
      });
      const delegatorWitnessHby = yield* createHabery({
        name: `tufa-matrix-delegator-witness-${crypto.randomUUID()}`,
        temp: true,
      });
      const delegateWitnessHby = yield* createHabery({
        name: `tufa-matrix-delegate-witness-${crypto.randomUUID()}`,
        temp: true,
      });

      const delegatorRuntime = yield* createAgentRuntime(delegatorHby, {
        mode: "local",
      });
      const delegateRuntime = yield* createAgentRuntime(delegateHby, {
        mode: "local",
      });

      try {
        const delegatorWitnesses = spec.witnessed
          ? [{
            hby: delegatorWitnessHby,
            hab: delegatorWitnessHby.makeHab("delegator-witness", undefined, {
              transferable: false,
              icount: 1,
              isith: "1",
              toad: 0,
            }),
          }]
          : [];
        const delegateWitnesses = spec.witnessed
          ? [{
            hby: delegateWitnessHby,
            hab: delegateWitnessHby.makeHab("delegate-witness", undefined, {
              transferable: false,
              icount: 1,
              isith: "1",
              toad: 0,
            }),
          }]
          : [];

        const delegator = createControlledAid(
          delegatorHby,
          "delegator",
          spec.delegator,
          { witnesses: delegatorWitnesses },
        );
        const delegateProxy = delegateHby.makeHab("delegate-proxy", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const delegated = createControlledAid(
          delegateHby,
          "delegate",
          spec.delegate,
          {
            delpre: delegator.pre,
            witnesses: delegateWitnesses,
            communicationHab: delegateProxy,
          },
        );
        // Group delegates communicate through a member/proxy AID rather than
        // the group prefix itself, matching the live IPEX-style proxy path.
        const requestSender = spec.delegate.kind === "single"
          ? delegateProxy
          : delegated.communicationHab;

        yield* transferAcceptedKel(
          delegateHby,
          delegatorRuntime,
          delegator.hab,
          requestSender.pre,
        );

        const delegatedPayload = eventPayloadMessage(
          delegateHby,
          delegated.serder,
        );
        if (spec.witnessed) {
          assertHasWitnessIndexedSigs(delegatedPayload, 1);
        }

        const requestMessage = delegationRequestMessage(
          requestSender,
          delegator.pre,
          delegatedPayload,
          delegated.members.map((member) => member.pre),
        );
        yield* ingestMessages(
          delegatorRuntime,
          delegator.hab,
          [requestMessage, delegatedPayload],
          16,
        );

        assertEquals(
          delegatorHby.db.delegables.get([delegated.pre]),
          [delegated.serder.said],
        );
        assertEquals(delegatorHby.db.getKever(delegated.pre), null);
        if (spec.delegate.kind === "group") {
          assertEquals(delegateHby.db.getKever(delegated.pre), null);
        }

        const approving = approveDelegable(delegator, delegated);
        assertEquals(delegatorHby.db.delegables.get([delegated.pre]), []);
        assertEquals(delegatorHby.db.getKever(delegated.pre)?.sn, 0);

        const delegatorReplay = [
          ...delegatorHby.db.clonePreIter(delegator.pre),
        ];
        assertEquals(delegatorReplay.length >= 2, true);
        if (spec.witnessed) {
          assertHasWitnessIndexedSigs(delegatorReplay.at(-1)!, 1);
        }

        yield* ingestMessages(delegateRuntime, delegated.communicationHab, [
          ...delegatorReplay,
        ], 24);

        assertEquals(delegateHby.db.getKever(delegated.pre)?.sn, 0);
        assertEquals(
          delegateHby.db.getKever(delegated.pre)?.delpre,
          delegator.pre,
        );
        assertEquals(delegateHby.db.pdes.cntOn(delegated.pre, 0), 0);
        assertExists(
          delegateHby.db.aess.get(
            dgKey(delegated.serder.pre!, delegated.serder.said!),
          ),
        );
        assertEquals(approving.ilk, "ixn");
      } finally {
        yield* delegateRuntime.close();
        yield* delegatorRuntime.close();
        yield* delegateWitnessHby.close(true);
        yield* delegatorWitnessHby.close(true);
        yield* delegateHby.close(true);
        yield* delegatorHby.close(true);
      }
    });
  });
}
