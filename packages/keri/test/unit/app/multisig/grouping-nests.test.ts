/** Real nested multisig admission and approval replay; wrapper signatures never authorize child events. */
import {
  b,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  Encrypter,
  framePayload,
  makeBlindState,
  MtrDex,
  nestedPayload,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  Salter,
  SerderACDC,
  SerderKERI,
  Siger,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert";
import {
  acdcmap as acdcV2Map,
  blindate as acdcV2Blindate,
  regcept as acdcV2Regcept,
} from "../../../../src/acdc/messaging.ts";
import { deliverCredentialRevocation, revokeCredential } from "../../../../src/app/credentials/credential-revoking.ts";
import { createCredential, inceptCredentialRegistry } from "../../../../src/app/credentials/credential-workflows.ts";
import { type ExchangeInput, Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import { credentialStreamMessages, ipexCredentialGrant } from "../../../../src/app/ipex/ipex-credentialing.ts";
import {
  approveMultisigIpex,
  groupIpexPartial,
  prepareAcdcV2GroupIpex,
  publishInitialGroupIpex,
  sendCompletedGroupIpex,
} from "../../../../src/app/ipex/ipex-grouping.ts";
import { ipexApplyExn, ipexGrantExn } from "../../../../src/app/ipex/ipexing.ts";
import { groupEndorseReply } from "../../../../src/app/multisig/group-signing.ts";
import {
  acdcV2RegistryProposal,
  loadMultisigHandlers,
  Multiplexor,
  type MultisigEventProposal,
  multisigExnBody,
  multisigInceptExn,
  multisigInteractExn,
  type MultisigMessage,
  multisigPathedAttachment,
  multisigRotateExn,
  type MultisigRoute,
  multisigRpyExn,
  type MultisigVdrProposal,
  prepareMultisigEventExn,
} from "../../../../src/app/multisig/grouping.ts";
import { signGroupMessage } from "../../../../src/app/multisig/multisig-messaging.ts";
import {
  approveAcdcV2Registry,
  approvePendingMultisigProposal,
  publishProposal,
} from "../../../../src/app/multisig/multisig-workflows.ts";
import { endorseReply, inspectReplyProposal, replyContribution } from "../../../../src/app/multisig/reply-approval.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { Kevery } from "../../../../src/core/kel/eventing.ts";
import { interact as interactEvent, reply as replyEvent } from "../../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize, serializeMessage } from "../../../../src/core/protocol-serialization.ts";
import {
  incept as inceptRegistry,
  issue as issueCredential,
  revoke as revokeCredentialEvent,
} from "../../../../src/core/protocol-vdr-eventing.ts";
import { Revery } from "../../../../src/core/routing.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { loadNests } from "../../../../src/db/exchange/exchange-nests.ts";
import { Reger } from "../../../../src/db/reger.ts";
import { credential, Credentialer, Regery, serializeCredential } from "../../../../src/vdr/credentialing.ts";
import framing714 from "../../../fixtures/multisig-framing-714.json" with { type: "json" };

// @ts-expect-error Event publication cannot accept a registry proposal.
void ({ route: "/multisig/vcp", attrs: { gid: "group" } } satisfies Parameters<typeof publishProposal>[5]);
// @ts-expect-error Inception derives gid from its child instead of accepting a second identity.
void ({ route: "/multisig/icp", attrs: { gid: "group", smids: [], rmids: [] } } satisfies MultisigEventProposal);
// @ts-expect-error Rotation requires its rotation members as well as signing members.
void ({ route: "/multisig/rot", attrs: { gid: "group", smids: [] } } satisfies MultisigEventProposal);
// @ts-expect-error Reply proposals do not carry interaction member fields.
void ({ route: "/multisig/rpy", attrs: { gid: "group", smids: [] } } satisfies MultisigEventProposal);

void ({
  route: "/multisig/vcp",
  attrs: { gid: "group" },
  // @ts-expect-error Registry inception requires its anchor as well as the VCP.
  embeds: { vcp: new Uint8Array() },
} satisfies MultisigVdrProposal);
void ({
  route: "/multisig/iss",
  attrs: { gid: "group" },
  // @ts-expect-error Issuance requires the credential, TEL event and anchor together.
  embeds: { iss: new Uint8Array(), anc: new Uint8Array() },
} satisfies MultisigVdrProposal);

/** Sign just the wrapper body with its sender's accepted establishment keys. */
function proof(sender: Hab, serder: SerderKERI | SerderACDC): TransIdxSigGroup[] {
  const establishment = sender.db.getEvtSerder(sender.pre, sender.kever!.lastEst.d)!;
  return [
    new TransIdxSigGroup(
      new Prefixer({ qb64: sender.pre }),
      establishment.sner!,
      new Diger({ qb64: establishment.said! }),
      sender.sign(serder.raw, true),
    ),
  ];
}

/** Create a signed v2 wrapper around an independently signed child. */
function proposal(sender: Hab, route: string, child: CesrFrame, payload: Record<string, unknown>): ExchangeInput {
  const serder = exchange(route, { ...payload, [route.split("/").at(-1)!]: child.body.said }, {
    sender: sender.pre,
    pvrsn: Vrsn_2_0,
  })[0];
  return { serder, nests: [child], tsgs: proof(sender, serder) };
}
/** Admit complete public KEL evidence without sharing private member stores. */
async function learn(target: Habery, member: Hab): Promise<void> {
  for (const wire of member.db.clonePreIter(member.pre, 0)) {
    for (const frame of await parseBytes(wire)) {
      {
        await run(() => dispatchEnvelope(envelopeFromFrame(frame, true), target.rvy, target.kevery));
      }
    }
  }
}

/** Keep two independent participant stores and one real notifier for each scenario. */
async function participants(
  test: (left: Habery, right: Habery, alice: Hab, bob: Hab, notifier: Notifier) => void | Promise<void>,
) {
  await run(function* () {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(left);
    try {
      const alice = left.makeHab("alice");
      const bob = right.makeHab("bob");
      yield* call(() => learn(left, bob));
      yield* call(() => learn(right, alice));
      yield* call(() => test(left, right, alice, bob, new Notifier(left.signator!, { noter })));
    } finally {
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
    }
  });
}

Deno.test("multisig replay borrows the configured reply owner and its application routes", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      try {
        yield* runtime.reactor.processBytes(messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }), {
          local: true,
        });
        yield* call(() => learn(right, local.hab));
        const { kvy, rvy } = runtime.protocol;
        const accepted: string[] = [];
        rvy.rtr.addRoute("/test/group-reply", {
          processReply(args: Parameters<Revery["processReply"]>[0] & { diger: Diger; route: string }) {
            const result = rvy.acceptReply({ ...args, saider: args.diger, aid: local.hab.pre });
            if (result.kind === "accept") accepted.push(args.serder.said!);
            return result;
          },
        });
        const routes = [...rvy.rtr.routes];
        const mux = new Multiplexor(left, { notifier, kvy, rvy });
        assertStrictEquals(mux.kvy, kvy);
        assertStrictEquals(mux.rvy, rvy);
        assertEquals(rvy.rtr.routes, routes);
        const reply = replyEvent("/test/group-reply", { exact: "application data" }, { version: Vrsn_2_0 });
        const leftProof = envelopeFromFrame(parseBytes(groupEndorseReply(left, local.hab.pre, reply, Vrsn_2_0))[0]);
        const rightProof = envelopeFromFrame(parseBytes(groupEndorseReply(right, remote.hab.pre, reply, Vrsn_2_0))[0]);
        const group = leftProof.tsgs[0];
        const wire = messagize(reply, {
          sigers: [...group.sigers, ...rightProof.tsgs[0].sigers],
          seal: { i: group.prefixer, s: group.seqner, d: group.diger },
          gvrsn: Vrsn_2_0,
        });
        const child = parseBytes(wire)[0];
        yield* runtime.exc.processEvent(proposal(alice, "/multisig/rpy", child, { gid: local.hab.pre }));
        assertEquals(accepted, []);
        yield* runtime.exc.processEvent(proposal(bob, "/multisig/rpy", child, { gid: local.hab.pre }));
        assertEquals(accepted, [reply.said]);
        assertExists(left.db.rpys.get([reply.said!]));
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("multisig replay requires a matching semantic owner pair", async () => {
  await participants((left, right) => {
    const kvy = left.kevery;
    const rvy = left.rvy;
    assertThrows(() => new Multiplexor(left, { kvy }), TypeError, "both Kevery and Revery");
    assertThrows(() => new Multiplexor(left, { rvy }), TypeError, "both Kevery and Revery");
    assertThrows(() => new Multiplexor(left, { kvy, rvy: new Revery(left.db) }), TypeError, "share the group store");
    assertThrows(
      () => new Multiplexor(left, { kvy: right.kevery, rvy: right.rvy }),
      TypeError,
      "share the group store",
    );
    const standalone = new Multiplexor(left);
    assertStrictEquals(standalone.kvy.db, left.db);
    assertStrictEquals(standalone.kvy.rvy, standalone.rvy);
    assertThrows(() => new Multiplexor(left, { kvy: new Kevery(left.db), rvy }), TypeError, "reply verifier");
  });
});

Deno.test("group reply inspection gates policy and preserves the exact retained peer contribution", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      try {
        yield* runtime.reactor.processBytes(messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }), {
          local: true,
        });
        yield* call(() => learn(right, local.hab));
        const reply = replyEvent("/test/reply-policy", { exact: "application data" }, {
          pre: local.hab.pre,
          version: Vrsn_2_0,
        });
        const child = parseBytes(groupEndorseReply(right, remote.hab.pre, reply, Vrsn_2_0))[0];
        const incoming = proposal(bob, "/multisig/rpy", child, { gid: local.hab.pre });
        yield* runtime.exc.processEvent(incoming);
        let validated = 0;
        const validate = (candidate: SerderKERI) => {
          assertEquals(candidate.raw, reply.raw);
          validated++;
        };
        const group = local.hab.pre;
        const inspected = inspectReplyProposal(left, runtime.exc, incoming.serder.said!, { group, validate });
        assertEquals(validated, 1);
        const peerBefore = replyContribution(inspected);
        const originalSign = alice.mgr.sign;
        let signatures = 0;
        alice.mgr.sign = () => {
          signatures++;
          throw new Error("Rejected policy reached the signer.");
        };
        try {
          assertThrows(
            () => endorseReply(left, inspected.child, { group, validate: () => false }),
            ValidationError,
            "policy declined",
          );
          assertThrows(
            () => endorseReply(left, { ...inspected.child, nests: [inspected.child] }, { group, validate }),
            ValidationError,
            "signature attachments",
          );
          assertThrows(
            () => endorseReply(left, inspected.child, { group: bob.pre, validate }),
            ValidationError,
          );
        } finally {
          alice.mgr.sign = originalSign;
        }
        assertEquals(signatures, 0);
        assertEquals(left.db.maids.get([reply.said!]).map((member) => member.qb64), [bob.pre]);
        const signed = endorseReply(left, inspected.child, { group, validate });
        const endorsed = envelopeFromFrame(parseBytes(signed)[0]);
        assertEquals(
          new Set(endorsed.tsgs.flatMap((group) => group.sigers.map((siger) => siger.index))),
          new Set([0, 1]),
        );
        assertEquals(replyContribution(inspected), peerBefore);
        assertEquals(
          envelopeFromFrame(inspected.child).tsgs.flatMap((group) => group.sigers.map((siger) => siger.index)),
          [
            1,
          ],
        );
        assertEquals(validated, 2);
        assertEquals(left.db.maids.get([reply.said!]).map((member) => member.qb64), [bob.pre]);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

for (const version of [Vrsn_1_0, Vrsn_2_0]) {
  Deno.test(`endpoint reply approval validates before consent and signing (wrapper v${version.major})`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      await run(function* () {
        const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
        try {
          yield* runtime.reactor.processBytes(
            messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }),
            {
              local: true,
            },
          );
          yield* call(() => learn(right, local.hab));
          const outsider = right.makeHab("outsider");
          yield* call(() => learn(left, outsider));
          const cases = [
            {
              label: "foreign controller",
              route: "/end/role/add",
              attrs: { cid: bob.pre, role: "mailbox", eid: alice.pre },
            },
            {
              label: "foreign route",
              route: "/test/unrelated",
              attrs: { cid: local.hab.pre, role: "mailbox", eid: bob.pre },
            },
            {
              label: "invalid role",
              route: "/end/role/add",
              attrs: { cid: local.hab.pre, role: "invented", eid: bob.pre },
            },
            { label: "missing endpoint", route: "/end/role/add", attrs: { cid: local.hab.pre, role: "mailbox" } },
            {
              label: "foreign reply author",
              route: "/end/role/add",
              attrs: { cid: local.hab.pre, role: "mailbox", eid: bob.pre },
              author: bob.pre,
            },
            {
              label: "nonmember wrapper",
              route: "/end/role/add",
              attrs: { cid: local.hab.pre, role: "mailbox", eid: bob.pre },
              sender: outsider,
            },
            {
              label: "non-signature footer",
              route: "/end/role/add",
              attrs: { cid: local.hab.pre, role: "mailbox", eid: bob.pre },
              footer: true,
            },
          ];
          for (const candidate of cases) {
            const reply = replyEvent(candidate.route, candidate.attrs, {
              pre: candidate.author ?? local.hab.pre,
              version: Vrsn_2_0,
            });
            let wire = groupEndorseReply(right, remote.hab.pre, reply, Vrsn_2_0);
            if (candidate.footer) {
              wire = messagize(reply, {
                tsgs: envelopeFromFrame(parseBytes(wire)[0]).tsgs,
                wigers: remote.sigers.map((siger) => new Siger({ qb64: siger.qb64 })),
                gvrsn: Vrsn_2_0,
              });
            }
            const prepared = yield* prepareMultisigEventExn(
              (candidate.sender ?? bob).pre,
              {
                route: "/multisig/rpy",
                attrs: { gid: local.hab.pre },
              },
              wire,
              { pvrsn: version, childGvrsn: Vrsn_2_0 },
            );
            const signed = signGroupMessage(candidate.sender ?? bob, alice.pre, prepared);
            yield* runtime.reactor.processBytes(signed.message, { local: true });
            assert(runtime.exc.complete(prepared[0].said!), candidate.label);
            const before = left.db.maids.get([
              version.major === 2 ? reply.said! : String((prepared[0].ked!.e as { d: string }).d),
            ])
              .map((member) => member.qb64);
            let prompted = 0;
            const originalSign = alice.mgr.sign;
            let signatures = 0;
            alice.mgr.sign = () => {
              signatures++;
              throw new Error("Malformed proposal reached the signer.");
            };
            try {
              yield* call(() =>
                assertRejects(() =>
                  run(() =>
                    approvePendingMultisigProposal(left, runtime, {
                      said: prepared[0].said!,
                      callbacks: {
                        approveProposal: () => {
                          prompted++;
                          return true;
                        },
                        chooseGroupAlias: () => "group",
                        chooseRegistryName: () => "unused",
                      },
                    })
                  ), ValidationError)
              );
            } finally {
              alice.mgr.sign = originalSign;
            }
            assertEquals(prompted, 0, candidate.label);
            assertEquals(signatures, 0, candidate.label);
            assertEquals(
              left.db.maids.get([version.major === 2 ? reply.said! : String((prepared[0].ked!.e as { d: string }).d)])
                .map((member) => member.qb64),
              before,
              candidate.label,
            );
            assertEquals(left.db.ends.get([bob.pre, "mailbox", alice.pre]), null);
          }
        } finally {
          yield* runtime.close();
        }
      });
    });
  });

  Deno.test(`endpoint reply approval reuses its exact prior contribution after reopen (wrapper v${version.major})`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      await run(function* () {
        const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
        try {
          yield* runtime.reactor.processBytes(
            messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }),
            {
              local: true,
            },
          );
          yield* call(() => learn(right, local.hab));
          const reply = replyEvent("/end/role/add", { cid: local.hab.pre, role: "mailbox", eid: bob.pre }, {
            pre: local.hab.pre,
            version: Vrsn_2_0,
          });
          const prepared = yield* prepareMultisigEventExn(
            bob.pre,
            {
              route: "/multisig/rpy",
              attrs: { gid: local.hab.pre },
            },
            groupEndorseReply(right, remote.hab.pre, reply, Vrsn_2_0),
            { pvrsn: version, childGvrsn: Vrsn_2_0 },
          );
          yield* runtime.reactor.processBytes(signGroupMessage(bob, alice.pre, prepared).message, { local: true });
          const sent: Uint8Array[] = [];
          runtime.postman.send = function (evt) {
            sent.push(evt.msg!);
            return { ...evt, kin: "msg" };
          };
          runtime.postman.wait = function* (evt) {
            return { kin: "sent", evt, deliveries: ["test-transmission"] };
          };
          let prompted = 0;
          const options = {
            said: prepared[0].said!,
            callbacks: {
              approveProposal: () => {
                prompted++;
                return true;
              },
              chooseGroupAlias: () => "group",
              chooseRegistryName: () => "unused",
            },
          };
          const first = yield* approvePendingMultisigProposal(left, runtime, options);
          assertEquals(first?.accepted, true);
          assertEquals(prompted, 1);
          assertEquals(new SerderKERI({ raw: sent[0] }).pvrsn, version);
          yield* left.db.reopen();
          const originalSign = alice.mgr.sign;
          alice.mgr.sign = () => {
            throw new Error("Resume must not create another signature.");
          };
          try {
            const resumed = yield* approvePendingMultisigProposal(left, runtime, options);
            assertEquals(resumed?.messages, first?.messages);
            assertEquals(resumed?.accepted, true);
          } finally {
            alice.mgr.sign = originalSign;
          }
          assertEquals(prompted, 1);
          assertEquals(sent.length, 2);
          const firstFrame = parseBytes(sent[0])[0], resumedFrame = parseBytes(sent[1])[0];
          assertEquals(resumedFrame.body.raw, firstFrame.body.raw);
          assertEquals(
            resumedFrame.attachments.map((group) => group.raw),
            firstFrame.attachments.map((group) => group.raw),
          );
          assertEquals(
            resumedFrame.nests?.map((frame) => ({
              body: frame.body.raw,
              proofs: frame.attachments.map((group) => group.raw),
            })),
            firstFrame.nests?.map((frame) => ({
              body: frame.body.raw,
              proofs: frame.attachments.map((group) => group.raw),
            })),
          );
        } finally {
          yield* runtime.close();
        }
      });
    });
  });
}

Deno.test("multisig publication records its actual local proposal before delivery and accepts a later peer proof", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, {
        notifier,
      });
      try {
        let delivered: SerderKERI | undefined;
        // Only transmission is substituted; preparation, signing, intake and replay use real owners.
        runtime.postman.send = function (evt) {
          const serder = new SerderKERI({ raw: evt.msg });
          assertEquals(evt.src, alice.pre);
          assertEquals(evt.dest, bob.pre);
          assertEquals(serder.ked!.a, { gid: local.hab.pre, smids: mids, rmids: mids, i: bob.pre });
          const embeds = serder.ked!.e;
          assertExists(embeds);
          assertEquals(Object.keys(embeds), ["icp", "d"]);
          assertEquals(left.db.exns.get([serder.said!])?.raw, serder.raw);
          assertEquals(runtime.exc.complete(serder.said!), true);
          const embedded = (serder.ked!.e as { d: string }).d;
          assertEquals(left.db.maids.get([embedded]).map((p) => p.qb64), [alice.pre]);
          delivered = serder;
          return { ...evt, kin: "msg" };
        };
        runtime.postman.wait = function* (evt) {
          return { kin: "sent", evt, deliveries: ["test-transmission"] };
        };
        const publication = yield* publishProposal(left, runtime.protocol, runtime.postman, alice, mids, {
          route: "/multisig/icp",
          attrs: { smids: mids, rmids: mids },
        }, messagize(local.serder, { sigers: local.sigers, gvrsn: Vrsn_1_0 }));
        assertEquals(publication.deliveries, ["test-transmission"]);
        assertExists(delivered);
        assertEquals(publication.messages, [{
          recipient: bob.pre,
          exnSaid: delivered.said,
          payloadSaid: (delivered.ked!.e as { d: string }).d,
        }]);
        assertEquals(left.db.getKever(local.hab.pre), null);
        assertEquals(notifier.list().length, 0);
        yield* left.db.reopen();
        const resumed = yield* approvePendingMultisigProposal(left, runtime, {
          said: delivered.said!,
          callbacks: {
            approveProposal: () => {
              throw new Error("Pending recorded approval must not prompt again.");
            },
            chooseGroupAlias: () => {
              throw new Error("Pending group already has an alias.");
            },
            chooseRegistryName: () => "unused",
          },
        });
        assertEquals(resumed?.accepted, false);
        assertEquals(resumed?.messages, publication.messages);
        assertEquals(left.db.getKever(local.hab.pre), null);
        const [peer, paths] = yield* multisigInceptExn(
          bob,
          mids,
          mids,
          messagize(remote.serder, { sigers: remote.sigers, gvrsn: Vrsn_1_0 }),
        );
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(peer, { pipelined: false }), paths), {
          local: true,
        });
        yield* runtime.protocol.processEscrowsOnce();
        assertEquals(left.db.getKever(local.hab.pre)?.said, local.serder.said);
        assertEquals(notifier.list().length, 0);
      } finally {
        yield* runtime.close();
      }
    });
  });
});
for (const localSender of [false, true]) {
  Deno.test(`stored multisig replay recovers admission before indexing (${localSender ? "local" : "peer"})`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      await run(function* () {
        let runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
        try {
          const sender = localSender ? alice : bob;
          const recipient = localSender ? bob : alice;
          const child = localSender ? local : remote;
          const prepared = yield* prepareMultisigEventExn(
            sender.pre,
            {
              route: "/multisig/icp",
              attrs: { smids: mids, rmids: mids },
            },
            messagize(child.serder, { sigers: child.sigers }),
            { recipient: recipient.pre },
          );
          const signed = signGroupMessage(sender, recipient.pre, prepared);
          const handler = runtime.exc.routes.get("/multisig/icp")!;
          const handle = handler.handle;
          const fault = new Error("interrupted before Multiplexor indexing");
          handler.handle = function* () {
            throw fault;
          };
          try {
            const error = yield* call(() =>
              assertRejects(() => run(() => runtime.reactor.processBytes(signed.message, { local: true })))
            );
            assertEquals(error, fault);
          } finally {
            handler.handle = handle;
          }
          assertEquals(runtime.exc.complete(signed.exnSaid), true);
          assertEquals(left.db.meids.get([signed.payloadSaid]), []);
          yield* runtime.close();
          yield* left.db.reopen();
          runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
          runtime.postman.send = (evt) => ({ ...evt, kin: "msg" });
          runtime.postman.wait = function* (evt) {
            return { kin: "sent", evt, deliveries: ["test"] };
          };
          let prompts = 0;
          const callbacks = {
            approveProposal: () => {
              prompts++;
              return true;
            },
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "unused",
          };
          if (!localSender) {
            yield* call(() =>
              assertRejects(
                () =>
                  run(() =>
                    approvePendingMultisigProposal(left, runtime, {
                      said: signed.exnSaid,
                      group: bob.pre,
                      callbacks,
                    })
                  ),
                Error,
                "belongs to group",
              )
            );
            assertEquals(left.db.meids.get([signed.payloadSaid]), []);
            assertEquals(prompts, 0);
          }
          const sign = alice.mgr.sign;
          if (localSender) {
            alice.mgr.sign = () => {
              throw new Error("Recorded approval must reuse its original signatures.");
            };
          }
          try {
            const result = yield* approvePendingMultisigProposal(left, runtime, {
              said: signed.exnSaid,
              group: local.hab.pre,
              callbacks,
            });
            assertExists(result);
            assertEquals(result.said, signed.exnSaid);
            assertEquals(result.embedded, child.serder.said);
            assertEquals(result.accepted, !localSender);
            assertEquals(prompts, localSender ? 0 : 1);
            assertEquals(left.db.meids.get([signed.payloadSaid]).some((index) => index.qb64 === signed.exnSaid), true);
            if (localSender) assertEquals(result.messages[0].exnSaid, signed.exnSaid);
          } finally {
            alice.mgr.sign = sign;
          }
        } finally {
          yield* runtime.close();
        }
      });
    });
  });
}

Deno.test("multisig approval honors signed child genus through KEL, replies, registry and credential issuance", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, {
        notifier,
      });
      try {
        runtime.postman.send = function (evt) {
          const serder = new SerderKERI({ raw: evt.msg });
          if (serder.route === "/multisig/icp") {
            assertEquals(serder.ked!.a, {
              gid: local.hab.pre,
              smids: mids,
              rmids: mids,
              cgvrsn: [2, 0],
              i: bob.pre,
            });
          }
          if (["/multisig/rpy", "/multisig/vcp", "/multisig/iss"].includes(serder.route!)) {
            assertEquals(serder.ked!.a, {
              gid: local.hab.pre,
              cgvrsn: [2, 0],
              ...(serder.route === "/multisig/vcp" ? { usage: "group credentials" } : {}),
              i: bob.pre,
            });
          }
          if (serder.route === "/multisig/iss") {
            const sad = serder.ked!.e as Record<string, unknown>;
            const child = new SerderACDC({ sad: sad.acdc as Record<string, unknown> });
            const proof = multisigPathedAttachment(left, serder.said!, "acdc");
            const frames = parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), child.raw, proof));
            {
              assertEquals(frames.length, 1);
              const seals = envelopeFromFrame(frames[0]).ssts;
              assertEquals(seals.length, 1);
              assertEquals([seals[0].i.qb64, seals[0].s.num, seals[0].d.qb64], [issuance.pre, 0n, issuance.said]);
            }
          }
          return { ...evt, kin: "msg" };
        };
        runtime.postman.wait = function* (evt) {
          return { kin: "sent", evt, deliveries: ["test"] };
        };
        const [peer, paths] = exchange("/multisig/icp", {
          smids: mids,
          rmids: mids,
          cgvrsn: [2, 0],
          unrecognized: "peer-only",
        }, {
          sender: bob.pre,
          embeds: { icp: messagize(remote.serder, { sigers: remote.sigers, gvrsn: Vrsn_2_0 }) },
        });
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(peer, { pipelined: false }), paths), {
          local: true,
        });
        const callbacks = {
          approveProposal: () => {
            prompts++;
            return true;
          },
          chooseGroupAlias: () => "group",
          chooseRegistryName: () => "registry",
        };
        let prompts = 0;
        // The wrong group must not prompt, sign or consume the pending notice.
        const pending = notifier.list();
        assertEquals(
          yield* approvePendingMultisigProposal(left, runtime, {
            group: bob.pre,
            callbacks,
          }),
          null,
        );
        assertEquals(prompts, 0);
        assertEquals(notifier.list(), pending);
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                approvePendingMultisigProposal(left, runtime, {
                  group: bob.pre,
                  said: peer.said!,
                  callbacks,
                })
              ),
            Error,
            "belongs to group",
          )
        );
        assertEquals(prompts, 0);
        // Explicit selection uses durable evidence even after every notice is consumed.
        for (const notice of pending) notifier.remove(notice.rid);
        const result = yield* approvePendingMultisigProposal(left, { ...runtime, notifier: null }, {
          group: "group",
          said: peer.said!,
          callbacks,
        });
        assertEquals(result?.said, peer.said);
        assertEquals(prompts, 1);
        assertEquals(result?.accepted, true);
        assertEquals(left.db.getKever(local.hab.pre)?.said, local.serder.said);
        yield* call(() => learn(right, local.hab));
        const rpy = replyEvent("/end/role/add", { cid: local.hab.pre, role: "mailbox", eid: bob.pre }, {
          pre: local.hab.pre,
        });
        const peerRpy = groupEndorseReply(right, remote.hab.pre, rpy, Vrsn_2_0);
        const [rpyWrapper, rpyPaths] = exchange("/multisig/rpy", {
          gid: local.hab.pre,
          cgvrsn: [2, 0],
          unrecognized: "peer-only",
        }, { sender: bob.pre, embeds: { rpy: peerRpy } });
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(rpyWrapper, { pipelined: false }), rpyPaths), {
          local: true,
        });
        const replyResult = yield* approvePendingMultisigProposal(left, runtime, {
          callbacks: {
            approveProposal: () => true,
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "registry",
          },
        });
        assertEquals(replyResult?.accepted, true);
        assertEquals(left.db.ends.get([local.hab.pre, "mailbox", bob.pre])?.allowed, true);
        const registry = inceptRegistry(local.hab.pre, { cnfg: ["NB"] });
        const anchor = right.interactGroupHab("group", mids, {
          data: [{ i: registry.pre, s: "0", d: registry.said }],
        });
        const [vcpWrapper, vcpPaths] = exchange("/multisig/vcp", {
          gid: local.hab.pre,
          cgvrsn: [2, 0],
          usage: "group credentials",
          unrecognized: "peer-only",
        }, {
          sender: bob.pre,
          embeds: { vcp: registry.raw, anc: messagize(anchor.serder, { sigers: anchor.sigers, gvrsn: Vrsn_2_0 }) },
        });
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(vcpWrapper, { pipelined: false }), vcpPaths), {
          local: true,
        });
        const registryResult = yield* approvePendingMultisigProposal(left, runtime, {
          callbacks: {
            approveProposal: () => true,
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "registry",
          },
        });
        assertEquals(registryResult?.accepted, true);
        assertEquals(left.db.getKever(local.hab.pre)?.said, anchor.serder.said);
        assertInstanceOf(runtime.vdr!.reger, Reger);
        assertEquals(runtime.vdr!.reger.tels.getOn(registry.pre!, 0)?.qb64, registry.said);
        yield* call(() => learn(right, local.hab));
        const schemer = new Schemer({ sed: { $id: "", type: "object" } });
        left.db.schema.pin(schemer.said, schemer);
        const creder = credential({
          issuer: local.hab.pre,
          registry: registry.pre!,
          schema: schemer.said,
          recipient: bob.pre,
          data: { role: "holder" },
        });
        const issuance = issueCredential(creder.said!, registry.pre!);
        const issueAnchor = right.interactGroupHab("group", mids, {
          data: [{ i: issuance.pre, s: "0", d: issuance.said }],
        });
        const [issWrapper, issPaths] = exchange("/multisig/iss", {
          gid: local.hab.pre,
          cgvrsn: [2, 0],
          unrecognized: "peer-only",
        }, {
          sender: bob.pre,
          embeds: {
            acdc: serializeCredential(
              creder,
              new Prefixer({ qb64: issuance.pre! }),
              NumberPrimitive.fromNum(0n),
              new Diger({ qb64: issuance.said! }),
              Vrsn_2_0,
            ),
            iss: issuance.raw,
            anc: messagize(issueAnchor.serder, { sigers: issueAnchor.sigers, gvrsn: Vrsn_2_0 }),
          },
        });
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(issWrapper, { pipelined: false }), issPaths), {
          local: true,
        });
        const issueResult = yield* approvePendingMultisigProposal(left, runtime, {
          callbacks: {
            approveProposal: () => true,
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "registry",
          },
        });
        assertEquals(issueResult?.accepted, true);
        assertEquals(runtime.vdr!.reger.tels.getOn(creder.said!, 0)?.qb64, issuance.said);
        assertExists(runtime.vdr!.reger.saved.get([creder.said!]));
        // Reopen the actual evidence store; all four selections have consumed their notices.
        yield* left.db.reopen();
        const sign = alice.mgr.sign;
        alice.mgr.sign = () => {
          throw new Error("Resume must reuse the recorded member contribution and outer signatures.");
        };
        try {
          const callbacks = {
            approveProposal: () => {
              throw new Error("Recorded approval must not prompt again.");
            },
            chooseGroupAlias: () => {
              throw new Error("Recorded group must not be renamed.");
            },
            chooseRegistryName: () => {
              throw new Error("Recorded registry must not be renamed.");
            },
          };
          for (
            const [wrapper, prior] of [
              [peer, result],
              [rpyWrapper, replyResult],
              [vcpWrapper, registryResult],
              [issWrapper, issueResult],
            ] as const
          ) {
            const resumed = yield* approvePendingMultisigProposal(left, runtime, {
              said: wrapper.said!,
              group: "group",
              callbacks,
            });
            assertEquals(resumed?.accepted, true);
            assertEquals(resumed?.messages, prior?.messages);
            assertEquals(resumed?.embedded, prior?.embedded);
          }
        } finally {
          alice.mgr.sign = sign;
        }
        assertEquals(left.db.getKever(local.hab.pre)?.said, issueAnchor.serder.said);
      } finally {
        yield* runtime.close();
      }
    });
  });
});
for (const genus of [Vrsn_1_0, Vrsn_2_0]) {
  for (const remoteFirst of [false, true]) {
    Deno.test(`v1 multisig replays genus ${genus.major} children after approval (${remoteFirst ? "remote" : "local"} first)`, async () => {
      await participants(async (left, right, alice, bob, notifier) => {
        const mids = [alice.pre, bob.pre];
        const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
        const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
        assertEquals(local.serder.raw, remote.serder.raw);
        let exchanger = new Exchanger(left);
        loadMultisigHandlers(left, exchanger, { notifier });
        async function submit(sender: Hab, wire: Uint8Array) {
          const [wrapper, paths] = await run(() =>
            multisigInceptExn(sender, mids, mids, wire, undefined, {
              pvrsn: Vrsn_1_0,
              childGvrsn: genus,
            })
          );
          const message = concatBytes(sender.endorse(wrapper, { pipelined: false }), paths);
          for (const frame of await parseBytes(message)) {
            {
              const { decision } = await run(() =>
                dispatchEnvelope(envelopeFromFrame(frame, true), left.rvy, left.kevery, exchanger)
              );
              assertEquals(decision?.kind, "accept");
            }
          }
        }
        const own = messagize(local.serder, { sigers: local.sigers, gvrsn: genus });
        const other = messagize(remote.serder, { sigers: remote.sigers, gvrsn: genus });
        await submit(remoteFirst ? bob : alice, remoteFirst ? other : own);
        assertEquals(left.db.getKever(local.hab.pre), null);
        assertEquals(notifier.list().length, remoteFirst ? 1 : 0);
        await run(() => left.db.reopen());
        exchanger = new Exchanger(left);
        loadMultisigHandlers(left, exchanger, { notifier });
        if (!remoteFirst) {
          const wrong = bob.mgr.sign(b("different child"), {
            pubs: [bob.kever!.verfers[0].qb64],
            indices: [1],
            indexed: true,
          });
          await submit(bob, messagize(remote.serder, { sigers: wrong, gvrsn: genus }));
          left.kevery.processEscrows();
          assertEquals(left.db.getKever(local.hab.pre), null);
          assertEquals(left.db.getSigs(local.hab.pre, local.serder.said!).map((s) => new Siger({ qb64: s }).index), [
            0,
          ]);
        }
        await submit(remoteFirst ? alice : bob, remoteFirst ? own : other);
        left.kevery.processEscrows();
        assertEquals(
          left.db.getSigs(local.hab.pre, local.serder.said!).map((s) => new Siger({ qb64: s }).index).sort(),
          [0, 1],
        );
        assertEquals(left.db.getKever(local.hab.pre)?.said, local.serder.said);
        assertEquals(notifier.list().length, remoteFirst ? 1 : 0);
      });
    });
  }
}
Deno.test("multisig peer evidence arriving during approval replay needs no second approval", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const own = parseBytes(messagize(local.serder, { sigers: local.sigers, gvrsn: Vrsn_2_0, genusify: true }))[0];
    const other = parseBytes(messagize(remote.serder, { sigers: remote.sigers, gvrsn: Vrsn_2_0, genusify: true }))[0];
    const attrs = { gid: local.hab.pre, smids: mids, rmids: mids };
    const first = proposal(bob, "/multisig/icp", { ...other, attachments: [] }, { ...attrs, m: "missing child proof" });
    const later = proposal(bob, "/multisig/icp", other, { ...attrs, m: "child proof supplied" });
    const approval = proposal(alice, "/multisig/icp", own, attrs);
    const primary = new Exchanger(left), incoming = new Exchanger(left);
    const mux = loadMultisigHandlers(left, primary, { notifier });
    loadMultisigHandlers(left, incoming, { notifier, mux });
    assertEquals((await run(() => primary.processEvent(first))).kind, "accept");
    let resume!: () => void, entered!: () => void;
    const replaying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const replay = Exchanger.prototype.replay;
    Exchanger.prototype.replay = async function* (said, signal) {
      if (said === first.serder.said) {
        entered();
        await gate;
      }
      yield* replay.call(this, said, signal);
    };
    try {
      const approving = run(() => primary.processEvent(approval));
      try {
        await replaying;
        assertEquals((await run(() => incoming.processEvent(later))).kind, "accept");
      } finally {
        resume();
        await approving;
      }
    } finally {
      Exchanger.prototype.replay = replay;
    }
    left.kevery.processEscrows();
    assertEquals(left.db.getKever(local.hab.pre)?.said, local.serder.said);
    assertEquals(
      left.db.getSigs(local.hab.pre, local.serder.said!).map((sig) => new Siger({ qb64: sig }).index).sort(),
      [0, 1],
    );
  });
});

for (const remoteFirst of [false, true]) {
  Deno.test(`nested multisig merges real child signatures after approval (${remoteFirst ? "remote" : "local"} first)`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      assertEquals(local.serder.raw, remote.serder.raw);
      const [own] = await parseBytes(
        messagize(local.serder, { sigers: local.sigers, gvrsn: Vrsn_2_0, genusify: true }),
      );
      const [other] = await parseBytes(
        messagize(remote.serder, { sigers: remote.sigers, gvrsn: Vrsn_2_0, genusify: true }),
      );
      {
        const attrs = { gid: local.hab.pre, smids: mids, rmids: mids };
        const approval = proposal(alice, "/multisig/icp", own, attrs);
        const offered = proposal(bob, "/multisig/icp", other, attrs);
        let exchanger = new Exchanger(left);
        loadMultisigHandlers(left, exchanger, { notifier });
        const first = remoteFirst ? offered : approval;
        assertEquals((await run(() => exchanger.processEvent(first))).kind, "accept");
        assertEquals(left.db.getKever(local.hab.pre), null);
        assertEquals(notifier.list().length, remoteFirst ? 1 : 0);
        // No in-memory approval or child cache may be required after the database closes.
        await run(function* () {
          yield* left.db.reopen();
        });
        exchanger = new Exchanger(left);
        loadMultisigHandlers(left, exchanger, { notifier });
        if (!remoteFirst) {
          const wrong = bob.mgr.sign(b("different child"), {
            pubs: [bob.kever!.verfers[0].qb64],
            indices: [1],
            indexed: true,
          });
          const [invalid] = await parseBytes(
            messagize(remote.serder, { sigers: wrong, gvrsn: Vrsn_2_0, genusify: true }),
          );
          assertEquals((await run(() => exchanger.processEvent({ ...offered, nests: [invalid] }))).kind, "accept");
          left.kevery.processEscrows();
          assertEquals(left.db.getKever(local.hab.pre), null);
          assertEquals(left.db.getSigs(local.hab.pre, local.serder.said!).map((s) => new Siger({ qb64: s }).index), [
            0,
          ]);
        }
        assertEquals((await run(() => exchanger.processEvent(remoteFirst ? approval : offered))).kind, "accept");
        assertEquals(
          left.db.getSigs(local.hab.pre, local.serder.said!).map((s) => new Siger({ qb64: s }).index).sort(),
          [0, 1],
        );
        left.kevery.processEscrows();
        assertEquals(left.db.getKever(local.hab.pre)?.said, local.serder.said);
        assertEquals(left.db.meids.get([local.serder.said!]).length, 2);
        assertEquals(left.db.maids.get([local.serder.said!]).map((p) => p.qb64).sort(), [...mids].sort());
        const rows = left.db.enst.get([offered.serder.said!]);
        assertEquals(rows.length, 1);
        assertEquals((await run(() => exchanger.processEvent(offered))).kind, "accept");
        assertEquals(left.db.enst.get([offered.serder.said!]), rows);
        assertEquals(left.db.meids.get([local.serder.said!]).length, 2);
      }
    });
  });
}
Deno.test("nested multisig rejects bad commitments and parent signatures before publication", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    {
      const attrs = { smids: [alice.pre, bob.pre], rmids: [] };
      const input = proposal(bob, "/multisig/icp", child, attrs);
      const exchanger = new Exchanger(left);
      loadMultisigHandlers(left, exchanger, { notifier });
      const badBody = exchange("/multisig/icp", { ...attrs, icp: alice.pre }, { sender: bob.pre, pvrsn: Vrsn_2_0 })[0];
      const missing = exchange("/multisig/icp", attrs, { sender: bob.pre, pvrsn: Vrsn_2_0 })[0];
      for (
        const candidate of [
          { ...input, serder: badBody, tsgs: proof(bob, badBody) },
          { ...input, serder: missing, tsgs: proof(bob, missing) },
          { ...input, nests: [] },
          { ...input, nests: [child, child] },
          { ...input, tsgs: proof(alice, input.serder) },
          proposal(bob, "/multisig/rot", child, { gid: alice.pre }),
          proposal(bob, "/multisig/exn", child, { gid: alice.pre }),
          proposal(bob, "/multisig/icp", child, { smids: [bob.pre] }),
        ]
      ) {
        assertEquals((await run(() => exchanger.processEvent(candidate))).kind, "reject");
        assertEquals(left.db.exns.get([candidate.serder.said!]), null);
        assertEquals(left.db.enst.get([candidate.serder.said!]), []);
      }
      assertEquals(notifier.list().length, 0);
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
      const rows = left.db.enst.get([input.serder.said!]);
      const mismatch = { ...child, body: alice.kever!.serder };
      assertEquals((await run(() => exchanger.processEvent({ ...input, nests: [mismatch] }))).kind, "reject");
      assertEquals(left.db.enst.get([input.serder.said!]), rows);
    }
  });
});
Deno.test("nested multisig builders and public normalization preserve all four route commitments", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const exchanger = new Exchanger(left);
    const mux = loadMultisigHandlers(left, exchanger, { notifier });
    const mids = [alice.pre, bob.pre];
    const inception = bob.db.clonePreIter(bob.pre, 0).next().value!;
    const rotation = bob.rotate();
    const interaction = bob.interact();
    const reply = bob.reply("/end/role/add", { cid: bob.pre, role: "controller", eid: alice.pre });
    await learn(left, bob);
    const options = { pvrsn: Vrsn_2_0 };
    const builds: Array<[MultisigEventProposal, () => Operation<MultisigMessage>]> = [
      [
        { route: "/multisig/icp", attrs: { smids: mids, rmids: mids } },
        () => multisigInceptExn(bob, mids, mids, inception, null, options),
      ],
      [
        { route: "/multisig/rot", attrs: { gid: alice.pre, smids: mids, rmids: mids } },
        () => multisigRotateExn(alice.pre, bob, mids, mids, rotation, options),
      ],
      [
        { route: "/multisig/ixn", attrs: { gid: alice.pre, smids: mids } },
        () => multisigInteractExn(alice.pre, bob, mids, interaction, options),
      ],
      [
        { route: "/multisig/rpy", attrs: { gid: alice.pre } },
        () => multisigRpyExn(alice.pre, bob, reply, options),
      ],
    ];
    for (const [request, build] of builds) {
      const [serder, nested] = await run(build);
      const signatures = messageAttachmentGroups({ tsgs: proof(bob, serder) }, Vrsn_2_0);
      const wire = concatBytes(
        Counter.makeGVC(Vrsn_2_0),
        serder.raw,
        Counter.enclose({
          qb64: concatBytes(...signatures.map((group) => group.raw), nested),
          code: "AttachmentGroup",
          version: Vrsn_2_0,
        }),
      );
      const frames = await parseBytes(wire);
      {
        assertEquals(frames.length, 1);
        const frame = frames[0];
        const normalized = envelopeFromFrame(frame);
        assertEquals(normalized.nests.length, 1);
        assertEquals(normalized.tsgs.length, 1);
        const child = frame.nests![0];
        const body = child.body;
        assertInstanceOf(body, SerderKERI);
        const direct = multisigExnBody(
          bob.pre,
          request,
          body,
          { ...options, stamp: serder.ked!.dt as string },
        );
        assertEquals(direct.raw, serder.raw);
        assertEquals(await collectPayload(nestedPayload(child, Vrsn_2_0)), nested);
        // This assertion reads the generic on-wire SAD only; typed proposal input stays authoritative above.
        assertEquals((serder.a as Record<string, unknown>)[serder.route!.split("/").at(-1)!], body.said);
        assertEquals(mux.verify(serder, [child]), true);
        await run(() => dispatchEnvelope(normalized, left.rvy, left.kevery, exchanger));
        assertEquals(exchanger.complete(serder.said!), true);
        assertEquals(left.db.enst.get([serder.said!]).length, 1);
        const sent = signGroupMessage(bob, alice.pre, [serder, nested]);
        assertEquals(sent.exnSaid, serder.said);
        assertEquals(sent.payloadSaid, body.said);
        assertEquals(left.db.meids.get([sent.payloadSaid]).map((value) => value.qb64), [sent.exnSaid]);
      }
    }
  });
});

Deno.test("v1 multisig wrappers match canonical KERIpy for v2 child attachments", async () => {
  const cases: Array<[MultisigEventProposal, typeof framing714.cases.icp]> = [
    [{ route: "/multisig/icp", attrs: { smids: framing714.members, rmids: framing714.members } }, framing714.cases.icp],
    [{
      route: "/multisig/rot",
      attrs: { gid: framing714.group, smids: framing714.members, rmids: framing714.members },
    }, framing714.cases.rot],
    [{ route: "/multisig/ixn", attrs: { gid: framing714.group, smids: framing714.members } }, framing714.cases.ixn],
    [{ route: "/multisig/rpy", attrs: { gid: framing714.group } }, framing714.cases.rpy],
    [
      { route: "/multisig/icp", attrs: { smids: framing714.members, rmids: framing714.members } },
      framing714.cases.intrinsic,
    ],
  ];
  for (const [request, vector] of cases) {
    const [parent, supplemental] = await run(() =>
      prepareMultisigEventExn(framing714.sender, request, b(vector.child), {
        pvrsn: Vrsn_1_0,
        childGvrsn: Vrsn_2_0,
        stamp: framing714.stamp,
      })
    );
    assertEquals(parent.raw, b(vector.parent), request.route);
    assertEquals(supplemental, b(vector.supplemental), request.route);
  }
});
Deno.test("nested multisig sender escrow survives reopen and rejects invalid commitments on retry", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    {
      const exchanger = new Exchanger(left);
      loadMultisigHandlers(left, exchanger, { notifier });
      const good = proposal(bob, "/multisig/icp", child, { smids: [alice.pre, bob.pre] });
      const bad = proposal(bob, "/multisig/rot", child, { gid: alice.pre });
      const establishment = bob.kever!.serder;
      left.db.evts.rem([bob.pre, establishment.said!]);
      for (const input of [good, bad]) {
        assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
        assertExists(left.db.epse.get([input.serder.said!]));
        assertEquals(left.db.enst.get([input.serder.said!]).length, 1);
      }
      await run(function* () {
        yield* left.db.reopen();
      });
      left.db.evts.pin([bob.pre, establishment.said!], establishment);
      await run(() => exchanger.processEscrows());
      assertEquals(exchanger.complete(good.serder.said!), true);
      assertEquals(left.db.enst.get([good.serder.said!]).length, 1);
      assertEquals(exchanger.complete(bad.serder.said!), false);
      assertEquals(left.db.enst.get([bad.serder.said!]), []);
      assertEquals(left.db.epse.get([bad.serder.said!]), null);
      assertEquals(notifier.list().length, 1);
    }
  });
});
Deno.test("nested multisig publication failure preserves rows and cannot record local approval", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    {
      const exchanger = new Exchanger(left);
      loadMultisigHandlers(left, exchanger, { notifier });
      const input = proposal(bob, "/multisig/icp", child, { smids: [alice.pre, bob.pre] });
      assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
      const rows = left.db.enst.get([input.serder.said!]);
      const approval = proposal(alice, "/multisig/icp", child, { smids: [alice.pre, bob.pre] });
      const metadata = left.db.exchangeMeta;
      const pin = metadata.pin;
      /** Inject failure after real row replacement within the LMDB transaction. */
      metadata.pin = () => {
        throw new Error("publication fault");
      };
      try {
        await assertRejects(
          () => run(() => exchanger.processEvent({ ...input, nests: [{ ...child, attachments: [] }] })),
          Error,
          "publication fault",
        );
        await assertRejects(() => run(() => exchanger.processEvent(approval)), Error, "publication fault");
      } finally {
        metadata.pin = pin;
      }
      assertEquals(left.db.enst.get([input.serder.said!]), rows);
      assertEquals(left.db.exns.get([approval.serder.said!]), null);
      assertEquals(left.db.maids.get([child.body.said!]).map((member) => member.qb64), [bob.pre]);
      assertEquals(notifier.list().length, 1);
    }
  });
});
Deno.test("approved nested rotation interaction and reply use child verification and dependency escrows", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const subject = right.makeHab("subject");
    await learn(left, subject);
    const rotation = subject.rotate();
    const interaction = subject.interact();
    const reply = subject.reply("/end/role/add", { cid: subject.pre, role: "controller", eid: alice.pre });
    const exchanger = new Exchanger(left);
    const mux = loadMultisigHandlers(left, exchanger, { notifier });
    const frames: CesrFrame[] = [];
    {
      for (const wire of [rotation, interaction, reply]) frames.push((await parseBytes(wire))[0]);
      // Approve an interaction before its prior rotation exists: the child belongs in ordinary KEL escrow.
      for (const child of [frames[1], frames[0], frames[2]]) {
        const route = `/multisig/${child.body.ilk}`;
        const offered = proposal(bob, route, child, { gid: alice.pre });
        const approved = proposal(alice, route, child, { gid: alice.pre });
        assertEquals((await run(() => exchanger.processEvent(offered))).kind, "accept");
        assertEquals((await run(() => exchanger.processEvent(approved))).kind, "accept");
        if (child.body.ilk === "ixn") assertEquals(left.db.getKever(subject.pre)?.sn, 0);
        mux.kvy.processEscrows();
        mux.rvy.processEscrowReply();
      }
      assertEquals(left.db.getKever(subject.pre)?.sn, 2);
      assertEquals(left.db.ends.get([subject.pre, "controller", alice.pre])?.allowed, true);
      assertEquals(left.db.getEvtSerder(subject.pre, frames[0].body.said!)?.raw, frames[0].body.raw);
      assertEquals(left.db.getEvtSerder(subject.pre, frames[1].body.said!)?.raw, frames[1].body.raw);
    }
  });
});
Deno.test("multisig body construction borrows a parsed child without reading or authenticating its evidence", async () => {
  await participants(async (_left, _right, alice, bob) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    child.essrs = [new Texter({ raw: b("abc"), code: "4B" })];
    {
      const request: MultisigEventProposal = {
        route: "/multisig/icp",
        attrs: { smids: [alice.pre, bob.pre], rmids: [alice.pre, bob.pre] },
      };
      const body = child.body;
      assertInstanceOf(body, SerderKERI);
      const options = { stamp: "2026-10-13T00:00:00.000000+00:00" };
      const parent = multisigExnBody(bob.pre, request, body, options);
      const borrowed = nestedPayload(child, Vrsn_2_0);
      assertEquals(parent.a, {
        gid: bob.pre,
        smids: [alice.pre, bob.pre],
        rmids: [alice.pre, bob.pre],
        icp: body.said,
      });
      // The same body can be constructed without signatures; acceptance remains the processor's responsibility.
      assertEquals(multisigExnBody(bob.pre, request, body, options).raw, parent.raw);
      assertThrows(
        () =>
          multisigExnBody(bob.pre, {
            route: "/multisig/rot",
            attrs: { gid: bob.pre, smids: [bob.pre], rmids: [bob.pre] },
          }, body),
        Error,
        "child kind",
      );
      assertThrows(
        () => {
          // @ts-expect-error Preserve the malformed JavaScript route regression at runtime too.
          return multisigExnBody(bob.pre, { route: "/multisig/exn", attrs: { gid: bob.pre } }, body);
        },
        Error,
        "child kind",
      );
      const nested = await collectPayload(borrowed);
      // A borrowed serializer never disposes the frame; a second read remains valid.
      assertEquals(await collectPayload(borrowed), nested);
      const wire = await collectPayload(framePayload(child));
      const [prepared, preparedNested] = await run(() =>
        prepareMultisigEventExn(bob.pre, request, wire, { ...options, pvrsn: Vrsn_2_0 })
      );
      assertEquals(prepared.raw, parent.raw);
      assertEquals(preparedNested, nested);
      assertEquals(child.essrs[0].text, "abc");
    }
  });
});

for (const route of ["ixn", "vcp"] as const) {
  Deno.test(`multisig approval rejects a wrapper naming another group (${route})`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const a = left.makeGroupHab("a", alice, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
      const b = left.makeGroupHab("b", alice, mids, mids, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
        data: [{ purpose: "b" }],
      });
      right.makeGroupHab("a", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
      right.makeGroupHab("b", bob, mids, mids, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
        data: [{ purpose: "b" }],
      });
      assertNotEquals(a.hab.pre, b.hab.pre);
      const registry = inceptRegistry(b.hab.pre, { cnfg: ["NB"] });
      const event = right.interactGroupHab("b", mids, {
        data: route === "vcp" ? [{ i: registry.pre, s: "0", d: registry.said }] : [],
      });
      const [wrapper, attachments] = exchange(`/multisig/${route}`, { gid: a.hab.pre, smids: mids }, {
        sender: bob.pre,
        embeds: route === "vcp"
          ? { vcp: registry.raw, anc: messagize(event.serder, { sigers: event.sigers, gvrsn: Vrsn_1_0 }) }
          : { ixn: messagize(event.serder, { sigers: event.sigers, gvrsn: Vrsn_1_0 }) },
      });
      await run(function* () {
        const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, {
          notifier,
        });
        try {
          runtime.postman.send = function (evt) {
            return { ...evt, kin: "msg" };
          };
          runtime.postman.wait = function* (evt) {
            return { kin: "sent", evt, deliveries: ["test"] };
          };
          yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), attachments), {
            local: true,
          });
          assertNotEquals(left.db.getKever(b.hab.pre)?.said, event.serder.said);
          let prompted = "";
          const result = yield* approvePendingMultisigProposal(left, runtime, {
            callbacks: {
              approveProposal: ({ group }) => {
                prompted = group;
                return true;
              },
              chooseGroupAlias: () => "a",
              chooseRegistryName: () => "unused",
            },
          });
          assertEquals(prompted, "");
          assertEquals(result, null);
          assertNotEquals(left.db.getKever(b.hab.pre)?.said, event.serder.said);
        } finally {
          yield* runtime.close();
        }
      });
    });
  });
}

Deno.test("multisig issuance missing its credential neither prompts nor accepts its anchor", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    const registry = inceptRegistry(local.hab.pre, { cnfg: ["NB"] });
    const issuance = issueCredential(registry.said!, registry.pre!);
    const anchor = right.interactGroupHab("group", mids, { data: [{ i: issuance.pre, s: "0", d: issuance.said }] });
    const [wrapper, paths] = exchange("/multisig/iss", { gid: local.hab.pre }, {
      sender: bob.pre,
      embeds: { iss: issuance.raw, anc: messagize(anchor.serder, { sigers: anchor.sigers, gvrsn: Vrsn_1_0 }) },
    });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, {
        notifier,
      });
      try {
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), paths), {
          local: true,
        });
        assertNotEquals(left.db.getKever(local.hab.pre)?.said, anchor.serder.said);
        let prompted = false;
        const result = yield* approvePendingMultisigProposal(left, runtime, {
          callbacks: {
            approveProposal: () => {
              prompted = true;
              return true;
            },
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "unused",
          },
        });
        assertEquals(prompted, false);
        assertEquals(result, null);
        assertNotEquals(left.db.getKever(local.hab.pre)?.said, anchor.serder.said);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

for (const kind of ["apply", "grant"] as const) {
  for (const genus of [Vrsn_1_0, Vrsn_2_0]) {
    Deno.test(`multisig IPEX ${kind} approval preserves genus ${genus.major} through peer publication`, async () => {
      await participants(async (left, right, alice, bob, notifier) => {
        const mids = [alice.pre, bob.pre];
        const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
        const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
        await run(function* () {
          const runtime = yield* createAgentRuntime(
            left,
            new FetchHttpClient(),
            systemClock,
            { notifier },
          );
          const peerRuntime = yield* createAgentRuntime(
            right,
            new FetchHttpClient(),
            systemClock,
          );
          try {
            yield* runtime.reactor.processBytes(
              messagize(local.serder, {
                sigers: [...local.sigers, ...remote.sigers],
              }),
              { local: true },
            );
            yield* call(() => learn(right, local.hab));
            const schema = new Schemer({ sed: { $id: "", type: "object" } });
            left.db.schema.pin(schema.said, schema);
            right.db.schema.pin(schema.said, schema);
            let embedded: SerderKERI;
            let attachments: Uint8Array = new Uint8Array();
            let support: Uint8Array[] = [];
            let fullGrant: ReturnType<typeof ipexCredentialGrant> | undefined;
            if (kind === "apply") [embedded, attachments] = ipexApplyExn(remote.hab, bob.pre, "apply", schema.said, {});
            else {
              const rgy = peerRuntime.vdr!;
              const registry = rgy.makeRegistry("grant-proof", bob);
              const credentialer = new Credentialer(right, { reger: rgy.reger, vry: rgy.vry });
              const creder = credentialer.create({
                registry,
                schema: schema.said,
                recipient: remote.hab.pre,
                data: {},
              });
              credentialer.issue(registry, creder);
              fullGrant = ipexCredentialGrant({
                hby: right,
                hab: remote.hab,
                reger: rgy.reger,
                recipient: bob.pre,
                credentialSaid: creder.said!,
                options: { gvrsn: genus },
                sign: false,
              });
              // A valid minimal grant can rely on the member's already verified
              // credential. The presenting group is the holder, not its issuer.
              [embedded, attachments] = ipexGrantExn(remote.hab, bob.pre, "grant", creder.raw, { gvrsn: genus });
              support = credentialStreamMessages(right, rgy.reger, creder, bob.pre, genus);
              if (genus.major === 2) {
                for (const message of support) {
                  yield* runtime.reactor.processBytes(message);
                }
              }
            }
            const partial = groupIpexPartial(right, remote.hab, embedded, attachments, genus);
            const hint = genus.major === 2 ? { cgvrsn: [2, 0] } : {};
            let initial: { serder: SerderKERI; message: Uint8Array } | undefined;
            peerRuntime.postman.sendStream = function (evt) {
              const message = concatBytes(...evt.msgs), serder = new SerderKERI({ raw: message });
              assertEquals(
                right.db.exns.get([serder.said!])?.raw,
                serder.raw,
                "Initial proposal must precede transmission",
              );
              initial = { serder, message };
              return { ...evt, msg: message, kin: "stream" };
            };
            let refuse = kind === "apply" && genus.major === 1;
            const refusal = new Error("initial IPEX delivery failed");
            peerRuntime.postman.wait = function* (evt) {
              if (refuse) {
                refuse = false;
                return { kin: "failed", evt, error: refusal, deliveries: [] };
              }
              return { kin: "sent", evt, deliveries: ["initial-transmission"] };
            };
            let failedSaid: string | undefined;
            if (refuse) {
              yield* call(() =>
                assertRejects(
                  () =>
                    run(() =>
                      publishInitialGroupIpex(
                        right,
                        peerRuntime.protocol,
                        peerRuntime.postman,
                        remote.hab,
                        partial,
                        genus,
                      )
                    ),
                  Error,
                  refusal.message,
                )
              );
              assertExists(initial);
              failedSaid = initial.serder.said!;
              yield* right.db.reopen();
            }
            const publication = yield* publishInitialGroupIpex(
              right,
              peerRuntime.protocol,
              peerRuntime.postman,
              remote.hab,
              partial,
              genus,
            );
            assertExists(initial);
            assertEquals(publication.messages.length, 1);
            assertEquals(publication.messages[0].exnSaid, initial.serder.said);
            if (failedSaid) {
              assertEquals(initial.serder.said, failedSaid, "Delivery failure must retain the original wrapper");
            }
            const wrapper = initial.serder;
            yield* runtime.reactor.processBytes(initial.message, { local: true });
            let outgoing: { serder: SerderKERI; message: Uint8Array } | undefined;
            // Substitute transmission only; the peer admits the actual signed outgoing bytes below.
            runtime.postman.send = function (evt) {
              const serder = new SerderKERI({ raw: evt.msg });
              assertEquals(serder.ked!.a, { gid: local.hab.pre, ...hint, i: bob.pre });
              assertEquals(
                left.db.exns.get([serder.said!])?.raw,
                serder.raw,
                "Local approval must precede transmission",
              );
              outgoing = { serder: serder, message: evt.msg };
              return { ...evt, kin: "msg" };
            };
            runtime.postman.wait = function* (evt) {
              return { kin: "sent", evt, deliveries: ["test"] };
            };
            if (kind === "grant") {
              const before = [...left.db.esigs.getTopItemIter([embedded.said!, ""])].map((
                [keys, siger],
              ) => [keys, siger.qb64]);
              yield* call(() =>
                assertRejects(
                  () => run(() => approveMultisigIpex(left, runtime.protocol, runtime.postman, null, wrapper)),
                  Error,
                  "did not open Reger",
                )
              );
              assertEquals(
                [...left.db.esigs.getTopItemIter([embedded.said!, ""])].map(([keys, siger]) => [keys, siger.qb64]),
                before,
              );
              assertEquals(runtime.exc.complete(embedded.said!), false);
              assertEquals(outgoing, undefined);
              if (genus.major === 1) {
                const pending = yield* approveMultisigIpex(
                  left,
                  runtime.protocol,
                  runtime.postman,
                  runtime.vdr!.reger,
                  wrapper,
                  { publish: true, sendLead: false },
                );
                assertEquals(pending.approved, null);
                assertEquals(pending.accepted, false);
                assertEquals(outgoing, undefined);
                for (const message of support) yield* runtime.reactor.processBytes(message);
                assertExists(fullGrant);
                const creder = new SerderACDC({ raw: fullGrant.artifacts.acdc.wire });
                const issuance = new SerderKERI({ raw: fullGrant.artifacts.iss.wire });
                const wrongProof = serializeCredential(
                  creder,
                  new Prefixer({ qb64: creder.said! }),
                  issuance.sner!,
                  new Diger({ qb64: schema.said }),
                );
                const [bad, badPaths] = ipexGrantExn(remote.hab, bob.pre, "bad source", wrongProof, {
                  iss: fullGrant.artifacts.iss.wire,
                  anc: fullGrant.artifacts.anc.wire,
                });
                const badPartial = groupIpexPartial(right, remote.hab, bad, badPaths);
                const [badWrapper, outerPaths] = exchange("/multisig/exn", { gid: remote.hab.pre, i: alice.pre }, {
                  sender: bob.pre,
                  embeds: { exn: badPartial },
                });
                yield* runtime.reactor.processBytes(
                  concatBytes(bob.endorse(badWrapper, { pipelined: false }), outerPaths),
                  { local: true },
                );
                yield* call(() =>
                  assertRejects(
                    () =>
                      run(() =>
                        approveMultisigIpex(left, runtime.protocol, runtime.postman, runtime.vdr!.reger, badWrapper, {
                          publish: true,
                          sendLead: false,
                        })
                      ),
                    Error,
                    "Credential source seal does not match",
                  )
                );
                assertEquals(
                  [...left.db.esigs.getTopItemIter([bad.said!, ""])].some(([, signature]) => signature.index === 0),
                  false,
                );
                assertEquals(outgoing, undefined);
              }
            }
            let selected = wrapper;
            if (kind === "apply" && genus.major === 2) {
              const handler = runtime.exc.routes.get("/multisig/exn")!, handle = handler.handle;
              const fault = new Error("interrupted before IPEX approval indexing");
              let interrupted: SerderKERI | undefined;
              handler.handle = function* (args) {
                if (args.serder.pre === alice.pre) {
                  interrupted = args.serder;
                  throw fault;
                }
                yield* call(() => handle.call(handler, args));
              };
              try {
                yield* call(() =>
                  assertRejects(
                    () =>
                      run(() =>
                        approveMultisigIpex(left, runtime.protocol, runtime.postman, runtime.vdr!.reger, wrapper, {
                          publish: true,
                          sendLead: false,
                        })
                      ),
                    Error,
                    fault.message,
                  )
                );
              } finally {
                handler.handle = handle;
              }
              assertExists(interrupted);
              assertEquals(runtime.exc.complete(interrupted.said!), true);
              yield* left.db.reopen();
              selected = interrupted;
            }
            const result = yield* approveMultisigIpex(
              left,
              runtime.protocol,
              runtime.postman,
              runtime.vdr!.reger,
              selected,
              {
                publish: true,
                sendLead: false,
              },
            );
            assertEquals(result.accepted, true);
            assertEquals(runtime.exc.complete(embedded.said!), true);
            assertExists(outgoing);
            if (selected !== wrapper) {
              assertEquals(outgoing.serder.said, selected.said, "Explicit resume must recover its unindexed wrapper");
            }
            yield* peerRuntime.reactor.processBytes(outgoing.message, { local: true });
            const peerResult = yield* approveMultisigIpex(
              right,
              peerRuntime.protocol,
              peerRuntime.postman,
              peerRuntime.vdr!.reger,
              outgoing.serder,
              {
                publish: false,
                sendLead: false,
              },
            );
            assertEquals(peerResult.accepted, true);
            assertEquals(peerRuntime.protocol.exc.complete(embedded.said!), true);
            const original = outgoing.serder;
            yield* left.db.reopen();
            alice.rotate();
            const sign = alice.mgr.sign;
            alice.mgr.sign = ((ser: Uint8Array, args: string[] | Parameters<typeof sign>[1], indexed?: boolean) => {
              // Ordinary Notifier records still use detached signatory signatures.
              if ((Array.isArray(args) ? indexed : args?.indexed) !== false) {
                throw new Error("IPEX resume must reuse the member contribution and original wrapper signatures");
              }
              return Reflect.apply(sign, alice.mgr, [ser, args, indexed]);
            }) as typeof sign;
            try {
              const resumed = yield* approveMultisigIpex(
                left,
                runtime.protocol,
                runtime.postman,
                runtime.vdr!.reger,
                selected,
                {
                  publish: true,
                  sendLead: false,
                },
              );
              assertEquals(resumed.accepted, true);
              assertEquals(resumed.approved, result.approved);
              assertEquals(resumed.messages, result.messages);
              assertEquals(outgoing.serder.said, original.said);
              yield* peerRuntime.reactor.processBytes(outgoing.message, { local: true });
              assertEquals(peerRuntime.exc.complete(embedded.said!), true);
            } finally {
              alice.mgr.sign = sign;
            }
          } finally {
            yield* peerRuntime.close();
            yield* runtime.close();
          }
        });
      });
    });
  }
}

Deno.test("group IPEX reuses a verified pending contribution after reopen instead of trusting a claimed local index", async () => {
  await participants(async (left, right, alice, bob) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
      try {
        yield* runtime.reactor.processBytes(messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }), {
          local: true,
        });
        yield* call(() => learn(right, local.hab));
        const [embedded] = ipexApplyExn(local.hab, bob.pre, "apply", alice.pre, {});
        const forged = bob.sign(embedded.raw, true)[0];
        const invalid = new TransIdxSigGroup(
          new Prefixer({ qb64: local.hab.pre }),
          local.serder.sner!,
          new Diger({ qb64: local.serder.said! }),
          [new Siger({ code: forged.code, raw: forged.raw, index: 0 })],
        );
        yield* runtime.reactor.processBytes(serializeMessage(embedded, { tsgs: [invalid] }), { local: true });
        const contributedKey = alice.kever!.verfers[0];
        alice.rotate(); // Member keys may advance before the group accepts a rotation.
        const approved = groupIpexPartial(left, local.hab, embedded);
        const proof = envelopeFromFrame(parseBytes(approved)[0]).tsgs[0].sigers[0];
        assertEquals(proof.index, 0);
        assertEquals(proof.ondex, undefined); // An endorsement does not assert prior-next rotation authority.
        assertEquals(contributedKey.verify(proof.raw, embedded.raw), true);
        assertEquals(alice.kever!.verfers[0].verify(proof.raw, embedded.raw), false);
        yield* runtime.reactor.processBytes(approved, { local: true });
        assertEquals(runtime.exc.complete(embedded.said!), false);
        assertExists(left.db.epse.get([embedded.said!]));
        yield* left.db.reopen();
        alice.rotate();
        const sign = alice.mgr.sign;
        alice.mgr.sign = () => {
          throw new Error("Pending approval must survive without new signing");
        };
        try {
          assertEquals(groupIpexPartial(left, local.hab, embedded), approved);
        } finally {
          alice.mgr.sign = sign;
        }
        const peer = groupIpexPartial(right, remote.hab, embedded);
        yield* runtime.reactor.processBytes(peer, { local: true });
        yield* runtime.protocol.processEscrowsOnce();
        assertEquals(runtime.exc.complete(embedded.said!), true);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("group TEL publication retains the original pending anchor across reopen", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      try {
        yield* runtime.reactor.processBytes(messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }), {
          local: true,
        });
        yield* call(() => learn(right, local.hab));
        runtime.postman.send = (evt) => ({ ...evt, kin: "msg" });
        runtime.postman.wait = function* (evt) {
          return { kin: "sent", evt, deliveries: ["test"] };
        };
        const result = yield* inceptCredentialRegistry(runtime.vdr!, runtime.reactor, runtime.postman, local.hab, {
          registryName: "pending",
        });
        const regk = result.registry!;
        const reger = runtime.vdr!.reger;
        assertEquals(result.group?.accepted, false);
        assertEquals(runtime.vdr!.publication.complete(regk), false);
        const [[keys, seal]] = [...reger.tmse.getTopItemIter()];
        assertEquals([keys[0], keys[2]], [regk, regk]);
        yield* reger.close();
        yield* reger.reopen();
        const resumed = new Regery(left, { reger });
        resumed.processEscrows();
        assertEquals(resumed.publication.complete(regk), false);
        const approval = right.interactGroupHab("group", mids, { data: [{ i: regk, s: "0", d: regk }] });
        assertEquals(approval.serder.said, seal[2].qb64);
        yield* runtime.reactor.processBytes(messagize(approval.serder, { sigers: approval.sigers }), { local: true });
        yield* runtime.protocol.processEscrowsOnce();
        assertEquals(left.db.kels.getLast(local.hab.pre, 1), approval.serder.said);
        resumed.processEscrows();
        assertEquals(resumed.publication.complete(regk), true);
        assertEquals(reger.regs.get("pending")?.registryKey, regk);
        assertEquals(reger.tels.getOn(regk, 0)?.qb64, regk);
        assertEquals([...reger.ctel.getTopItemIter()][0][1].qb64, approval.serder.said);

        // Prepare an actually issued credential under the two-member group. Both
        // anchors enter ordinary KEL/TEL intake; no accepted rows are seeded.
        yield* call(() => learn(right, local.hab));
        const schema = new Schemer({ sed: { $id: "", type: "object" } });
        left.db.schema.pin(schema.said, schema);
        const creder = credential({ issuer: local.hab.pre, registry: regk, schema: schema.said, data: {} });
        const issuance = issueCredential(creder.said!, regk);
        const data = [{ i: creder.said!, s: "0", d: issuance.said! }];
        const issuedLeft = left.interactGroupHab("group", mids, { data });
        const issuedRight = right.interactGroupHab("group", mids, { data });
        assertEquals(issuedLeft.serder.raw, issuedRight.serder.raw);
        const signed = messagize(issuedLeft.serder, { sigers: [...issuedLeft.sigers, ...issuedRight.sigers] });
        yield* runtime.reactor.processBytes(signed, { local: true });
        yield* call(() => learn(right, local.hab));
        const source = { seqner: issuedLeft.serder.sner!, saider: new Diger({ qb64: issuedLeft.serder.said! }) };
        assertEquals(resumed.tvy.processEvent({ serder: issuance, ...source }).kind, "accept");
        assertEquals(
          resumed.vry.processCredential({
            creder,
            prefixer: new Prefixer({ qb64: creder.said! }),
            seqner: issuance.sner!,
            saider: new Diger({ qb64: issuance.said! }),
          }).kind,
          "accept",
        );
        const registry = resumed.registryByName("pending")!;
        const rev = registry.prepareRevocation(creder.said!);
        const pendingAnchor = left.interactGroupHab("group", mids, {
          data: [{ i: rev.pre!, s: rev.snh!, d: rev.said! }],
        });
        const revSource = {
          seqner: pendingAnchor.serder.sner!,
          saider: new Diger({ qb64: pendingAnchor.serder.said! }),
        };
        assertEquals(resumed.tvy.processEvent({ serder: rev, ...revSource }).kind, "escrow");
        resumed.publication.track(rev, pendingAnchor.serder);
        yield* reger.reopen();
        const reopened = new Regery(left, { reger });
        const retry = reopened.registryByName("pending")!.revoke(creder.said!);
        assertEquals(retry.serder.raw, rev.raw);
        assertEquals(retry.seal.saider.qb64, pendingAnchor.serder.said);
        assertEquals(retry.decision.kind, "escrow");
        assertEquals(local.hab.kever!.said, issuedLeft.serder.said);
        const otherApproval = right.interactGroupHab("group", mids, {
          data: [{ i: rev.pre!, s: rev.snh!, d: rev.said! }],
        });
        assertEquals(otherApproval.serder.raw, pendingAnchor.serder.raw);
        yield* runtime.reactor.processBytes(messagize(otherApproval.serder, { sigers: otherApproval.sigers }), {
          local: true,
        });
        yield* runtime.protocol.processEscrowsOnce();
        reopened.processEscrows();
        assertEquals(reger.tels.getOn(creder.said!, 1)?.qb64, rev.said);
        assertEquals(reopened.publication.complete(creder.said!, 1), true);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("group establishment-only registry inception, issuance and revocation use rotation anchors", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      try {
        runtime.postman.send = (evt) => ({ ...evt, kin: "msg" });
        runtime.postman.wait = function* (evt) {
          return { kin: "sent", evt, deliveries: ["test"] };
        };
        // Participants advance their own KELs before a group establishment adopts those keys.
        alice.rotate();
        bob.rotate();
        yield* call(() => learn(left, bob));
        const registry = yield* inceptCredentialRegistry(runtime.vdr!, runtime.reactor, runtime.postman, local.hab, {
          registryName: "establishment",
          estOnly: true,
        });
        assertEquals(registry.group?.accepted, true);
        assertEquals(local.hab.kever!.ilk, "rot");
        const registryAnchor = local.hab.kever!.said;
        alice.rotate();
        bob.rotate();
        yield* call(() => learn(left, bob));
        const schemer = new Schemer({ sed: { $id: "", type: "object" } });
        left.db.schema.pin(schemer.said, schemer);
        const issued = yield* createCredential(runtime.vdr!, runtime.reactor, runtime.postman, {
          registryName: "establishment",
          schema: schemer.said,
          recipient: bob.pre,
          data: { role: "holder" },
        });
        assertEquals(issued.group?.saved, true);
        assertEquals(local.hab.kever!.ilk, "rot");
        assertNotEquals(local.hab.kever!.said, registryAnchor);
        const issuanceAnchor = local.hab.kever!.said;
        alice.rotate();
        bob.rotate();
        yield* call(() => learn(left, bob));
        const revoked = yield* revokeCredential(runtime.vdr!, runtime.reactor, runtime.postman, {
          registryName: "establishment",
          credentialSaid: issued.creder.said!,
        });
        assertEquals(revoked.accepted, true);
        assertEquals(local.hab.kever!.ilk, "rot");
        assertNotEquals(local.hab.kever!.said, issuanceAnchor);
        alice.rotate();
        bob.rotate();
        yield* call(() => learn(left, bob));
        left.rotateGroupHab("group");
        const delivered = yield* deliverCredentialRevocation(runtime.vdr!, runtime.postman, issued.creder.said!, [
          bob.pre,
        ]);
        assertEquals(
          delivered.length > 0,
          true,
          "A later group/member rotation must retain the original anchor's lead",
        );
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("VDR proposal preflight refuses mismatched evidence and waits for schema before signing", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, { notifier });
      try {
        runtime.postman.send = (evt) => ({ ...evt, kin: "msg" });
        runtime.postman.wait = function* (evt) {
          return { kin: "sent", evt, deliveries: ["test"] };
        };
        const rgy = runtime.vdr!;
        const registry = yield* inceptCredentialRegistry(rgy, runtime.reactor, runtime.postman, local.hab, {
          registryName: "registry",
        });
        const state = left.db.getState(local.hab.pre);
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                inceptCredentialRegistry(rgy, runtime.reactor, runtime.postman, local.hab, { registryName: "registry" })
              ),
            Error,
            "already identifies",
          )
        );
        assertEquals(left.db.getState(local.hab.pre), state);
        let prompts = 0;
        const callbacks = {
          approveProposal: () => {
            prompts++;
            return true;
          },
          chooseGroupAlias: () => "unused",
          chooseRegistryName: () => "untrusted-registry",
        };
        const schemer = new Schemer({
          sed: {
            $id: "",
            type: "object",
            properties: { a: { type: "object", properties: { role: { type: "string" } } } },
          },
        });
        const valid = credential({
          issuer: local.hab.pre,
          registry: registry.registry!,
          schema: schemer.said,
          recipient: bob.pre,
          data: { role: "holder" },
        });

        /** Store an authenticated peer wrapper without lending its signature to the group anchor. */
        const submit = function* (creder: SerderACDC, wrongSource = false, wrongPredecessor = false) {
          const issued = issueCredential(creder.said!, registry.registry!);
          const predecessor = wrongPredecessor ? bob.kever!.said : local.hab.kever!.said;
          const anchor = interactEvent(local.hab.pre, predecessor, local.hab.kever!.sn + 1, [{
            i: issued.pre,
            s: "0",
            d: issued.said,
          }]);
          const [wrapper, paths] = exchange("/multisig/iss", { gid: local.hab.pre, cgvrsn: [2, 0] }, {
            sender: bob.pre,
            embeds: {
              acdc: serializeCredential(
                creder,
                new Prefixer({ qb64: issued.pre! }),
                NumberPrimitive.fromNum(0n),
                new Diger({ qb64: wrongSource ? registry.registry! : issued.said! }),
                Vrsn_2_0,
              ),
              iss: issued.raw,
              anc: messagize(anchor, { sigers: remote.hab.sign(anchor.raw, true), gvrsn: Vrsn_2_0 }),
            },
          });
          yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), paths), {
            local: true,
          });
          return { wrapper, anchor };
        };
        const pending = yield* submit(valid);
        assertEquals(
          yield* approvePendingMultisigProposal(left, runtime, { said: pending.wrapper.said!, callbacks }),
          null,
        );
        assertEquals(prompts, 0);
        assertEquals(left.db.getSigs(local.hab.pre, pending.anchor.said!), []);
        assertEquals(left.db.getState(local.hab.pre), state);
        left.db.schema.pin(schemer.said, schemer);

        const badSource = yield* submit(valid, true);
        yield* call(() =>
          assertRejects(
            () =>
              run(() => approvePendingMultisigProposal(left, runtime, { said: badSource.wrapper.said!, callbacks })),
            Error,
            "source seal",
          )
        );
        const badPredecessor = yield* submit(valid, false, true);
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                approvePendingMultisigProposal(left, runtime, { said: badPredecessor.wrapper.said!, callbacks })
              ),
            Error,
            "anchor predecessor",
          )
        );
        const invalid = credential({
          issuer: local.hab.pre,
          registry: registry.registry!,
          schema: schemer.said,
          recipient: bob.pre,
          data: { role: 5 },
        });
        const badSchema = yield* submit(invalid);
        yield* call(() =>
          assertRejects(
            () =>
              run(() => approvePendingMultisigProposal(left, runtime, { said: badSchema.wrapper.said!, callbacks })),
            Error,
            "schema validation",
          )
        );
        const foreignVcp = inceptRegistry(bob.pre, { cnfg: ["NB"] });
        const foreignAnchor = interactEvent(local.hab.pre, local.hab.kever!.said, local.hab.kever!.sn + 1, [{
          i: foreignVcp.pre,
          s: "0",
          d: foreignVcp.said,
        }]);
        const [foreign, paths] = exchange("/multisig/vcp", { gid: local.hab.pre, cgvrsn: [2, 0] }, {
          sender: bob.pre,
          embeds: {
            vcp: foreignVcp.raw,
            anc: messagize(foreignAnchor, { sigers: remote.hab.sign(foreignAnchor.raw, true), gvrsn: Vrsn_2_0 }),
          },
        });
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(foreign, { pipelined: false }), paths), {
          local: true,
        });
        yield* call(() =>
          assertRejects(
            () => run(() => approvePendingMultisigProposal(left, runtime, { said: foreign.said!, callbacks })),
            Error,
            "issuer does not match",
          )
        );
        assertEquals(prompts, 0);
        assertEquals(left.db.getState(local.hab.pre), state);
        for (const anchor of [badSource.anchor, badPredecessor.anchor, badSchema.anchor, foreignAnchor]) {
          assertEquals(left.db.getSigs(local.hab.pre, anchor.said!), []);
        }
        assertEquals(rgy.reger.regs.get("untrusted-registry"), null);
        const completed = yield* approvePendingMultisigProposal(left, runtime, {
          said: pending.wrapper.said!,
          callbacks,
        });
        assertEquals(completed?.accepted, true);
        assertEquals(prompts, 1);
        assertExists(rgy.reger.saved.get([valid.said!]));
        const issuedState = left.db.getState(local.hab.pre);
        const wrongPrior = revokeCredentialEvent(valid.said!, registry.registry!, registry.registry!);
        const revAnchor = interactEvent(local.hab.pre, local.hab.kever!.said, local.hab.kever!.sn + 1, [{
          i: wrongPrior.pre!,
          s: "1",
          d: wrongPrior.said!,
        }]);
        const [revWrapper, revPaths] = exchange("/multisig/rev", {
          gid: local.hab.pre,
          said: valid.said!,
          cgvrsn: [2, 0],
        }, {
          sender: bob.pre,
          embeds: {
            rev: wrongPrior.raw,
            anc: messagize(revAnchor, { sigers: remote.hab.sign(revAnchor.raw, true), gvrsn: Vrsn_2_0 }),
          },
        });
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(revWrapper, { pipelined: false }), revPaths), {
          local: true,
        });
        yield* call(() =>
          assertRejects(
            () => run(() => approvePendingMultisigProposal(left, runtime, { said: revWrapper.said!, callbacks })),
            Error,
            "predecessor does not match",
          )
        );
        assertEquals(prompts, 1);
        assertEquals(left.db.getState(local.hab.pre), issuedState);
        assertEquals(left.db.getSigs(local.hab.pre, revAnchor.said!), []);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("VDR approval without a registry preserves decline and fails before accepting the anchor", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    const registry = inceptRegistry(local.hab.pre, { cnfg: ["NB"] });
    const anchor = right.interactGroupHab("group", mids, { data: [{ i: registry.pre, s: "0", d: registry.said }] });
    const [wrapper, paths] = exchange("/multisig/vcp", { gid: local.hab.pre }, {
      sender: bob.pre,
      embeds: { vcp: registry.raw, anc: messagize(anchor.serder, { sigers: anchor.sigers, gvrsn: Vrsn_1_0 }) },
    });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock, {
        notifier,
      });
      try {
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), paths), {
          local: true,
        });
        const unavailable = { ...runtime, vdr: null };
        const callbacks = {
          approveProposal: () => false,
          chooseGroupAlias: () => "group",
          chooseRegistryName: () => "registry",
        };
        assertEquals(yield* approvePendingMultisigProposal(left, unavailable, { callbacks }), null);
        callbacks.approveProposal = () => true;
        const before = left.db.getKever(local.hab.pre)?.said;
        const signatures = left.db.getSigs(local.hab.pre, anchor.serder.said!);
        yield* call(() =>
          assertRejects(
            () => run(() => approvePendingMultisigProposal(left, unavailable, { callbacks })),
            Error,
            "registry is unavailable",
          )
        );
        assertEquals(left.db.getKever(local.hab.pre)?.said, before);
        assertEquals(left.db.getSigs(local.hab.pre, anchor.serder.said!), signatures);
        assertEquals(runtime.vdr!.reger.tels.getOn(registry.pre!, 0), null);
        assertNotEquals(notifier.count(), 0);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("group credential producers publish typed evidence and usable proposal-index identities", async () => {
  await participants(async (left, right, alice, bob) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "1", nsith: "1", toad: 0 });
    await run(function* () {
      const runtime = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
      const peerRuntime = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
      try {
        const wires: Uint8Array[] = [];
        runtime.postman.send = function (evt) {
          assertEquals(evt.dest, bob.pre);
          wires.push(evt.msg);
          return { ...evt, kin: "msg" };
        };
        runtime.postman.wait = function* (evt) {
          return { kin: "sent", evt, deliveries: ["peer"] };
        };
        const registry = yield* inceptCredentialRegistry(runtime.vdr!, runtime.reactor, runtime.postman, local.hab, {
          registryName: "typed",
        });
        const vcp = new SerderKERI({ raw: wires[0] });
        const vcpEmbeds = vcp.ked!.e as { d: string; vcp: { d: string } };
        assertEquals(Object.keys(vcpEmbeds), ["vcp", "anc", "d"]);
        assertExists(registry.group);
        assertEquals(registry.group.status, "accept");
        assertEquals(registry.group.accepted, true);
        assertEquals(registry.group.deliveries, ["peer"]);
        assertEquals(runtime.vdr!.reger.tels.getOn(registry.registry!, 0)?.qb64, vcpEmbeds.vcp.d);
        assertEquals(registry.group.messages, [{
          recipient: bob.pre,
          exnSaid: vcp.said,
          payloadSaid: vcpEmbeds.d,
        }]);
        const schema = new Schemer({ sed: { type: "object" } });
        left.db.schema.pin(schema.said, schema);
        const issued = yield* createCredential(runtime.vdr!, runtime.reactor, runtime.postman, {
          registryName: "typed",
          schema: schema.said,
          recipient: bob.pre,
          data: { role: "holder" },
        });
        const iss = new SerderKERI({ raw: wires[1] });
        const issEmbeds = iss.ked!.e as { d: string };
        assertEquals(Object.keys(issEmbeds), ["acdc", "iss", "anc", "d"]);
        assertExists(issued.group);
        assertEquals(issued.recipient, bob.pre);
        assertEquals(issued.status, "accept");
        assertEquals(issued.group.telStatus, "accept");
        assertEquals(issued.group.saved, true);
        assertEquals(issued.group.deliveries, ["peer"]);
        assertEquals(runtime.vdr!.reger.tels.getOn(issued.creder.said!, 0)?.qb64, issued.tel);
        assertEquals(issued.group.messages, [{
          recipient: bob.pre,
          exnSaid: iss.said,
          payloadSaid: issEmbeds.d,
        }]);
        for (const wire of wires) {
          const wrapper = new SerderKERI({ raw: wire });
          const identity = (wrapper.ked!.e as { d: string }).d;
          yield* peerRuntime.reactor.processBytes(wire, { local: true });
          assertEquals(peerRuntime.exc.complete(wrapper.said!), true);
          assertEquals(right.db.meids.get([identity]).map((said) => said.qb64), [wrapper.said]);
        }
      } finally {
        yield* peerRuntime.close();
        yield* runtime.close();
      }
    });
  });
});

Deno.test("ACDC v2 registry group proposals retain peer evidence until exact local approval", async () => {
  await participants(async (left, right, alice, bob) => {
    const members = [alice.pre, bob.pre];
    const local = left.makeGroupHab("acdc-v2-group", alice, members, members, undefined, { isith: "2", nsith: "2" });
    const remote = right.makeGroupHab("acdc-v2-group", bob, members, members, undefined, { isith: "2", nsith: "2" });
    await run(function* () {
      const receiver = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
      const sender = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
      try {
        for (const runtime of [receiver, sender]) {
          yield* runtime.reactor.processBytes(
            messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }),
            { local: true },
          );
        }
        const rip = acdcV2Regcept(local.hab.pre);
        const anchor = right.interactGroupHab("acdc-v2-group", undefined, { data: [{ s: "0", d: rip.said! }] }).serder;
        const telFrame = parseBytes(
          concatBytes(
            rip.raw,
            Counter.enclose({ code: "AttachmentGroup", qb64: new Uint8Array(), version: Vrsn_2_0 }),
          ),
        )[0];
        const kelFrame =
          parseBytes(messagize(anchor, { sigers: remote.hab.sign(anchor.raw, true), gvrsn: Vrsn_1_0 }))[0];
        const root = new Salter({ code: MtrDex.Salt_128, raw: new Uint8Array(16).fill(37) });
        const salts = Object.fromEntries(
          [alice, bob].map(
            (member) => [
              member.pre,
              new Encrypter({ verkey: member.kever!.verfers[0].qb64 }).encrypt({ prim: root }).qb64,
            ],
          ),
        );
        const wrapper = exchange("/multisig/rip", { gid: local.hab.pre, tel: rip.said!, anc: anchor.said!, salts }, {
          sender: bob.pre,
          version: Vrsn_2_0,
        })[0];
        const candidate = { serder: wrapper, nests: [telFrame, kelFrame], tsgs: proof(bob, wrapper) };
        assertEquals((yield* receiver.exc.processEvent(candidate)).kind, "accept");
        assertEquals(acdcV2RegistryProposal(wrapper, candidate.nests)!.salts, salts);
        const invalidCopies = exchange("/multisig/rip", {
          gid: local.hab.pre,
          tel: rip.said!,
          anc: anchor.said!,
          salts: { [local.hab.pre]: salts[alice.pre] },
        }, { sender: bob.pre, version: Vrsn_2_0 })[0];
        assertEquals(
          (yield* receiver.exc.processEvent({ ...candidate, serder: invalidCopies, tsgs: proof(bob, invalidCopies) }))
            .kind,
          "reject",
        );
        assertEquals(receiver.acdc!.store.head(rip.said!), null, "peer proposal is not member consent");
        assertEquals(
          yield* approvePendingMultisigProposal(left, receiver, {
            said: wrapper.said!,
            callbacks: {
              approveProposal: () => false,
              chooseGroupAlias: () => "acdc-v2-group",
              chooseRegistryName: () => "registry",
            },
          }),
          null,
        );
        assertEquals(
          receiver.acdc!.store.head(rip.said!),
          null,
          "declining the actual CLI approval path remains inert",
        );
        const [approval, approvalFoot] = yield* approveAcdcV2Registry(left, receiver.protocol, local.hab, rip, {
          anchor,
        });
        assertEquals(receiver.exc.complete(approval.said!), true);
        yield* receiver.protocol.processEscrowsOnce();
        assertEquals(left.db.getKever(local.hab.pre)?.serder.said, anchor.said);
        assertEquals(receiver.acdc!.store.head(rip.said!)?.qb64, rip.said);
        yield* sender.reactor.processBytes(concatBytes(approval.raw, approvalFoot));
        const [peer, peerFoot] = yield* approveAcdcV2Registry(right, sender.protocol, remote.hab, rip, { anchor });
        yield* receiver.reactor.processBytes(concatBytes(peer.raw, peerFoot));
        assertEquals(sender.acdc!.store.head(rip.said!)?.qb64, rip.said);
        const sealed = local.hab.kever!.serder.said;
        yield* approveAcdcV2Registry(left, receiver.protocol, local.hab, rip);
        assertEquals(local.hab.kever!.serder.said, sealed, "exact accepted retry reuses its verified group anchor");
        const credential = acdcV2Map(local.hab.pre, {
          regid: rip.said!,
          attribute: { d: "", i: alice.pre, role: "group holder" },
        });
        let prior = rip.said!;
        for (const [index, state] of ["issued", "revoked"].entries()) {
          const opening = makeBlindState({ acdc: credential.said!, state, sn: BigInt(index + 1) });
          const event = acdcV2Blindate(rip.said!, prior, opening.d.nonce, { sn: index + 1 });
          const [first, firstFoot] = yield* approveAcdcV2Registry(left, receiver.protocol, local.hab, event, {
            opening,
            salts,
          });
          assertEquals(first.route, "/multisig/bup");
          assertEquals(receiver.acdc!.store.head(rip.said!)?.qb64, prior, "a local share is not threshold acceptance");
          yield* sender.reactor.processBytes(concatBytes(first.raw, firstFoot));
          assertEquals(sender.acdc!.store.head(rip.said!)?.qb64, prior, "receipt is not explicit peer consent");
          const nests = loadNests(right.db, first.said!), selected = acdcV2RegistryProposal(first, nests)!;
          const disclosed = envelopeFromFrame(nests[0]).bsqs[0];
          assertEquals(selected.tel.raw, event.raw);
          assertEquals(selected.salts, salts);
          const [second, secondFoot] = yield* approveAcdcV2Registry(right, sender.protocol, remote.hab, selected.tel, {
            anchor: selected.anchor,
            opening: disclosed,
            salts: selected.salts,
          });
          yield* receiver.reactor.processBytes(concatBytes(second.raw, secondFoot));
          yield* receiver.protocol.processEscrowsOnce();
          for (const runtime of [receiver, sender]) {
            assertEquals(runtime.acdc!.store.head(rip.said!)?.qb64, event.said);
            assertExists(runtime.acdc!.store.opening(event.said!));
          }
          prior = event.said!;
        }
        for (const hby of [left, right]) {
          yield* hby.ks.reopen();
          yield* hby.db.reopen();
        }
        for (const runtime of [receiver, sender]) yield* runtime.acdc!.baser.reopen();
        assertEquals((yield* receiver.exc.processEvent(candidate)).kind, "accept");
        assertEquals(
          receiver.acdc!.store.head(rip.said!)?.qb64,
          prior,
          "old proposal replay cannot lower accepted history",
        );

        const wrong = exchange("/multisig/rip", { gid: local.hab.pre, tel: alice.pre, anc: anchor.said! }, {
          sender: bob.pre,
          version: Vrsn_2_0,
        })[0];
        assertEquals(
          (yield* receiver.exc.processEvent({ ...candidate, serder: wrong, tsgs: proof(bob, wrong) })).kind,
          "reject",
        );
      } finally {
        yield* sender.close();
        yield* receiver.close();
      }
    });
  });
});

for (const verdict of ["true", "false", "unresolved"] as const) {
  Deno.test(`ACDC v2 group signing requires exact authenticated root truth: ${verdict}`, async () => {
    await participants(async (left, right, alice, bob) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("acdc-v2-signing", alice, mids, mids, undefined, { isith: "2", nsith: "2" });
      const remote = right.makeGroupHab("acdc-v2-signing", bob, mids, mids, undefined, { isith: "2", nsith: "2" });
      await run(function* () {
        const receiver = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
        const sender = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
        try {
          for (const runtime of [receiver, sender]) {
            yield* runtime.reactor.processBytes(
              messagize(local.serder, { sigers: [...local.sigers, ...remote.sigers] }),
              { local: true },
            );
          }
          const schema = new Schemer({
            sed: { $id: "", version: "1.0.0", type: "object", additionalProperties: true },
          });
          right.db.schema.pin(schema.said, schema);
          if (verdict !== "true") left.db.schema.pin(schema.said, schema);
          const full = acdcV2Map(bob.pre, {
            schema: schema.said,
            attribute: { d: "", i: verdict === "false" ? alice.pre : bob.pre, role: "authority" },
          });
          const far = verdict === "unresolved"
            ? acdcV2Map(bob.pre, { schema: schema.said, attribute: (full.sad!.a as { d: string }).d })
            : full;
          const near = acdcV2Map(bob.pre, {
            schema: schema.said,
            attribute: { d: "", i: local.hab.pre },
            edge: { d: "", authority: { n: far.said! } },
          });
          const nodes = [near, far].map((body) => ({
            body,
            gvrsn: Vrsn_2_0,
            attachments: messageAttachmentGroups({ tsgs: proof(bob, body) }, Vrsn_2_0),
          }));
          const grant = ipexExnBody(local.hab.pre, "/ipex/grant", [near, far], {
            recipient: alice.pre,
            xid: near.said!,
            message: "exact group view",
            plan: [[schema.said, "/", []], [schema.said, "/e/authority/_/", []]],
          });
          const candidate = yield* call(() =>
            collectPayload(framePayload({ body: grant, gvrsn: Vrsn_2_0, attachments: [], nests: nodes }))
          );
          const oldSign = local.hab.sign.bind(local.hab);
          let signs = 0;
          // A call-through spy observes the private-key boundary; all authentication and signing stay real.
          local.hab.sign = ((...args: Parameters<Hab["sign"]>) => {
            signs++;
            return oldSign(...args);
          }) as Hab["sign"];
          if (verdict !== "true") {
            yield* call(() =>
              assertRejects(
                () => run(() => prepareAcdcV2GroupIpex(left, receiver.protocol, local.hab, candidate)),
                ValidationError,
                "false or unresolved",
              )
            );
            assertEquals(signs, 0);
            assertEquals(receiver.exc.complete(grant.said!), false);
          } else {
            assertEquals(yield* prepareAcdcV2GroupIpex(left, receiver.protocol, local.hab, candidate), null);
            assertEquals(signs, 0, "missing own schema cannot reach member signing");
            left.db.schema.pin(schema.said, schema);
            const first = yield* prepareAcdcV2GroupIpex(left, receiver.protocol, local.hab, candidate);
            assertExists(first);
            assertEquals(signs, 1);
            assertEquals(receiver.exc.complete(grant.said!), false);
            assertEquals(yield* prepareAcdcV2GroupIpex(left, receiver.protocol, local.hab, candidate), first);
            assertEquals(signs, 1, "exact retry reuses the verified member contribution");
            const second = yield* prepareAcdcV2GroupIpex(right, sender.protocol, remote.hab, first);
            assertExists(second);
            yield* receiver.reactor.processBytes(second, { local: true });
            assertEquals(sender.exc.complete(grant.said!), true);
            assertEquals(receiver.exc.complete(grant.said!), true);
            assertEquals(left.db.exns.get([grant.said!])?.raw, grant.raw);
            bob.rotate();
            yield* call(() => learn(left, bob));
            assertEquals(receiver.exc.complete(grant.said!), true, "protocol completion remains historical");
            yield* call(() =>
              assertRejects(
                () =>
                  run(() =>
                    sendCompletedGroupIpex(
                      left,
                      receiver.postman,
                      null,
                      local.hab,
                      grant,
                      Vrsn_2_0,
                      receiver.acdc!.store,
                      receiver.exc,
                    )
                  ),
                ValidationError,
                "unavailable",
              )
            );
            assertEquals(left.db.exns.get([grant.said!])?.raw, grant.raw);
          }
        } finally {
          yield* sender.close();
          yield* receiver.close();
        }
      });
    });
  });
}
