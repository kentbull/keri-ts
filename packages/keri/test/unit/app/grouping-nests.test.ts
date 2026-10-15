/** Real nested multisig admission and approval replay; wrapper signatures never authorize child events. */
import {
  b,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  discardFrame,
  essrPayload,
  framePayload,
  MemoryPayloadSink,
  nestedPayload,
  NumberPrimitive,
  type OwnedPayload,
  parseBytes,
  Prefixer,
  ResourcePolicy,
  SerderACDC,
  SerderKERI,
  Siger,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { groupEndorseReply } from "../../../src/app/endpoint-roleing.ts";
import { type ExchangeInput, Exchanger } from "../../../src/app/exchanging.ts";
import {
  loadMultisigHandlers,
  type MultisigEventProposal,
  multisigExnBody,
  multisigInceptExn,
  multisigInteractExn,
  type MultisigMessage,
  multisigPathedAttachment,
  multisigRotateExn,
  type MultisigRoute,
  multisigRpyExn,
  prepareMultisigEventExn,
} from "../../../src/app/grouping.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { approveMultisigIpex, groupIpexPartial } from "../../../src/app/ipex-grouping.ts";
import { ipexApplyExn } from "../../../src/app/ipexing.ts";
import { publishProposal, waitForOneApproval } from "../../../src/app/multisig-workflows.ts";
import { Notifier, openNoterForHabery } from "../../../src/app/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { reply as replyEvent } from "../../../src/core/protocol-eventing.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { messageAttachmentGroups, messagize, serializeMessage } from "../../../src/core/protocol-serialization.ts";
import { incept as inceptRegistry, issue as issueCredential } from "../../../src/core/protocol-vdr-eventing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { Reger } from "../../../src/db/reger.ts";
import { credential, serializeCredential } from "../../../src/vdr/credentialing.ts";
import framing714 from "../../fixtures/multisig-framing-714.json" with { type: "json" };

// @ts-expect-error Event publication cannot accept a registry proposal.
void ({ route: "/multisig/vcp", attrs: { gid: "group" } } satisfies Parameters<typeof publishProposal>[3]);
// @ts-expect-error Inception derives gid from its child instead of accepting a second identity.
void ({ route: "/multisig/icp", attrs: { gid: "group", smids: [], rmids: [] } } satisfies MultisigEventProposal);
// @ts-expect-error Rotation requires its rotation members as well as signing members.
void ({ route: "/multisig/rot", attrs: { gid: "group", smids: [] } } satisfies MultisigEventProposal);
// @ts-expect-error Reply proposals do not carry interaction member fields.
void ({ route: "/multisig/rpy", attrs: { gid: "group", smids: [] } } satisfies MultisigEventProposal);

/** Sign just the wrapper body with its sender's accepted establishment keys. */
function proof(sender: Hab, serder: SerderKERI): TransIdxSigGroup[] {
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
      try {
        await run(() => dispatchEnvelope(envelopeFromFrame(frame, true), target.rvy, target.kevery));
      } finally {
        await discardFrame(frame);
      }
    }
  }
}

/** Keep two independent participant stores and one real notifier for each scenario. */
async function participants(
  test: (left: Habery, right: Habery, alice: Hab, bob: Hab, notifier: Notifier) => Promise<void>,
) {
  await run(function*() {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(left);
    try {
      const alice = left.makeHab("alice");
      const bob = right.makeHab("bob");
      yield* call(() => learn(left, bob));
      yield* call(() => learn(right, alice));
      yield* call(() => test(left, right, alice, bob, new Notifier(left, { noter })));
    } finally {
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
    }
  });
}

Deno.test("multisig publication records its actual local proposal before delivery and accepts a later peer proof", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function*() {
      const runtime = yield* createAgentRuntime(left, { mode: "local", notifier });
      try {
        let delivered: SerderKERI | undefined;
        // Only transmission is substituted; preparation, signing, intake and replay use real owners.
        runtime.poster.sendPreparedExchange = function*(sender, args) {
          assertEquals(sender, alice);
          assertEquals(args.recipient, bob.pre);
          assertEquals(args.serder.ked!.a, { gid: local.hab.pre, smids: mids, rmids: mids, i: bob.pre });
          const embeds = args.serder.ked!.e;
          assertExists(embeds);
          assertEquals(Object.keys(embeds), ["icp", "d"]);
          assertEquals(left.db.exns.get([args.serder.said!])?.raw, args.serder.raw);
          assertEquals(runtime.reactor.exchanger.complete(args.serder.said!), true);
          const embedded = (args.serder.ked!.e as { d: string }).d;
          assertEquals(left.db.maids.get([embedded]).map((p) => p.qb64), [alice.pre]);
          delivered = args.serder;
          return { serder: args.serder, deliveries: ["test-transmission"], queued: [] };
        };
        const deliveries = yield* publishProposal(runtime, alice, mids, {
          route: "/multisig/icp",
          attrs: { smids: mids, rmids: mids },
        }, messagize(local.serder, { sigers: local.sigers, gvrsn: Vrsn_1_0 }));
        assertEquals(deliveries, ["test-transmission"]);
        assertExists(delivered);
        assertEquals(left.db.getKever(local.hab.pre), null);
        assertEquals(notifier.list().length, 0);
        const [peer, paths] = yield* multisigInceptExn(
          bob,
          mids,
          mids,
          messagize(remote.serder, { sigers: remote.sigers, gvrsn: Vrsn_1_0 }),
        );
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(peer, { pipelined: false }), paths), {
          local: true,
        });
        yield* runtime.reactor.processEscrowsOnce();
        assertEquals(left.db.getKever(local.hab.pre)?.said, local.serder.said);
        assertEquals(notifier.list().length, 0);
      } finally {
        yield* runtime.close();
      }
    });
  });
});

Deno.test("multisig approval honors signed child genus through KEL, replies, registry and credential issuance", async () => {
  await participants(async (left, right, alice, bob, notifier) => {
    const mids = [alice.pre, bob.pre];
    const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
    await run(function*() {
      const runtime = yield* createAgentRuntime(left, { mode: "local", notifier });
      try {
        runtime.poster.sendPreparedExchange = function*(_sender, args) {
          if (args.serder.route === "/multisig/icp") {
            assertEquals(args.serder.ked!.a, {
              gid: local.hab.pre,
              smids: mids,
              rmids: mids,
              cgvrsn: [2, 0],
              i: bob.pre,
            });
          }
          if (["/multisig/rpy", "/multisig/vcp", "/multisig/iss"].includes(args.serder.route!)) {
            assertEquals(args.serder.ked!.a, {
              gid: local.hab.pre,
              cgvrsn: [2, 0],
              ...(args.serder.route === "/multisig/vcp" ? { usage: "group credentials" } : {}),
              i: bob.pre,
            });
          }
          if (args.serder.route === "/multisig/iss") {
            const sad = args.serder.ked!.e as Record<string, unknown>;
            const child = new SerderACDC({ sad: sad.acdc as Record<string, unknown> });
            const proof = multisigPathedAttachment(left, args.serder.said!, "acdc");
            const frames = yield* call(() => parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), child.raw, proof)));
            try {
              assertEquals(frames.length, 1);
              const seals = envelopeFromFrame(frames[0]).ssts;
              assertEquals(seals.length, 1);
              assertEquals([seals[0].i.qb64, seals[0].s.num, seals[0].d.qb64], [issuance.pre, 0n, issuance.said]);
            } finally {
              for (const frame of frames) yield* call(() => discardFrame(frame));
            }
          }
          return { serder: args.serder, deliveries: ["test"], queued: [] };
        };
        const [peer, paths] = exchange("/multisig/icp", {
          gid: local.hab.pre,
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
        const result = yield* waitForOneApproval(left, runtime, {
          pollTurns: 1,
          pollBudgetMs: 1,
          callbacks: {
            approveProposal: () => true,
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "registry",
          },
        });
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
        const replyResult = yield* waitForOneApproval(left, runtime, {
          pollTurns: 1,
          pollBudgetMs: 1,
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
        const registryResult = yield* waitForOneApproval(left, runtime, {
          pollTurns: 1,
          pollBudgetMs: 1,
          callbacks: {
            approveProposal: () => true,
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "registry",
          },
        });
        assertEquals(registryResult?.accepted, true);
        assertEquals(left.db.getKever(local.hab.pre)?.said, anchor.serder.said);
        assertInstanceOf(runtime.vdr.reger, Reger);
        assertEquals(runtime.vdr.reger.tels.getOn(registry.pre!, 0)?.qb64, registry.said);
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
        const issueResult = yield* waitForOneApproval(left, runtime, {
          pollTurns: 1,
          pollBudgetMs: 1,
          callbacks: {
            approveProposal: () => true,
            chooseGroupAlias: () => "group",
            chooseRegistryName: () => "registry",
          },
        });
        assertEquals(issueResult?.accepted, true);
        assertEquals(runtime.vdr.reger.tels.getOn(creder.said!, 0)?.qb64, issuance.said);
        assertExists(runtime.vdr.reger.saved.get([creder.said!]));
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
            try {
              const decision = await run(() =>
                dispatchEnvelope(envelopeFromFrame(frame, true), left.rvy, left.kevery, exchanger)
              );
              assertEquals(decision?.kind, "accept");
            } finally {
              await discardFrame(frame);
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

for (const remoteFirst of [false, true]) {
  Deno.test(`nested multisig merges real child signatures after approval (${remoteFirst ? "remote" : "local"} first)`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      assertEquals(local.serder.raw, remote.serder.raw);
      const resources = new ResourcePolicy();
      const [own] = await parseBytes(
        messagize(local.serder, { sigers: local.sigers, gvrsn: Vrsn_2_0, genusify: true }),
        { resources },
      );
      const [other] = await parseBytes(
        messagize(remote.serder, { sigers: remote.sigers, gvrsn: Vrsn_2_0, genusify: true }),
        { resources },
      );
      try {
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
        await run(function*() {
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
          await discardFrame(invalid);
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
        assertEquals(Array.from(Deno.readDirSync(`${left.db.path}/payloads/staging`)).length, 0);
      } finally {
        await discardFrame(own);
        await discardFrame(other);
        assertEquals(resources.used.bytes, 0);
      }
    });
  });
}

Deno.test("nested multisig rejects bad commitments and parent signatures before publication", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    try {
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
      assertEquals(left.db.enstStaging.getTopItemIter().next().done, true);
    } finally {
      await discardFrame(child);
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
      try {
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
      } finally {
        for (const frame of frames) await discardFrame(frame);
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
    try {
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
      await run(function*() {
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
    } finally {
      await discardFrame(child);
    }
  });
});

Deno.test("nested multisig publication failure preserves rows and cannot record local approval", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    try {
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
      assertEquals(Array.from(left.db.enstStaging.sdb.getKeys()).length, 0);
      assertEquals(notifier.list().length, 1);
    } finally {
      await discardFrame(child);
    }
  });
});

Deno.test("cancelled nested multisig publication releases its stage without recording approval", async () => {
  await participants(async (left, _right, alice, bob, notifier) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    const wire = b("4BABYWJj");
    const sink = new MemoryPayloadSink();
    await sink.write(wire);
    const payload = essrPayload(await sink.finish(), 1, 3, Vrsn_2_0);
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let closed = false;
    child.essr = {
      ...payload,
      wire: {
        size: wire.length,
        /** Hold the actual nested serializer at owned I/O until scope cancellation. */
        async *open(signal) {
          try {
            entered();
            await new Promise<void>((_resolve, reject) =>
              signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })
            );
            yield wire;
          } finally {
            closed = true;
          }
        },
      },
    };
    const exchanger = new Exchanger(left);
    loadMultisigHandlers(left, exchanger, { notifier });
    const input = proposal(alice, "/multisig/icp", child, { smids: [alice.pre, bob.pre] });
    let continued = false;
    const task = run(function*() {
      yield* exchanger.processEvent(input);
      continued = true;
    });
    try {
      await reading;
      await task.halt();
      assertEquals(closed, true);
      assertEquals(continued, false);
      assertEquals(left.db.exns.get([input.serder.said!]), null);
      assertEquals(left.db.enst.get([input.serder.said!]), []);
      assertEquals(left.db.maids.get([child.body.said!]), []);
      assertEquals(Array.from(left.db.enstStaging.sdb.getKeys()).length, 0);
    } finally {
      await task.halt();
      await discardFrame(child);
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
    try {
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
    } finally {
      for (const frame of frames) await discardFrame(frame);
    }
  });
});

Deno.test("multisig body construction borrows a parsed child without reading or authenticating its evidence", async () => {
  await participants(async (_left, _right, alice, bob) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    const sink = new MemoryPayloadSink();
    await sink.write(b("4BABYWJj"));
    const owner = await sink.finish();
    let readable = false;
    let reads = 0;
    child.essr = essrPayload(
      {
        size: owner.size,
        /** Fail if construction attempts to read borrowed evidence. */
        async *open(signal) {
          if (!readable) throw new Error("Premature payload read");
          reads++;
          yield* owner.open(signal);
        },
        /** Only the owning frame's final disposal may release this evidence. */
        discard: () => owner.discard(),
      },
      1,
      3,
      child.gvrsn!,
    );
    try {
      const request: MultisigEventProposal = {
        route: "/multisig/icp",
        attrs: { smids: [alice.pre, bob.pre], rmids: [alice.pre, bob.pre] },
      };
      const body = child.body;
      assertInstanceOf(body, SerderKERI);
      const options = { stamp: "2026-10-13T00:00:00.000000+00:00" };
      const parent = multisigExnBody(bob.pre, request, body, options);
      const borrowed = nestedPayload(child, Vrsn_2_0);
      assertEquals(reads, 0);
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
      readable = true;
      const nested = await collectPayload(borrowed);
      assertEquals(reads, 1);
      // A borrowed serializer never disposes the frame; a second read remains valid.
      assertEquals(await collectPayload(borrowed), nested);
      const wire = await collectPayload(framePayload(child));
      const [prepared, preparedNested] = await run(() =>
        prepareMultisigEventExn(bob.pre, request, wire, { ...options, pvrsn: Vrsn_2_0 })
      );
      assertEquals(prepared.raw, parent.raw);
      assertEquals(preparedNested, nested);
      assertEquals(await collectPayload(owner), b("4BABYWJj"));
    } finally {
      await discardFrame(child);
    }
    await assertRejects(() => collectPayload(owner), Error, "discarded");
  });
});

Deno.test("multisig byte preparation aborts payload reads and joins disposal before cancellation returns", async () => {
  await participants(async (_left, _right, alice, bob) => {
    const [child] = await parseBytes(bob.db.clonePreIter(bob.pre, 0).next().value!);
    const sink = new MemoryPayloadSink();
    await sink.write(b("4BABYWJj"));
    child.essr = essrPayload(await sink.finish(), 1, 3, child.gvrsn!);
    const wire = await collectPayload(framePayload(child));
    await discardFrame(child);
    const finish = MemoryPayloadSink.prototype.finish;
    const owners: OwnedPayload[] = [];
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    let discarded = 0;
    let continued = false;
    // Observe the real default sink; no test-only parser or payload factory is introduced.
    MemoryPayloadSink.prototype.finish = async function() {
      const owner = await finish.call(this);
      owners.push(owner);
      return {
        size: owner.size,
        /** Hold the serializer's actual read until its Effection scope aborts. */
        async *open(signal) {
          try {
            entered();
            await new Promise<void>((_resolve, reject) => {
              signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
            });
            yield* owner.open(signal);
          } finally {
            await cleanup;
            closed = true;
          }
        },
        /** Count owner release only after the aborted reader has joined. */
        async discard() {
          assertEquals(closed, true);
          discarded++;
          await owner.discard();
        },
      };
    };
    const task = run(function*() {
      yield* prepareMultisigEventExn(
        bob.pre,
        {
          route: "/multisig/icp",
          attrs: { smids: [alice.pre, bob.pre], rmids: [alice.pre, bob.pre] },
        },
        wire,
        {
          pvrsn: Vrsn_2_0,
        },
      );
      continued = true;
    });
    try {
      await reading;
      let halted = false;
      const halt = task.halt().then(() => {
        halted = true;
      });
      await Promise.resolve();
      assertEquals(halted, false);
      assertEquals(discarded, 0);
      release();
      await halt;
      assertEquals(closed, true);
      assertEquals(discarded, 1);
      assertEquals(continued, false);
      assertEquals(owners.length, 1);
      await assertRejects(() => collectPayload(owners[0]), Error, "discarded");
    } finally {
      release();
      await task.halt();
      MemoryPayloadSink.prototype.finish = finish;
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
      await run(function*() {
        const runtime = yield* createAgentRuntime(left, { mode: "local", notifier });
        try {
          runtime.poster.sendPreparedExchange = function*(_sender, args) {
            return { serder: args.serder, deliveries: ["test"], queued: [] };
          };
          yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), attachments), {
            local: true,
          });
          assertNotEquals(left.db.getKever(b.hab.pre)?.said, event.serder.said);
          let prompted = "";
          const result = yield* waitForOneApproval(left, runtime, {
            pollTurns: 1,
            pollBudgetMs: 1,
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
    await run(function*() {
      const runtime = yield* createAgentRuntime(left, { mode: "local", notifier });
      try {
        yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), paths), {
          local: true,
        });
        assertNotEquals(left.db.getKever(local.hab.pre)?.said, anchor.serder.said);
        let prompted = false;
        const result = yield* waitForOneApproval(left, runtime, {
          pollTurns: 1,
          pollBudgetMs: 1,
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

for (const genus of [Vrsn_1_0, Vrsn_2_0]) {
  Deno.test(`multisig IPEX approval preserves genus ${genus.major} through peer publication`, async () => {
    await participants(async (left, right, alice, bob, notifier) => {
      const mids = [alice.pre, bob.pre];
      const local = left.makeGroupHab("group", alice, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      const remote = right.makeGroupHab("group", bob, mids, mids, undefined, { isith: "2", nsith: "2", toad: 0 });
      await run(function*() {
        const runtime = yield* createAgentRuntime(left, { mode: "local", notifier });
        const peerRuntime = yield* createAgentRuntime(right, { mode: "local" });
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
          const [embedded] = ipexApplyExn(remote.hab, bob.pre, "apply", schema.said, {});
          const partial = groupIpexPartial(right, remote.hab, embedded, new Uint8Array(), genus);
          const hint = genus.major === 2 ? { cgvrsn: [2, 0] } : {};
          const [wrapper, paths] = exchange("/multisig/exn", { gid: local.hab.pre, ...hint }, {
            sender: bob.pre,
            embeds: { exn: partial },
          });
          yield* runtime.reactor.processBytes(concatBytes(bob.endorse(wrapper, { pipelined: false }), paths), {
            local: true,
          });
          let outgoing: { serder: SerderKERI; message: Uint8Array } | undefined;
          // Substitute transmission only; the peer admits the actual signed outgoing bytes below.
          runtime.poster.sendPreparedExchange = function*(_sender, args) {
            assertEquals(args.serder.ked!.a, { gid: local.hab.pre, ...hint, i: bob.pre });
            outgoing = { serder: args.serder, message: args.message };
            return { serder: args.serder, deliveries: ["test"], queued: [] };
          };
          const result = yield* approveMultisigIpex(left, runtime, wrapper, { publish: true, sendLead: false });
          assertEquals(result.accepted, true);
          assertEquals(runtime.reactor.exchanger.complete(embedded.said!), true);
          assertExists(outgoing);
          yield* peerRuntime.reactor.processBytes(outgoing.message, { local: true });
          const peerResult = yield* approveMultisigIpex(right, peerRuntime, outgoing.serder, {
            publish: false,
            sendLead: false,
          });
          assertEquals(peerResult.accepted, true);
          assertEquals(peerRuntime.reactor.exchanger.complete(embedded.said!), true);
        } finally {
          yield* peerRuntime.close();
          yield* runtime.close();
        }
      });
    });
  });
}
