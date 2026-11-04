/** Frozen wire decisions exercise parser, issuer authentication, durable acceptance and replay. */
import {
  b,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  Kinds,
  makeBlindState,
  type MapperMap,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SealEvent,
  SerderACDC,
  SerderKERI,
  type Siger,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { loadNests } from "../../../../db.ts";
import { type AcdcGraph, type ChainVerdict, evaluateChain } from "../../../../src/acdc/chaining.ts";
import { acdcagg, acdcatt, acdcmap, blindate, regcept } from "../../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../../src/acdc/observing.ts";
import { openRegistry, RegistryStore } from "../../../../src/acdc/registering.ts";
import { validateSchema } from "../../../../src/acdc/scheming.ts";
import { type ExchangeDecision, Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../../src/app/identity/habbing.ts";
import { ipexExnBody, prepareIpexExn } from "../../../../src/app/ipex/ipex-building.ts";
import { walkIpexGraph } from "../../../../src/app/ipex/ipex-graph.ts";
import { authenticateIpexNode } from "../../../../src/app/ipex/ipex-node-authentication.ts";
import { IpexV2Handler } from "../../../../src/app/ipex/ipex-v2.ts";
import { type IpexRoute, loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { Notifier, openNoterForHabery } from "../../../../src/app/notifications/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exincept } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { makeNowIso8601 } from "../../../../src/time/mod.ts";
import fixture from "../../../fixtures/keripy-ipex-vectors.json" with { type: "json" };
/** These relation fixtures are unregistered; signed grants exercise authentication separately. */
const evaluateRelations = (graph: AcdcGraph, db: Habery["db"]) =>
  evaluateChain(graph, new Map(graph.order.map((said) => [said, { kind: "valid" } as ChainVerdict])), db);

/** Feed signed public KEL bytes through normal event verification. */
async function learn(hby: Habery, wire: string | Uint8Array): Promise<void> {
  for (const frame of await parseBytes(typeof wire === "string" ? b(wire) : wire)) {
    {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery));
    }
  }
}
Deno.test("IPEX node authentication keeps missing KEL evidence distinct from refused proofs", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const issuer = source.makeHab("issuer"), foreign = source.makeHab("foreign");
      const credential = acdcmap(issuer.pre, { attribute: { d: "", name: "Ada" } });
      const signatures = issuer.sign(credential.raw, true);
      const claimedIssuer = (signatures: readonly Siger[]) =>
        new TransIdxSigGroup(
          new Prefixer({ qb64: issuer.pre }),
          NumberPrimitive.fromNum(BigInt(issuer.kever!.lastEst.s)),
          new Diger({ qb64: issuer.kever!.lastEst.d }),
          [...signatures],
        );
      const node = (attachments: CesrFrame["attachments"]): CesrFrame & { body: SerderACDC } => ({
        body: credential,
        attachments,
        gvrsn: Vrsn_2_0,
      });
      const authenticate = (frame: CesrFrame & { body: SerderACDC }) =>
        authenticateIpexNode(frame.body, envelopeFromFrame(frame), receiver.db, null);
      const signed = node(messageAttachmentGroups({ tsgs: [claimedIssuer(signatures)] }, Vrsn_2_0));
      assertEquals(authenticate(signed).kind, "missing");
      yield* call(() => learn(receiver, acceptedEventReplayMessage(source, issuer.pre, 0).message));
      assertEquals(receiver.habs.has(issuer.pre), false, "only public issuer evidence crossed intake");
      assertEquals(authenticate(signed), { kind: "authenticated", registration: null });
      assertEquals(authenticate(node([])), { kind: "reject" });
      assertEquals(
        authenticate(
          node(messageAttachmentGroups({ tsgs: [claimedIssuer(foreign.sign(credential.raw, true))] }, Vrsn_2_0)),
        ),
        { kind: "reject" },
        "a known issuer does not authenticate a foreign signature",
      );
      issuer.interact({ data: [{ d: credential.said! }] });
      const seal = {
        i: new Prefixer({ qb64: issuer.pre }),
        s: issuer.kever!.sner,
        d: new Diger({ qb64: issuer.kever!.said }),
      };
      assertEquals(
        authenticate(node(messageAttachmentGroups({ tsgs: [claimedIssuer(signatures)] }, Vrsn_2_0))).kind,
        "authenticated",
        "the signature-only counterpart remains valid before the issuer interaction arrives",
      );
      const anchored = node(
        messageAttachmentGroups({ tsgs: [claimedIssuer(signatures)], sourceSeals: [seal] }, Vrsn_2_0),
      );
      assertEquals(
        authenticate(anchored).kind,
        "missing",
        "declared source evidence must not silently fall back to a valid signature",
      );
      yield* call(() => learn(receiver, acceptedEventReplayMessage(source, issuer.pre, 1).message));
      assertEquals(
        authenticate(node(messageAttachmentGroups({ sourceSeals: [seal] }, Vrsn_2_0))),
        { kind: "authenticated", registration: null },
        "the actual accepted issuer anchor authenticates the child",
      );
      assertEquals(receiver.db.exns.get(credential.said!), null, "authentication never publishes the node");
    } finally {
      yield* receiver.close(true);
      yield* source.close(true);
    }
  });
});
Deno.test("v2 IPEX historical wire vectors retain the recorded section difference", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `ipex-vectors-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(hby);
    const notifier = new Notifier(hby.signator!, { noter });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const exchanger = new Exchanger(hby);
    loadIpexHandlers(hby, exchanger, { notifier });
    try {
      assertEquals(fixture.reference, "ae8284995486855809e7f4988fa1579b63e1ff91");
      const deferredSectionClaims = new Set(["issuer proof under a different outer sender"]);
      let through = 0;
      let notifications = 0;
      const vry = runtime.vdr!.vry;
      const processACDC = vry.processACDC.bind(vry);
      for (const row of fixture.cases) {
        while (through < row.through) yield* call(() => learn(hby, fixture.wires[through++]));
        const frames = yield* call(() => parseBytes(b(row.wire)));
        {
          assertEquals(frames.length, 1, row.name);
          let decision: ExchangeDecision | undefined;
          let childDispatches = 0;
          vry.processACDC = (args) => {
            childDispatches++;
            return processACDC(args);
          };
          yield* dispatchEnvelope(
            envelopeFromFrame(frames[0]),
            hby.rvy,
            hby.kevery,
            {
              /** Observe the real Exchanger decision without bypassing runtime normalization. */
              *processEvent(args) {
                decision = yield* exchanger.processEvent(args);
                return decision;
              },
            },
            undefined,
            vry,
          );
          const deferredSectionRefusal = deferredSectionClaims.has(row.name);
          const currentOutcome = deferredSectionRefusal ? "reject" : row.outcome;
          assertEquals(decision?.kind, currentOutcome, `${row.name}: ${JSON.stringify(decision)}`);
          assertEquals(childDispatches, 0, "nested nodes are not independent credential intake");
          if (deferredSectionRefusal || row.name === "stale exposed section claim") {
            assertEquals(
              row.outcome,
              deferredSectionRefusal ? "accept" : "reject",
              "record the actual IPEX outcome independently of Serder verification",
            );
            assertEquals(
              row.pythonSectionVerifies,
              true,
              "selected Python Serder accepts the exposed claim; R05/R13d remains open",
            );
            const child = frames[0].nests![0].body;
            assert(child instanceof SerderACDC);
            assertEquals(child.verify(), false, "TS retains its exposed-section commitment check");
          }
          if (currentOutcome === "accept") {
            notifications++;
            assertExists(hby.db.exns.get(row.said), row.name);
            const replayed: Uint8Array[] = [];
            yield* call(async () => {
              for await (const chunk of exchanger.replay(row.said)) replayed.push(chunk);
            });
            const restored = yield* call(() => parseBytes(concatBytes(...replayed)));
            {
              assertEquals(restored.length, 1);
              assertEquals(restored[0].body.raw, frames[0].body.raw, row.name);
              assertEquals(
                restored[0].nests?.map((f) => f.body.raw) ?? [],
                frames[0].nests?.map((f) => f.body.raw) ?? [],
                row.name,
              );
              for (const [i, child] of (restored[0].nests ?? []).entries()) {
                const before = yield* call(() => collectPayload(framePayload(frames[0].nests![i])));
                const after = yield* call(() => collectPayload(framePayload(child)));
                assertEquals(after, before, "replay retains each child's own proof enclosure");
                assertEquals(hby.db.exns.get(child.body.said!), null);
              }
            }
          } else {
            assertEquals(hby.db.exns.get(row.said), null, row.name);
            assertEquals(hby.db.enst.get(row.said), [], row.name);
          }
          assertEquals(notifier.list().length, notifications, row.name);
        }
      }
    } finally {
      yield* runtime.close();
      yield* noter.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("v2 IPEX competing nested offers share one synchronous conversation decision", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
      const left = new Exchanger(hby), right = new Exchanger(hby);
      loadIpexHandlers(hby, left);
      loadIpexHandlers(hby, right);
      yield* call(() => learn(hby, fixture.wires[0]));
      const reference = parseBytes(b(fixture.cases[0].wire))[0];
      const node = reference.nests![0];
      const schema = (node.body as SerderACDC).schema as { $id: string };
      const apply = ipexExnBody(recipient.pre, "/ipex/apply", [], {
        kind: Kinds.json,
        message: "apply",
        recipient: sender.pre,

        plan: [[schema.$id, "/", []]],
      });
      const frame = (hab: typeof sender, body: SerderKERI, nests: readonly CesrFrame[] = []): CesrFrame => ({
        body,
        gvrsn: Vrsn_2_0,
        nests: [...nests],
        attachments: messageAttachmentGroups({
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: hab.pre }),
              hab.kever!.sner,
              new Diger({ qb64: hab.kever!.said }),
              hab.sign(body.raw, true),
            ),
          ],
        }, Vrsn_2_0),
      });
      const opener = yield* dispatchEnvelope(envelopeFromFrame(frame(recipient, apply)), hby.rvy, hby.kevery, left);
      assertEquals(opener.decision?.kind, "accept");
      const proofOffer = ipexExnBody(sender.pre, "/ipex/offer", [node.body as SerderACDC], {
        kind: Kinds.json,
        message: "issuer proofs belong to the Grant",
        prior: apply,
      });
      const proofWire = yield* call(() => collectPayload(framePayload(frame(sender, proofOffer, [node]))));
      const [proofFrame] = parseBytes(proofWire);
      assertEquals(
        (yield* dispatchEnvelope(envelopeFromFrame(proofFrame), hby.rvy, hby.kevery, left)).decision?.kind,
        "reject",
      );
      assertEquals(hby.db.exns.get(proofOffer.said!), null);
      assertEquals(hby.db.epse.get(proofOffer.said!), null);
      assertEquals(hby.db.erpy.get(apply.said!), null, "a refused child role cannot consume the response");
      const contenders = ["first offer", "second offer"].map((message) =>
        frame(
          sender,
          ipexExnBody(sender.pre, "/ipex/offer", [node.body as SerderACDC], {
            kind: Kinds.json,
            message,
            prior: apply,
          }),
          [{ ...node, attachments: [] }],
        )
      );
      const results = yield* call(() =>
        Promise.all(
          contenders.map((offered, index) =>
            run(() => dispatchEnvelope(envelopeFromFrame(offered), hby.rvy, hby.kevery, index ? right : left))
          ),
        )
      );
      assertEquals(results.map((result) => result.decision?.kind).sort(), ["accept", "reject"]);
      const winner = contenders.find((_, index) => results[index].decision?.kind === "accept")!;
      const loser = contenders.find((offered) => offered !== winner)!;
      assertEquals(hby.db.erpy.get([apply.said!])?.qb64, winner.body.said);
      assertExists(hby.db.exns.get([winner.body.said!]));
      assertEquals(hby.db.exns.get([loser.body.said!]), null);
      assertEquals(hby.db.enst.get([loser.body.said!]), []);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("v2 IPEX construction keeps parsed commitments while generating XIP transaction identities", async () => {
  const row = fixture.cases[0];
  const [frame] = await parseBytes(b(row.wire));
  {
    const parent = frame.body as SerderKERI;
    const nodes = frame.nests!.map((child) => child.body as SerderACDC);
    const opts = {
      kind: parent.kind,
      message: row.name,
      recipient: parent.sad!.ri as string,

      stamp: parent.sad!.dt as string,
    };
    const built = ipexExnBody(parent.pre!, parent.route as IpexRoute, nodes, opts);
    assertEquals({ ...built.sad, d: "", u: "" }, { ...parent.sad, d: "", u: "" });
    const plan = [[(nodes[0].schema as { $id: string }).$id, "/", []]] as const;
    assertEquals(built.sad!.q, { dp: [plan] }, "a bare one-node Grant states its root selection");
    for (const route of ["/ipex/apply", "/ipex/offer", "/ipex/grant"] as const) {
      const empty = ipexExnBody(parent.pre!, route, [], { ...opts, plan: [] });
      assertEquals(empty.ilk, "xip");
      assertEquals(empty.sad!.q, { dp: [[]] });
    }
    for (const query of ["", "not-a-qualified-said"]) {
      const apply = ipexExnBody(parent.pre!, "/ipex/apply", [], { ...opts, plan: [[query, "/", []]] });
      assertEquals(apply.sad!.q, { dp: [[[query, "/", []]]] });
    }
    for (const dp of [[], { invalid: "plan" }, [["", "/", []]]]) {
      const prior = exincept("/ipex/apply", {
        attributes: { m: "invalid prior plan" },
        sender: opts.recipient,
        receiver: parent.pre!,
        modifiers: { dp },
        kind: parent.kind,
        pvrsn: Vrsn_2_0,
      });
      assertThrows(
        () => ipexExnBody(parent.pre!, "/ipex/offer", nodes, { message: "offer", prior }),
        Error,
        "cannot inherit an invalid Apply plan",
      );
    }
    // No frame payload is touched by the ordinary body constructor.
    assertThrows(() => ipexExnBody(parent.pre!, "/ipex/apply", nodes, opts), Error, "Only offer and grant");
    const metadata = new SerderACDC({ sad: { ...nodes[0].sad!, u: "" }, makify: true });
    assertThrows(
      () => ipexExnBody(parent.pre!, "/ipex/grant", [metadata], opts),
      Error,
      "credentials, not metadata",
    );
    const childWire = await collectPayload(framePayload(frame.nests![0]));
    await assertRejects(
      () => run(() => prepareIpexExn(parent.pre!, "/ipex/offer", childWire, { ...opts, plan })),
      Error,
      "must not carry attachments",
    );
    const [prepared, nested] = await run(() => prepareIpexExn(parent.pre!, "/ipex/grant", childWire, opts));
    assertEquals({ ...prepared.sad, d: "", u: "" }, { ...built.sad, d: "", u: "" });
    assertEquals(nested.length > 0, true);
    assertEquals(prepared.gvrsn, Vrsn_2_0);
    const childAgain = await parseBytes(nested);
    {
      assertEquals(childAgain[0].body.raw, nodes[0].raw);
    }
  }
});

for (const foreign of [false, true]) {
  Deno.test(`IPEX ${foreign ? "foreign" : "sender"} grant anchor survives rotation before first delivery`, async () => {
    await run(function*() {
      const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const issuer = source.makeHab("issuer"), sender = foreign ? source.makeHab("proxy") : issuer;
        const recipient = receiver.makeHab("recipient");
        const credential = acdcmap(issuer.pre, { attribute: { d: "", name: "Ada" } });
        const anchor = (said: string): SealEvent => {
          issuer.interact({ data: [{ d: said }] });
          return {
            i: new Prefixer({ qb64: issuer.pre }),
            s: issuer.kever!.sner,
            d: new Diger({ qb64: issuer.kever!.said }),
          };
        };
        const childSeal = anchor(credential.said!);
        const options = { message: "historical grant", recipient: recipient.pre, anchor: true };
        const grant = ipexExnBody(sender.pre, "/ipex/grant", [credential], options);
        const oldEndorsement = new TransIdxSigGroup(
          new Prefixer({ qb64: issuer.pre }),
          NumberPrimitive.fromNum(BigInt(issuer.kever!.lastEst.s)),
          new Diger({ qb64: issuer.kever!.lastEst.d }),
          issuer.sign(grant.raw, true),
        );
        const grantSeal = anchor(grant.said!);
        issuer.rotate();
        for (const hab of new Set([issuer, sender])) {
          for (const wire of source.db.clonePreIter(hab.pre, 0)) yield* call(() => learn(receiver, wire));
        }
        assert(grantSeal.s.num < BigInt(receiver.db.getKever(issuer.pre)!.lastEst.s));
        const exchanger = new Exchanger(receiver);
        loadIpexHandlers(receiver, exchanger);
        const frame = (body: SerderKERI, seal = grantSeal): CesrFrame => ({
          body,
          gvrsn: Vrsn_2_0,
          attachments: messageAttachmentGroups({
            sourceSeals: [seal],
            tsgs: [
              new TransIdxSigGroup(
                new Prefixer({ qb64: sender.pre }),
                NumberPrimitive.fromNum(BigInt(sender.kever!.lastEst.s)),
                new Diger({ qb64: sender.kever!.lastEst.d }),
                sender.sign(body.raw, true),
              ),
              ...(foreign ? [oldEndorsement] : []),
            ],
          }, Vrsn_2_0),
          nests: [{
            body: credential,
            gvrsn: Vrsn_2_0,
            attachments: messageAttachmentGroups({ sourceSeals: [childSeal] }, Vrsn_2_0),
          }],
        });
        const refused = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
          ...options,
          message: "unanchored replacement",
        });
        const bad = yield* dispatchEnvelope(
          envelopeFromFrame(frame(refused)),
          receiver.rvy,
          receiver.kevery,
          exchanger,
        );
        assertEquals(bad.decision?.kind, "reject", "a fresh sender signature cannot replace the required exact anchor");
        const wrongDigest = yield* dispatchEnvelope(
          envelopeFromFrame(frame(grant, { ...grantSeal, d: childSeal.d })),
          receiver.rvy,
          receiver.kevery,
          exchanger,
        );
        assertEquals(wrongDigest.decision?.kind, "reject", "the historical event's sequence and digest must agree");
        const accepted = yield* dispatchEnvelope(
          envelopeFromFrame(frame(grant)),
          receiver.rvy,
          receiver.kevery,
          exchanger,
        );
        assertEquals(accepted.decision?.kind, "accept");
        yield* receiver.db.reopen();
        assertExists(receiver.db.exns.get(grant.said!));
        assertEquals(
          exchanger.verifyAccepted(grant.said!, "/ipex/grant"),
          true,
          "retained inspection preserves permanent historical source anchors after rotation",
        );
        const replay: Uint8Array[] = [];
        yield* call(async () => {
          for await (const chunk of exchanger.replay(grant.said!)) replay.push(chunk);
        });
        const restored = envelopeFromFrame(parseBytes(concatBytes(...replay))[0]);
        assert(restored.ssts.some((seal) => seal.i.qb64 === issuer.pre && seal.d.qb64 === grantSeal.d.qb64));
        if (foreign) {
          assertEquals(
            restored.tsgs.some((group) => group.pre === issuer.pre),
            false,
            "the historical seal survives; stale endorsement does not",
          );
        }
      } finally {
        yield* receiver.close(true);
        yield* source.close(true);
      }
    });
  });
}
Deno.test("nested IPEX between two Haberies retains missing issuer evidence for joined reopen and retry", async () => {
  await run(function*() {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(left);
    const notifier = new Notifier(left.signator!, { noter });
    const receiver = left.makeHab("recipient");
    const sender = right.makeHab("sender");
    const receiving = new Exchanger(left);
    const sending = new Exchanger(right);
    loadIpexHandlers(left, receiving, { notifier });
    loadIpexHandlers(right, sending);
    const [reference] = yield* call(() => parseBytes(b(fixture.cases[0].wire)));
    try {
      for (const wire of left.db.clonePreIter(receiver.pre, 0)) {
        yield* call(() => learn(right, new TextDecoder().decode(wire)));
      }
      for (const wire of right.db.clonePreIter(sender.pre, 0)) {
        yield* call(() => learn(left, new TextDecoder().decode(wire)));
      }
      yield* call(() => learn(right, fixture.wires[0]));
      const node = reference.nests![0];
      const schema = (node.body as SerderACDC).schema as { $id: string };
      const common = { kind: (reference.body as SerderKERI).kind, stamp: "2026-10-13T01:00:00.000000+00:00" };
      const apply = ipexExnBody(receiver.pre, "/ipex/apply", [], {
        ...common,
        message: "apply",
        recipient: sender.pre,

        plan: [[schema.$id, "/", []]],
      });
      const offer = ipexExnBody(sender.pre, "/ipex/offer", [node.body as SerderACDC], {
        ...common,
        message: "offer",
        prior: apply,
      });
      const agree = ipexExnBody(receiver.pre, "/ipex/agree", [], { ...common, message: "agree", prior: offer });
      const grant = ipexExnBody(sender.pre, "/ipex/grant", [node.body as SerderACDC], {
        ...common,
        message: "grant",
        prior: agree,
      });
      assertEquals(apply.sad!.q, { dp: [[[schema.$id, "/", []]]] });
      assertEquals(apply.ilk, "xip");
      for (const reply of [offer, agree, grant]) {
        assertEquals(reply.ilk, "exn");
        assertEquals(reply.sad!.x, apply.said);
        assertEquals(reply.sad!.q, { dp: [[]] });
      }
      for (const body of [apply, offer, agree, grant]) {
        const hab = body.pre === sender.pre ? sender : receiver;
        const establishment = hab.db.getEvtSerder(hab.pre, hab.kever!.lastEst.d)!;
        const tsgs = [
          new TransIdxSigGroup(
            new Prefixer({ qb64: hab.pre }),
            establishment.sner!,
            new Diger({ qb64: establishment.said! }),
            hab.sign(body.raw, true),
          ),
        ];
        const children = body === offer ? [{ ...node, attachments: [] }] : body === grant ? [node] : [];
        const frame: CesrFrame = {
          ...reference,
          body,
          attachments: messageAttachmentGroups({ tsgs }, Vrsn_2_0),
          nests: children,
        };
        const wire = yield* call(() => collectPayload(framePayload(frame)));
        for (const [hby, exn] of [[left, receiving], [right, sending]] as const) {
          const [parsed] = yield* call(() => parseBytes(wire));
          {
            yield* dispatchEnvelope(envelopeFromFrame(parsed), hby.rvy, hby.kevery, exn);
          }
          if (body !== grant || hby === right) {
            assertExists(hby.db.exns.get(body.said!));
          }
        }
      }
      assertEquals(left.db.exns.get(grant.said!), null);
      assertExists(left.db.epse.get(grant.said!));
      assertEquals(left.db.enst.get(grant.said!).length, 1);
      assertEquals(
        new IpexV2Handler("/ipex/grant", right).verify({
          serder: grant,
          nests: [node],
          attachments: [],
          evidence: { tsgs: [], cigars: [], sourceSeals: [] },
        }),
        { kind: "accept", registryStates: [] },
        "the identical accepted response returns read-only verification facts",
      );
      assertEquals(receiving.verifyAccepted(grant.said!, "/ipex/grant"), false, "escrow is not accepted evidence");
      assertEquals(sending.verifyAccepted(grant.said!, "/ipex/grant"), true);
      yield* receiving.processEscrows();
      yield* receiving.processEscrows();
      assertEquals([...receiving.cues].filter((cue) => cue.kin === "proof").length, 1);
      assertEquals(notifier.list().length, 3);
      yield* left.db.reopen();
      yield* call(() => learn(left, fixture.wires[0]));
      yield* receiving.processEscrows();
      assertExists(left.db.exns.get(grant.said!));
      assertEquals(left.db.epse.get(grant.said!), null);
      assertEquals(notifier.list().length, 4);
      assertEquals(left.db.exns.get(node.body.said!), null);
      assertEquals(
        new Exchanger(left).verifyAccepted(grant.said!, "/ipex/grant"),
        false,
        "generic EXN retention is insufficient",
      );
      const generic = ipexExnBody(sender.pre, "/ipex/grant", [node.body as SerderACDC], {
        ...common,
        message: "generic retention",
        recipient: receiver.pre,
      });
      const genericProof = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(generic.raw, true),
      );
      assertEquals((yield* new Exchanger(left).processEvent({ serder: generic, tsgs: [genericProof] })).kind, "accept");
      assertEquals(
        receiving.verifyAccepted(generic.said!, "/ipex/grant"),
        false,
        "outer-only generic acceptance does not authenticate a Grant view",
      );
      assertEquals(receiving.verifyAccepted(grant.said!, "/ipex/offer"), false, "inspection binds the exact route");
      const retained = left.db.enst.get(grant.said!);
      const before = [
        receiving.cues.toArray(),
        notifier.list().length,
        left.db.exchangeMeta.get(grant.said!),
        left.db.erpy.get(agree.said!),
        left.db.epse.get(grant.said!),
        left.db.emse?.get(grant.said!),
      ];
      for (let i = 0; i < 2; i++) assertEquals(receiving.verifyAccepted(grant.said!, "/ipex/grant"), true);
      assertEquals(
        [
          receiving.cues.toArray(),
          notifier.list().length,
          left.db.exchangeMeta.get(grant.said!),
          left.db.erpy.get(agree.said!),
          left.db.epse.get(grant.said!),
          left.db.emse?.get(grant.said!),
        ],
        before,
        "inspection has no admission side effects",
      );
      const tsgs = [
        new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          sender.kever!.sner,
          new Diger({ qb64: sender.kever!.said }),
          sender.sign(grant.raw, true),
        ),
      ];
      const alternate = { ...node, attachments: [...node.attachments, ...node.attachments] };
      const duplicate = {
        body: grant,
        attachments: messageAttachmentGroups({ tsgs }, Vrsn_2_0),
        gvrsn: Vrsn_2_0,
        nests: [alternate],
      };
      const duplicateWire = yield* call(() => collectPayload(framePayload(duplicate)));
      const [parsed] = yield* call(() => parseBytes(duplicateWire));
      const result = yield* dispatchEnvelope(envelopeFromFrame(parsed), left.rvy, left.kevery, receiving);
      assertEquals(result.decision?.kind, "accept");
      assertEquals(
        left.db.enst.get(grant.said!),
        retained,
        "verified duplicate cannot replace the first accepted child view",
      );
      const rival = ipexExnBody(sender.pre, "/ipex/grant", [node.body as SerderACDC], {
        ...common,
        message: "rival",
        prior: agree,
      });
      const rivalProof = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(rival.raw, true),
      );
      assertEquals(
        (yield* receiving.processEvent({ serder: rival, tsgs: [rivalProof], nests: [node] })).kind,
        "reject",
      );
      assertEquals(receiving.verifyAccepted(rival.said!, "/ipex/grant"), false);
      yield* left.db.reopen();
      assertEquals(receiving.verifyAccepted(grant.said!, "/ipex/grant"), true);
      assertEquals(left.db.enst.get(grant.said!), retained);
      assertEquals(
        loadNests(left.db, grant.said!).map((frame) => frame.body.raw),
        [node.body.raw],
        "public hydration reads exactly the authenticated retained view",
      );
      left.db.esigs.remTop([grant.said!]);
      assertEquals(receiving.complete(grant.said!), true);
      assertEquals(
        receiving.verifyAccepted(grant.said!, "/ipex/grant"),
        false,
        "accepted marker cannot replace missing outer authentication",
      );
    } finally {
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
    }
  });
});
Deno.test("IPEX fresh-registry Grant keeps authenticated pending scope and original lifetime through retry and pruning", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" }),
      issuee = hby.makeHab("issuee"),
      support = hby.makeHab("support");
    let now = Math.floor(Date.now() / 1000) * 1000 + 123;
    const started = now, stamp = makeNowIso8601(new Date(now));
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), {
      now: () => now,
      setTimeout,
      clearTimeout: (timer) => clearTimeout(timer as number),
    }, { kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 600000] } } });
    try {
      // Ordinary native intake authenticates the sender and admits the transaction before IPEX waits.
      const store = runtime.acdc!.store, rip = regcept(issuer.pre, { stamp });
      issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(new RegistryObserver(hby.db, store).processEvent(rip).kind, "accept");
      const schema = new Schemer({
        sed: { $id: "", version: "1.0.0", type: "object", properties: { name: { type: "string" } } },
      });
      const supporting = acdcmap(support.pre, { schema: schema.said, attribute: { d: "", name: "Support" } });
      const credential = acdcmap(issuer.pre, {
        regid: rip.said,
        schema: schema.said,
        attribute: { d: "", i: issuee.pre, name: "Ada" },
        edge: { d: "", link: { n: supporting.said! } },
      });
      const grant = ipexExnBody(issuer.pre, "/ipex/grant", [credential, supporting], {
        kind: Kinds.json,
        message: "fresh issuance",
        recipient: issuee.pre,
        date: stamp,
        plan: [[schema.said, "/", []], [schema.said, "/e/link/_/", []]],
      });
      const group = new TransIdxSigGroup(
        new Prefixer({ qb64: issuer.pre }),
        NumberPrimitive.fromNum(BigInt(issuer.kever!.lastEst.s)),
        new Diger({ qb64: issuer.kever!.lastEst.d }),
        issuer.sign(grant.raw, true),
      );
      const frame: CesrFrame = {
        body: grant,
        gvrsn: Vrsn_2_0,
        attachments: messageAttachmentGroups({ tsgs: [group] }, Vrsn_2_0),
        nests: [
          { body: credential, attachments: [], gvrsn: Vrsn_2_0 },
          {
            body: supporting,
            gvrsn: Vrsn_2_0,
            attachments: messageAttachmentGroups({
              tsgs: [
                new TransIdxSigGroup(
                  new Prefixer({ qb64: support.pre }),
                  support.kever!.sner,
                  new Diger({ qb64: support.kever!.said }),
                  support.sign(supporting.raw, true),
                ),
              ],
            }, Vrsn_2_0),
          },
        ],
      };
      yield* runtime.reactor.process((signal) => framePayload(frame).open(signal));
      const key = [issuer.pre, grant.said!, grant.said!];
      const accepted = hby.db.tmsc.get(key)!;
      assertEquals(accepted.rdt, stamp);
      assertEquals(accepted.xl, 300000);
      const deadline = makeNowIso8601(new Date(started + accepted.xl!));
      assertEquals(hby.db.epsd.get(grant.said!)?.dts, deadline);
      assertExists(hby.db.emse!.get([grant.said!, schema.said]));
      const scope = { xid: grant.said!, sender: issuer.pre, recipient: issuee.pre };
      const transactionIds = () =>
        [hby.db.env!, store.baser.env!].map(env => (env.getStats() as { lastTxnId: number }).lastTxnId);
      const pending = (said = grant.said!, selected = scope) => {
        const before = transactionIds(), cues = runtime.exc.cues.toArray();
        const result = runtime.exc.pendingGrant(said, selected);
        assertEquals(transactionIds(), before, "context lookup changes neither KEL/exchange nor registry stores");
        assertEquals(runtime.exc.cues.toArray(), cues, "context lookup emits no recovery or protocol cues");
        return result;
      };
      assertEquals(pending(), null, "schema escrow is not an authenticated pending issuance context");

      // Schema arrival after ten seconds changes the dependency, never the original validity clock.
      now += 11000;
      yield* hby.db.close();
      yield* hby.db.reopen({ reuse: true });
      yield* store.baser.reopen({ reuse: true });
      hby.db.schema.pin(schema.said, schema);
      yield* runtime.exc.processEscrows();
      assertExists(hby.db.epse.get(grant.said!));
      assertEquals(hby.db.emse!.get([grant.said!, schema.said]), null);
      assertEquals(hby.db.epsd.get(grant.said!)!.dts, deadline);
      assertEquals(runtime.exc.complete(grant.said!), false, "an accepted RIP never supplies issuance");
      // Context returns this selected Grant's registry IDs only after fresh complete authentication.
      assertEquals(pending()!.serder.raw, grant.raw);
      assertEquals(pending()!.registries, [rip.said!]);
      assertEquals(pending(credential.said!), null, "a node SAID cannot select its enclosing Grant");
      assertEquals(pending(grant.said!, { ...scope, xid: supporting.said! }), null);
      assertEquals(pending(grant.said!, { ...scope, sender: support.pre }), null);
      assertEquals(pending(grant.said!, { ...scope, recipient: support.pre }), null);
      assertEquals(
        new Exchanger(hby, { now: () => now }).pendingGrant(grant.said!, scope),
        null,
        "native handler is required",
      );
      const originalDeadline = hby.db.epsd.get(grant.said!)!;
      hby.db.epsd.rem(grant.said!);
      assertEquals(pending(), null, "body presence cannot replace the original deadline");
      hby.db.epsd.put(grant.said!, originalDeadline);

      // Remove real retained proof bytes, then restore those same bytes; cached KRAM acceptance is insufficient.
      assertEquals(group.sigers.length, 2);
      const senderKey = [grant.said!, issuer.pre, group.sn.toString(16).padStart(32, "0"), group.said];
      hby.db.esigs.rem(senderKey, group.sigers[1]);
      assertEquals(pending(), null, "the complete sender threshold is reverified");
      hby.db.esigs.add(senderKey, group.sigers[1]);
      const issuerAnchor = issuer.kever!.serder;
      hby.db.evts.rem([issuer.pre, issuerAnchor.said!]);
      assertEquals(pending(), null, "a retained RIP marker cannot replace its accepted issuer anchor");
      hby.db.evts.pin([issuer.pre, issuerAnchor.said!], issuerAnchor);
      const supportingEvent = hby.db.getEvtSerder(support.pre, support.kever!.lastEst.d)!;
      hby.db.evts.rem([support.pre, supportingEvent.said!]);
      assertEquals(pending(), null, "every other disclosed issuer proof must still authenticate");
      hby.db.evts.pin([support.pre, supportingEvent.said!], supportingEvent);
      assertEquals(pending()!.registries, [rip.said!]);
      now += 11000;
      yield* runtime.exc.processEscrows();
      assertExists(hby.db.epse.get(grant.said!), "fresh issuance remains pending beyond the ordinary PSE window");

      // Live policy expansion cannot renew the already retained Grant deadline.
      const kramer = runtime.protocol.kvy.kramer!;
      kramer.changeConfig({ "~": [1000, 5000, 60000, 900000, 5000, 60000, 900000] }, 1);
      now += 2;
      kramer.prune();
      assertEquals(hby.db.ctyp.get("~")!.xl, 900000, "expanded policy is active before original expiry");
      now = started + 300000;
      yield* runtime.exc.processEscrows();
      assertExists(hby.db.epse.get(grant.said!), "deadline equality remains eligible");
      assertEquals(pending(), null, "auxiliary pending authority expires at equality before escrow cleanup");
      now++;
      yield* runtime.exc.processEscrows();
      assertEquals(hby.db.epse.get(grant.said!), null);
      assertEquals(hby.db.epsd.get(grant.said!)!.dts, deadline, "body eviction retains the original lifetime");
      assertEquals(runtime.exc.complete(grant.said!), false);
      assertEquals(pending(), null, "expired pending bodies confer no context");
      now = started + 600001;
      for (let pass = 0; pass < 4 && hby.db.tmsc.get(key); pass++) kramer.prune();
      assertEquals(hby.db.tmsc.get(key), null);
      yield* hby.db.close();
      yield* hby.db.reopen({ reuse: true });
      assertEquals(hby.db.epsd.get(grant.said!)!.dts, deadline, "TMSC pruning and reopen cannot renew validity");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("IPEX presentation proofs bind the grant at an exact Issuee-sealed TEL head across observer retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer"), issuee = hby.makeHab("issuee"), sender = hby.makeHab("sender");
    let now = Math.floor(Date.now() / 1000) * 1000 + 123;
    const receipt = makeNowIso8601(new Date(now)), earlier = makeNowIso8601(new Date(now - 1000));
    const runtime = yield* createAgentRuntime(
      hby,
      new FetchHttpClient(),
      { now: () => now, setTimeout, clearTimeout: (timer) => clearTimeout(timer as number) },
      { kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } },
    );
    const store = runtime.acdc!.store, observer = new RegistryObserver(hby.db, store);
    const anchor = (hab: typeof issuer, event: SerderACDC): SealEvent => {
      hab.interact({ data: [{ i: event.regid ?? event.said, s: event.sad!.n, d: event.said }] });
      return { i: new Prefixer({ qb64: hab.pre }), s: hab.kever!.sner, d: new Diger({ qb64: hab.kever!.said }) };
    };
    const irip = regcept(issuer.pre, { stamp: earlier }), prip = regcept(issuee.pre, { stamp: earlier });
    anchor(issuer, irip);
    anchor(issuee, prip);
    const credential = acdcmap(issuer.pre, {
      regid: irip.said,
      attribute: { d: "", i: issuee.pre, rd: prip.said!, name: "Ada" },
    });
    const iblind = makeBlindState({ acdc: credential.said!, state: "issued" });
    const ibup = blindate(irip.said!, irip.said!, iblind.d.nonce, { stamp: receipt });
    const issuerSource = anchor(issuer, ibup);
    assertEquals(observer.processEvent(irip).kind, "accept");
    const grant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
      kind: Kinds.json,
      message: "presentation",
      recipient: issuee.pre,

      date: receipt,
      anchor: true,
    });
    const pblind = makeBlindState({ acdc: grant.said!, state: "presented" });
    const pbup = blindate(prip.said!, prip.said!, pblind.d.nonce, { stamp: receipt });
    const source = anchor(issuee, pbup);
    const node = function*(proofs = [iblind, pblind], sources = [source]) {
      const groups = proofs.map((proof) =>
        Counter.enclose({
          code: "BlindedStateQuadruples",
          version: Vrsn_2_0,
          qb64: concatBytes(proof.d.qb64b, proof.u.qb64b, proof.td.qb64b, proof.ts.qb64b),
        })
      );
      groups.push(...messageAttachmentGroups({ sourceSeals: sources }, Vrsn_2_0).map((group) => group.raw));
      return (yield* call(() => parseBytes(messagize(credential, concatBytes(...groups), { gvrsn: Vrsn_2_0 }))))[0];
    };
    const child = yield* node();
    try {
      const tsg = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(grant.raw, true),
      );
      const frame: CesrFrame = {
        body: grant,
        attachments: messageAttachmentGroups({ tsgs: [tsg] }, Vrsn_2_0),
        gvrsn: Vrsn_2_0,
        nests: [child],
      };
      yield* runtime.reactor.process((signal) => framePayload(frame).open(signal));
      assertExists(hby.db.epse.get([grant.said!]));
      assertEquals(hby.db.exchangeMeta.get([grant.said!])?.receiverTime, receipt);
      const originalDeadline = hby.db.epsd.get(grant.said!)!.dts;
      assertEquals(originalDeadline, makeNowIso8601(new Date(now + 300000)));
      assertEquals(hby.db.exns.get([grant.said!]), null);
      assertEquals(observer.processEvent(ibup).kind, "accept");
      yield* runtime.protocol.processEscrowsOnce();
      assertExists(hby.db.epse.get([grant.said!]), "issuer update resolves before the presentation registry arrives");
      now += 11000;
      yield* store.baser.reopen();
      yield* hby.db.reopen();
      assertEquals(observer.processEvent(prip).kind, "accept");
      yield* runtime.protocol.processEscrowsOnce();
      assertExists(hby.db.epse.get([grant.said!]), "accepted inception does not satisfy the source's missing update");
      assertEquals(hby.db.exns.get([grant.said!]), null);
      assertEquals(observer.processEvent(pbup).kind, "accept");
      // Backdated later updates cannot replace the exact Issuee-sealed historical head.
      const vacant = makeBlindState({ sn: 2 });
      const vacantTime = earlier;
      const vacuous = blindate(prip.said!, pbup.said!, vacant.d.nonce, { sn: 2, stamp: vacantTime });
      const vacantSource = anchor(issuee, vacuous);
      assertEquals(observer.processEvent(vacuous).kind, "accept");
      now += 1000;
      const newer = makeBlindState({ acdc: credential.said!, state: "revoked", sn: 3 });
      const latest = blindate(prip.said!, vacuous.said!, newer.d.nonce, {
        sn: 3,
        stamp: earlier,
      });
      anchor(issuee, latest);
      assertEquals(observer.processEvent(latest).kind, "accept");
      yield* runtime.exc.processEscrows();
      assertExists(hby.db.exns.get([grant.said!]));
      assertEquals(hby.db.epsd.get(grant.said!)!.dts, originalDeadline, "acceptance keeps original Grant validity");
      assertEquals(hby.db.exchangeMeta.get([grant.said!])?.receiverTime, receipt);
      assertEquals(hby.db.exns.get([credential.said!]), null, "parent acceptance never dispatches its child");
      const handler = new IpexV2Handler("/ipex/grant", hby, null, store);
      const verify = (
        nest: CesrFrame = child,
        cutoff: string | undefined = receipt,
        body = grant,
        historical = false,
      ) =>
        handler.verify({
          serder: body,
          nests: [nest],
          attachments: [],
          evidence: { tsgs: [], cigars: [], sourceSeals: [] },
          receiverTime: cutoff,
          historical,
        });
      assertEquals(
        (verify() as { kind: string }).kind,
        "accept",
        "Issuee presentation proof alone satisfies permitted ax anchoring",
      );
      assertEquals(runtime.exc.verifyAccepted(grant.said!, "/ipex/grant"), true);
      assertEquals(runtime.exc.verifyAccepted(grant.said!, "/ipex/grant", { historical: true }), true);
      assertEquals(
        handler.verify({
          serder: grant,
          nests: [child],
          attachments: [],
          evidence: { tsgs: [], cigars: [], sourceSeals: [] },
        }),
        false,
        "completed receiver-time acceptance remains required without selecting TEL history",
      );
      assertEquals(
        (verify(child, receipt.replace("123000", "122999")) as { kind: string }).kind,
        "accept",
        "receiver time does not select TEL history",
      );
      assertEquals(
        (verify(child, makeNowIso8601(new Date(now))) as { kind: string }).kind,
        "accept",
        "later receipt retains the same exact source",
      );
      const continued = yield* node([iblind, pblind, vacant], [source, vacantSource]);
      {
        assertEquals(
          (verify(continued, vacantTime) as { kind: string }).kind,
          "accept",
          "one authentic vacuous disclosure preserves the preceding binding",
        );
      }
      const otherGrant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
        kind: Kinds.json,
        message: "other target",
        recipient: issuee.pre,

        date: receipt,
        anchor: true,
      });
      assertEquals(verify(child, receipt, otherGrant), false);
      for (
        const sources of [[], [{ ...source, i: new Prefixer({ qb64: issuer.pre }) }], [{
          ...source,
          d: new Diger({ qb64: issuer.kever!.said }),
        }], [{ ...source, s: NumberPrimitive.fromNum(1n) }]]
      ) {
        const bad = yield* node([iblind, pblind], sources);
        {
          assertEquals(verify(bad), false);
        }
      }
      const noIssuer = yield* node([pblind]);
      const duplicate = yield* node([iblind, pblind, pblind]);
      {
        assertEquals(
          (verify(noIssuer) as { kind: string }).kind,
          "escrow",
          "a valid presentation proof does not disclose the current issuer state",
        );
        assertEquals(verify(duplicate), false, "exactly one disclosure must match each selected BLID");
      }
      for (const sn of [99n, 9007199254740993n]) {
        const unavailable = yield* node([iblind, pblind], [{ ...source, s: NumberPrimitive.fromNum(sn) }]);
        {
          assertEquals((verify(unavailable) as { kind: string }).kind, "escrow");
        }
      }
      const opaque = makeBlindState({ acdc: credential.said!, state: "revoked", sn: 2 });
      const unmatched = yield* node([opaque, pblind]);
      assertEquals(
        verify(unmatched),
        false,
        "an unmatched supplied opening is refused against accepted TEL evidence",
      );
      const newerIssuer = blindate(irip.said!, ibup.said!, opaque.d.nonce, { sn: 2, stamp: earlier });
      anchor(issuer, newerIssuer);
      assertEquals(observer.processEvent(newerIssuer).kind, "accept");
      const oldIssuerSource = yield* node([iblind, pblind], [source, issuerSource]);
      assertEquals(
        (verify(oldIssuerSource) as { kind: string }).kind,
        "escrow",
        "generic issuer source cannot disclose current issuer standing",
      );
      assertEquals(
        runtime.exc.verifyAccepted(grant.said!, "/ipex/grant"),
        false,
        "current use still requires the newer issuer opening",
      );
      assertEquals(
        runtime.exc.verifyAccepted(grant.said!, "/ipex/grant", { historical: true }),
        true,
        "retained BLID selects its exact authenticated issuer prefix behind an opaque successor",
      );
      const disclosedRevocation = yield* node([opaque, pblind]);
      assertEquals(
        (verify(disclosedRevocation) as { kind: string }).kind,
        "accept",
        "authenticated revocation is not a policy approval",
      );
      const vacantIssuer = makeBlindState({ sn: 3 });
      const issuerVacuous = blindate(irip.said!, newerIssuer.said!, vacantIssuer.d.nonce, { sn: 3, stamp: earlier });
      anchor(issuer, issuerVacuous);
      assertEquals(observer.processEvent(issuerVacuous).kind, "accept");
      const retainedWithVacuity = yield* node([iblind, vacantIssuer, pblind]);
      assertEquals(
        (verify(retainedWithVacuity, receipt, grant, true) as { kind: string }).kind,
        "accept",
        "vacuous opening cannot advance historical selection past a hidden successor",
      );
      assertEquals((verify(noIssuer, receipt, grant, true) as { kind: string }).kind, "escrow");
      assertEquals(verify(duplicate, receipt, grant, true), false);
      const unavailable = makeBlindState({ acdc: credential.said!, state: "issued", sn: 9 });
      for (const proofs of [[unavailable, iblind, iblind, pblind], [iblind, iblind, unavailable, pblind]]) {
        assertEquals(
          verify(yield* node(proofs), receipt, grant, true),
          false,
          "duplicate contradiction wins before an unmatched target dependency in either order",
        );
      }
      const retained = hby.db.enst.get(grant.said!), cues = runtime.exc.cues.toArray();
      yield* store.baser.reopen();
      yield* hby.db.reopen();
      for (let i = 0; i < 2; i++) {
        assertEquals(runtime.exc.verifyAccepted(grant.said!, "/ipex/grant", { historical: true }), true);
        assertEquals(runtime.exc.verifyAccepted(grant.said!, "/ipex/grant"), false);
      }
      assertEquals(hby.db.enst.get(grant.said!), retained);
      assertEquals(runtime.exc.cues.toArray(), cues);
      assertEquals(hby.db.exchangeMeta.get(grant.said!)?.receiverTime, receipt);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("registry-backed IPEX retries only after public observer intake accepts foreign anchored evidence", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const store = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = source.makeHab("issuer"), rip = regcept(issuer.pre);
    const sender = hby.makeHab("sender");
    const exchanger = new Exchanger(hby);
    const registry = new RegistryStore(store);
    loadIpexHandlers(hby, exchanger, { registry });
    const observer = new RegistryObserver(hby.db, registry);
    const credential = acdcmap(issuer.pre, { regid: rip.said!, attribute: { d: "", name: "Alice" } });
    const disclosure = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n, raw: b("0123456789abcdef") });
    const issued = blindate(rip.said!, rip.said!, disclosure.d.nonce);
    const attachment = Counter.enclose({
      code: "BlindedStateQuadruples",
      version: Vrsn_2_0,
      qb64: concatBytes(disclosure.d.qb64b, disclosure.u.qb64b, disclosure.td.qb64b, disclosure.ts.qb64b),
    });
    const [node] = yield* call(() => parseBytes(messagize(credential, attachment, { gvrsn: Vrsn_2_0 })));
    try {
      yield* call(() => learn(hby, acceptedEventReplayMessage(source, issuer.pre, 0).message));
      assertEquals(hby.habs.has(issuer.pre), false, "registry issuer remains foreign");
      const body = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
        kind: Kinds.json,
        message: "registry-backed",
        recipient: sender.pre,
      });
      const establishment = sender.kever!.serder;
      const tsgs = [
        new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          establishment.sner!,
          new Diger({ qb64: establishment.said! }),
          sender.sign(body.raw, true),
        ),
      ];
      assertEquals((yield* exchanger.processEvent({ serder: body, tsgs, nests: [node] })).kind, "escrow");
      assertExists(hby.db.epse.get(body.said!));
      yield* store.reopen();
      yield* hby.db.reopen();
      yield* exchanger.processEscrows();
      assertEquals(hby.db.exns.get(body.said!), null);
      assertEquals(observer.processEvent(issued).kind, "escrow");
      assertEquals(observer.processEvent(rip).kind, "escrow");
      assertEquals([registry.head(rip.said!), registry.seqSaider(rip.said!, 0)], [null, null]);
      yield* store.close(false);
      yield* store.reopen({ reuse: true });
      observer.processEscrows(rip.said!);
      yield* exchanger.processEscrows();
      assertEquals(hby.db.exns.get(body.said!), null, "staged registry bodies do not satisfy IPEX");
      yield* call(() =>
        learn(
          hby,
          issuer.interact({
            data: [rip, issued].map((event) => ({ i: rip.said!, s: event.sad!.n, d: event.said! })),
          }),
        )
      );
      observer.processEscrows(rip.said!);
      assertEquals(registry.head(rip.said!)!.qb64, issued.said);
      assert(node.body instanceof SerderACDC);
      const authenticated = authenticateIpexNode(node.body, envelopeFromFrame(node), hby.db, registry);
      assert(authenticated.kind === "authenticated");
      assertExists(authenticated.registration);
      assertEquals(authenticated.registration.regid, credential.regid);
      assertEquals(authenticated.registration.acdc, credential.said);
      assertEquals(
        authenticated.registration.state,
        "issued",
        "retain the authenticated state without deciding edge validity",
      );
      const seqEvent = registry.seqEvent;
      try {
        const handler = new IpexV2Handler("/ipex/grant", hby, null, registry);
        registry.seqEvent = (regid, sn) => sn ? null : seqEvent.call(registry, regid, sn);
        assertThrows(
          () =>
            handler.verify({
              serder: body,
              nests: [node],
              attachments: [],
              evidence: { tsgs: [], cigars: [], sourceSeals: [] },
            }),
          Error,
          "missing sequence entry",
        );
        registry.seqEvent = (regid, sn) =>
          sn
            ? blindate(rip.said!, issued.said!, disclosure.d.nonce)
            : seqEvent.call(registry, regid, sn);
        assertThrows(
          () =>
            handler.verify({
              serder: body,
              nests: [node],
              attachments: [],
              evidence: { tsgs: [], cigars: [], sourceSeals: [] },
            }),
          Error,
          "sequence is inconsistent",
        );
        registry.seqEvent = () => {
          throw new Error("registry read unavailable");
        };
        assertThrows(
          () =>
            handler.verify({
              serder: body,
              nests: [node],
              attachments: [],
              evidence: { tsgs: [], cigars: [], sourceSeals: [] },
            }),
          Error,
          "registry read unavailable",
        );
      } finally {
        registry.seqEvent = seqEvent;
      }
      yield* store.reopen();
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(body.said!));
      assertEquals(hby.db.epse.get(body.said!), null);
      const noProof = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
        kind: Kinds.json,
        message: "missing node disclosure",
        recipient: sender.pre,
      });
      const groups = [
        new TransIdxSigGroup(
          new Prefixer({ qb64: sender.pre }),
          establishment.sner!,
          new Diger({ qb64: establishment.said! }),
          sender.sign(noProof.raw, true),
        ),
      ];
      assertEquals(
        (yield* exchanger.processEvent({ serder: noProof, tsgs: groups, nests: [{ ...node, attachments: [] }] })).kind,
        "escrow",
      );
      assertEquals(hby.db.exns.get(noProof.said!), null);
      assertEquals(hby.db.exns.get(credential.said!), null);
    } finally {
      yield* source.close(true);
      yield* store.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("IPEX schema gates precede issuer reduction and validate every edge pin", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer"), sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const schema = new Schemer({
      sed: {
        $id: "",
        version: "1.0.0",
        type: "object",
        properties: { a: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
      },
    });
    const exchanger = new Exchanger(hby);
    loadIpexHandlers(hby, exchanger);
    const credential = (name: string | number, edge?: NonNullable<Parameters<typeof acdcmap>[1]>["edge"]) =>
      acdcmap(issuer.pre, { schema: schema.said, attribute: { d: "", name }, ...(edge ? { edge } : {}) });
    const node = (body: SerderACDC, signed = true): CesrFrame => ({
      body,
      attachments: signed
        ? messageAttachmentGroups({
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: issuer.pre }),
              issuer.kever!.sner,
              new Diger({ qb64: issuer.kever!.said }),
              issuer.sign(body.raw, true),
            ),
          ],
        }, Vrsn_2_0)
        : [],
    });
    const args = (verb: "/ipex/offer" | "/ipex/grant", bodies: SerderACDC[], signed = true) => {
      const serder = ipexExnBody(sender.pre, verb, bodies, {
        message: crypto.randomUUID(),
        recipient: recipient.pre,

        plan: bodies.map((body, i) => [schema.said, i ? "/e/link/_/" : "/", []]),
      });
      return {
        serder,
        nests: bodies.map((body) => node(body, signed)),
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: sender.pre }),
            sender.kever!.sner,
            new Diger({ qb64: sender.kever!.said }),
            sender.sign(serder.raw, true),
          ),
        ],
      };
    };
    try {
      const valid = credential("Ada"), invalid = credential(7);
      // Metadata offers intentionally withhold issuer proof; the outer sender cannot waive schema validation.
      const offer = args("/ipex/offer", [valid], false);
      assertEquals((yield* exchanger.processEvent(offer)).kind, "escrow");
      assertExists(hby.db.emse!.get([offer.serder.said!, schema.said]));
      const unsigned = args("/ipex/grant", [valid], false);
      assertEquals((yield* exchanger.processEvent(unsigned)).kind, "escrow");
      assertExists(
        hby.db.emse!.get([unsigned.serder.said!, schema.said]),
        "own schemas precede issuer proof reduction",
      );
      const grant = args("/ipex/grant", [valid]);
      assertEquals((yield* exchanger.processEvent(grant)).kind, "escrow");
      assertExists(hby.db.emse!.get([grant.serder.said!, schema.said]));
      hby.db.schema.pin(schema.said, schema);
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(offer.serder.said!));
      assertExists(hby.db.exns.get(grant.serder.said!));
      assertEquals(
        hby.db.exns.get(unsigned.serder.said!),
        null,
        "schema arrival does not supply issuer authentication",
      );
      for (const verb of ["/ipex/offer", "/ipex/grant"] as const) {
        const rejected = args(verb, [invalid], verb === "/ipex/grant");
        assertEquals((yield* exchanger.processEvent(rejected)).kind, "reject");
        assertEquals(hby.db.exns.get(rejected.serder.said!), null);
      }
      // A correctly authenticated Grant must still fulfill the exact accepted Offer.
      const submit = (serder: SerderKERI, nests: CesrFrame[] = []) => {
        const signer = serder.pre === sender.pre ? sender : recipient;
        return exchanger.processEvent({
          serder,
          nests,
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: signer.pre }),
              signer.kever!.sner,
              new Diger({ qb64: signer.kever!.said }),
              signer.sign(serder.raw, true),
            ),
          ],
        });
      };
      const aggregate = acdcagg(issuer.pre, { schema: schema.said, aggregate: ["", { d: "", name: "Ada" }] });
      for (
        const [carry, name, credential, outcome] of [
          [false, "Ada", valid, "escrow"],
          [true, "Grace", valid, "reject"],
          [true, "Ada", valid, "accept"],
          [true, "Ada", aggregate, "accept"],
        ] as const
      ) {
        const metadata = acdcmap(issuer.pre, {
          uuid: "",
          schema: schema.sed as MapperMap,
          ...(credential === aggregate
            ? { aggregate: (aggregate.sad!.A as string[])[0] }
            : { attribute: { d: "", name } }),
        });
        assert(metadata.said !== credential.said, "metadata and credential roots differ");
        const apply = ipexExnBody(recipient.pre, "/ipex/apply", [], {
          message: "request",
          recipient: sender.pre,

          plan: [[schema.said, "/", []]],
        });
        const offered = ipexExnBody(sender.pre, "/ipex/offer", [metadata], { message: "promise", prior: apply });
        const agreed = ipexExnBody(recipient.pre, "/ipex/agree", [], { message: "accept promise", prior: offered });
        for (const body of [apply, offered, agreed]) {
          assertEquals((yield* submit(body, body === offered && carry ? [node(metadata, false)] : [])).kind, "accept");
        }
        const granted = ipexExnBody(sender.pre, "/ipex/grant", [credential], { message: "fulfill", prior: agreed });
        assertEquals(
          (yield* submit(granted, [node(credential)])).kind,
          outcome,
          `metadata ${carry ? name : "unavailable"}`,
        );
        assertEquals(Boolean(hby.db.exns.get(granted.said!)), outcome === "accept");
        assertEquals(Boolean(hby.db.epse.get(granted.said!)), outcome === "escrow");
      }
      // Bypass authoring validation: an issuer signature cannot turn metadata into a Grant credential.
      const metadata = acdcmap(issuer.pre, { uuid: "", schema: schema.said, attribute: { d: "", name: "Ada" } });
      const metadataGrant = exincept("/ipex/grant", {
        attributes: { m: "metadata is not a credential", o: [metadata.said] },
        sender: sender.pre,
        receiver: recipient.pre,
        modifiers: { dp: [[[schema.said, "/", []]]] },
        pvrsn: Vrsn_2_0,
      });
      assertEquals((yield* submit(metadataGrant, [node(metadata)])).kind, "reject");
      assertEquals(hby.db.exns.get(metadataGrant.said!), null);
      assertEquals(hby.db.epse.get(metadataGrant.said!), null);
      for (
        const publicNode of [
          acdcatt(issuer.pre, {
            schema: schema.said,
            attribute: { d: "", name: "Ada" },
          }),
          aggregate,
        ]
      ) {
        assertEquals(publicNode.sad!.u, "", "a fixed public UUID slot does not mark metadata");
        const grant = ipexExnBody(sender.pre, "/ipex/grant", [publicNode], {
          message: "public fixed-field credential",
          recipient: recipient.pre,
        });
        assertEquals((yield* submit(grant, [node(publicNode)])).kind, "accept");
      }
      // Whole-node requests require expanded top-level sections; relative requests use the carried canonical Compactor view.
      const scalar = { type: "string" };
      const profile = {
        type: "object",
        properties: { d: scalar, value: scalar },
        additionalProperties: false,
      };
      const attribute = {
        type: "object",
        properties: { d: scalar, profile: { oneOf: [scalar, profile] }, reference: scalar },
        additionalProperties: false,
      };
      const closed = new Schemer({
        sed: { $id: "", version: "1.0.0", type: "object", properties: { a: attribute } },
      });
      const full = acdcmap(issuer.pre, {
        schema: closed.said,
        attribute: { d: "", profile: { d: "", value: "visible" }, reference: valid.said! },
      });
      const fullAttribute = full.sad!.a as MapperMap;
      const hidden = new SerderACDC({
        sad: { ...full.sad!, a: { ...fullAttribute, profile: (fullAttribute.profile as MapperMap).d } },
        makify: true,
      });
      assertEquals(hidden.said, full.said, "hidden and expanded views keep the same credential commitment");
      const disclose = (body: SerderACDC, fields: readonly string[]) => {
        const grant = ipexExnBody(sender.pre, "/ipex/grant", [body], {
          message: crypto.randomUUID(),
          recipient: recipient.pre,

          plan: [[body.schema as string, "/", fields]],
        });
        return submit(grant, [node(body)]);
      };
      const waiting = yield* disclose(full, [""]);
      assert(waiting.kind === "escrow");
      assertEquals(waiting.reason, "Missing node schema.");
      assertExists(hby.db.emse!.get([waiting.said, closed.said]));
      hby.db.schema.pin(closed.said, closed);
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(waiting.said), "ordinary schema arrival completes the same retained Grant");
      assertEquals((yield* disclose(hidden, [])).kind, "accept", "presence does not promise recursive closure");
      assertEquals(
        (yield* disclose(hidden, ["a/reference"])).kind,
        "accept",
        "explicit scalar-SAID data remains valid",
      );
      const closureKinds = [];
      for (const fields of [[""], ["d/"], ["a/"]]) closureKinds.push((yield* disclose(hidden, fields)).kind);
      assertEquals(
        closureKinds,
        ["accept", "reject", "accept"],
        "upstream checks top-level expansion and literal relative traversal",
      );
      for (const fields of [[""], ["a/"]]) {
        assertEquals(
          (yield* disclose(full, fields)).kind,
          "accept",
          "scalar-SAID data does not require schema closure",
        );
      }
      assertEquals(
        (yield* disclose(full, ["d/"])).kind,
        "reject",
        "a relative trailing hop cannot traverse a primitive SAID",
      );
      const wholeAggregate = acdcmap(issuer.pre, { schema: closed.said, aggregate: aggregate.sad!.A as string[] });
      assertEquals(
        (yield* disclose(wholeAggregate, [""])).kind,
        "accept",
        "an expanded aggregate is a whole disclosed section",
      );
      const { additionalProperties: _, ...openAttribute } = attribute;
      const open = new Schemer({
        sed: { $id: "", version: "1.0.0", type: "object", properties: { a: openAttribute } },
      });
      hby.db.schema.pin(open.said, open);
      const openNode = acdcmap(issuer.pre, { schema: open.said, attribute: fullAttribute });
      assertEquals(
        (yield* disclose(openNode, [""])).kind,
        "accept",
        "own schema validation does not impose a private closed-schema profile",
      );
      // IPEX expanded leaves name ACDCs; compact Edge strings never name far ACDCs.
      const edgeNode = (properties: MapperMap, required: string[], edge: MapperMap, union = false) => {
        const shape = {
          type: "object",
          properties: { d: scalar, ...properties },
          required,
          additionalProperties: false,
        };
        const schema = new Schemer({
          sed: {
            $id: "",
            version: "1.0.0",
            type: "object",
            required: ["e"],
            properties: { e: union ? { oneOf: [{ type: "string" }, shape] } : shape },
          },
        });
        return acdcmap(issuer.pre, { schema: schema.sed as MapperMap, attribute: { d: "", name: "Near" }, edge });
      };
      const edgeIntake = (bodies: SerderACDC[], prefixes: string[]) => {
        const body = exincept("/ipex/grant", {
          attributes: { m: crypto.randomUUID(), o: [bodies[0].said] },
          sender: sender.pre,
          receiver: recipient.pre,
          pvrsn: Vrsn_2_0,
          modifiers: {
            dp: [prefixes.map((prefix, i) => {
              const source = bodies[i].schema;
              return [typeof source === "string" ? source : (source as MapperMap).$id, prefix, []];
            })],
          },
        });
        return submit(body, bodies.map((body) => node(body)));
      };
      const stringEdge = edgeNode({ link: scalar }, ["link"], { d: "", link: valid.said! }, true);
      const labeled = edgeNode({ link: { type: "object" } }, ["link"], {
        d: "",
        link: { n: valid.said!, context: "ordinary application data" },
      });
      const fixedSchema = new Schemer({
        sed: {
          $id: "",
          version: "1.0.0",
          type: "object",
          properties: Object.fromEntries(Object.keys(valid.sad!).map((key) => [key, {}])),
          additionalProperties: false,
        },
      });
      const fixedFar = (name: string) =>
        acdcmap(issuer.pre, { schema: fixedSchema.sed as MapperMap, attribute: { d: "", name } });
      const fixedValid = fixedFar("Ada"), sibling = fixedFar("Sibling");
      const fixed = edgeNode({ first: scalar, second: scalar }, ["first", "second"], {
        d: "",
        first: fixedValid.said!,
        second: sibling.said!,
      });
      const optional = edgeNode({ link: scalar }, [], { d: "", link: valid.said! });
      for (const body of [stringEdge, labeled, fixed, fixedValid, sibling, optional]) {
        assertEquals(validateSchema(body, hby.db), { kind: "valid" }, JSON.stringify(body.sad!.e));
      }
      const outcomes = [];
      outcomes.push((yield* edgeIntake([stringEdge, valid], ["/", "/e/link/_/"])).kind);
      outcomes.push((yield* edgeIntake([labeled, valid], ["/", "/e/link/_/"])).kind);
      // An explicit plan cannot skip any carried BFS node.
      outcomes.push((yield* edgeIntake([fixed, sibling, fixedValid], ["/", "/e/second/_/"])).kind);
      outcomes.push((yield* edgeIntake([optional, valid], ["/", "/e/link/_/"])).kind);
      assertEquals(outcomes, ["reject", "reject", "reject", "reject"]);
      assertEquals(
        (yield* edgeIntake([fixed, sibling, fixedValid], ["/", "/e/second/_/", "/e/first/_/"])).kind,
        "reject",
        "explicit selections retain BFS order",
      );
      assertEquals(
        (yield* edgeIntake([stringEdge], ["/"])).kind,
        "reject",
        "a selected far node cannot be added to immutable Grant bytes later",
      );
      for (const target of [42, "4A!!"]) {
        const malformed = edgeNode({ link: {} }, ["link"], { d: "", link: { n: target } });
        assertEquals((yield* edgeIntake([malformed], ["/"])).kind, "reject", "malformed target refuses at intake");
      }
      const wrongOrder = edgeNode({ link: { type: "object" } }, ["link"], {
        d: "",
        link: { context: "before reserved", n: valid.said! },
      });
      assertEquals((yield* edgeIntake([wrongOrder, valid], ["/", "/e/link/_/"])).kind, "reject");
      const leafProperty = edgeNode({ link: { type: "object" } }, ["link"], {
        d: "",
        link: { n: valid.said!, extra: { n: sibling.said! } },
      });
      assertEquals(
        (yield* edgeIntake([leafProperty, valid, sibling], ["/", "/e/link/_/", "/e/link/extra/_/"])).kind,
        "reject",
        "leaf application properties never extend graph reachability",
      );
      const absentSchema = acdcmap(issuer.pre, {
        schema: (labeled.schema as MapperMap).$id as string,
        attribute: { d: "", name: "Near" },
        edge: { d: "", link: { n: valid.said! } },
      });
      const waitingEdge = yield* edgeIntake([absentSchema, valid], ["/", "/e/link/_/"]);
      assert(waitingEdge.kind === "escrow");
      assertEquals(waitingEdge.reason, "Missing node schema.");
      const cachedEdgeSchema = new Schemer({ sed: labeled.schema as MapperMap });
      hby.db.schema.pin(cachedEdgeSchema.said, cachedEdgeSchema);
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(waitingEdge.said), "schema arrival retries the unchanged signed Grant");
      const optionalGroup = edgeNode(
        {
          link: scalar,
          optional: {
            type: "object",
            properties: { d: scalar, link: scalar },
            required: ["link"],
            additionalProperties: false,
          },
        },
        ["link"],
        { d: "", link: valid.said! },
      );
      assertEquals((yield* edgeIntake([optionalGroup, valid], ["/", "/e/link/_/"])).kind, "reject");
      const arraySchema = new Schemer({
        sed: {
          $id: "",
          version: "1.0.0",
          type: "object",
          properties: { e: { type: "array", items: { type: "object" } } },
        },
      });
      const arrayEdge = new SerderACDC({
        sad: { ...valid.sad!, s: arraySchema.sed, e: [{ link: { n: valid.said } }] },
        makify: true,
      });
      assertEquals(
        (yield* edgeIntake([arrayEdge, valid], ["/", "/e/0/link/_/"])).kind,
        "accept",
        "expanded arrays retain explicit-hop support",
      );
      for (const prefix of ["/a/link/_/", "/e/link/_/a/link/_/"]) {
        assertEquals((yield* edgeIntake([stringEdge, valid], ["/", prefix])).kind, "reject");
      }
      // A leaf union remains opaque even when a matching far node is carried.
      const ambiguous = edgeNode(
        { link: { oneOf: [scalar, { type: "object", properties: { n: scalar } }] } },
        ["link"],
        { d: "", link: valid.said! },
      );
      assertEquals((yield* edgeIntake([ambiguous, valid], ["/", "/e/link/_/"])).kind, "reject");
      // Same-schema pins still evaluate the far credential; equality of IDs proves no payload constraint.
      const near = (far: SerderACDC, pin: string | MapperMap) =>
        credential("Near", { d: "", link: { n: far.said, s: pin } });
      const graph = (far: SerderACDC, pin: string | MapperMap) => {
        const root = near(far, pin);
        const graph = walkIpexGraph(root.said!, [node(root), node(far)], true);
        assert(graph && !("kind" in graph));
        return graph;
      };
      assertEquals(evaluateRelations(graph(valid, schema.said), hby.db), { kind: "valid" });
      assertEquals(evaluateRelations(graph(invalid, schema.said), hby.db), null);
      const alternative = credential("Near", {
        d: "",
        o: "OR",
        bad: {
          n: valid.said,
          s: new Schemer({
            sed: {
              $id: "",
              version: "1.0.0",
              type: "object",
              properties: { a: { properties: { name: { const: "Other" } } } },
            },
          }).sed as MapperMap,
        },
        good: { n: valid.said },
      });
      const alternativeGraph = walkIpexGraph(alternative.said!, [node(alternative), node(valid)], true);
      assert(alternativeGraph && !("kind" in alternativeGraph));
      assertEquals(
        evaluateRelations(alternativeGraph, hby.db),
        { kind: "valid" },
      );
      const edgeSchema = new Schemer({
        sed: {
          $id: "",
          version: "1.0.0",
          type: "object",
          properties: { a: { properties: { name: { const: "Ada" } } } },
        },
      });
      const inherited = credential("Near", { d: "", group: { s: edgeSchema.said, link: { n: valid.said } } });
      const inheritedGraph = walkIpexGraph(inherited.said!, [node(inherited), node(valid)], true);
      assert(inheritedGraph && !("kind" in inheritedGraph));
      assertEquals(evaluateRelations(inheritedGraph, hby.db), {
        kind: "unknown",
        retryable: true,
        reason: `Missing edge schema ${edgeSchema.said}.`,
        schemas: [edgeSchema.said],
      });
      const edgeGrant = args("/ipex/grant", [near(valid, edgeSchema.said), valid]);
      assertEquals((yield* exchanger.processEvent(edgeGrant)).kind, "escrow");
      assertExists(hby.db.emse!.get([edgeGrant.serder.said!, edgeSchema.said]));
      hby.db.schema.pin(edgeSchema.said, edgeSchema);
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(edgeGrant.serder.said!), "the same Grant accepts after the decisive pin arrives");
      assertEquals(evaluateRelations(inheritedGraph, hby.db), { kind: "valid" });
      assertEquals(evaluateRelations(graph(valid, edgeSchema.sed as MapperMap), hby.db), { kind: "valid" });
      assertEquals(evaluateRelations(graph(credential("Other"), edgeSchema.said), hby.db), { kind: "invalid" });
      // A real schema read failure propagates; it is never downgraded to missing-schema escrow.
      const get = hby.db.schema.get.bind(hby.db.schema);
      hby.db.schema.get = () => {
        throw new Error("schema storage unavailable");
      };
      try {
        assertThrows(() => evaluateRelations(graph(valid, edgeSchema.said), hby.db), Error, "storage unavailable");
      } finally {
        hby.db.schema.get = get;
      }
      assertEquals(hby.db.exns.get(valid.said!), null, "conversation acceptance does not accept a credential");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("v2 IPEX binds EXN continuations to the XIP SAID and enforces one wire DAG", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const requester = hby.makeHab("requester"), responder = hby.makeHab("responder");
    const exchanger = new Exchanger(hby);
    loadIpexHandlers(hby, exchanger);
    const submit = (body: SerderKERI, signer: typeof requester) =>
      exchanger.processEvent({
        serder: body,
        tsgs: [
          new TransIdxSigGroup(
            signer.kever!.prefixer,
            signer.kever!.sner,
            new Diger({ qb64: signer.kever!.said }),
            signer.sign(body.raw, true),
          ),
        ],
      });
    try {
      const apply = ipexExnBody(requester.pre, "/ipex/apply", [], {
        message: "no disclosure",
        recipient: responder.pre,
        plan: [],
      });
      for (const dp of [[], [[], []], [null], [[[42, "/", []]]]]) {
        const malformed = new SerderKERI({ sad: { ...apply.sad, q: { dp } }, makify: true });
        assertEquals((yield* submit(malformed, requester)).kind, "reject");
        assertEquals(exchanger.complete(malformed.said!), false);
      }
      const exnOpener = new SerderKERI({
        sad: {
          t: "exn",
          i: requester.pre,
          ri: responder.pre,
          x: apply.said,
          p: "",
          dt: apply.stamp,
          r: "/ipex/apply",
          q: { dp: [[]] },
          a: { m: "invalid opener ilk" },
        },
        pvrsn: Vrsn_2_0,
        makify: true,
      });
      assertEquals((yield* submit(exnOpener, requester)).kind, "reject");
      assertEquals((yield* submit(apply, requester)).kind, "accept");
      const offer = ipexExnBody(responder.pre, "/ipex/offer", [], { message: "offer", prior: apply });
      const wrong = new SerderKERI({ sad: { ...offer.sad, x: offer.said }, makify: true });
      assertEquals((yield* submit(wrong, responder)).kind, "reject");
      assertEquals(hby.db.erpy.get(apply.said!), null, "a refused transaction ID cannot consume the response");
      assertEquals((yield* submit(offer, responder)).kind, "accept");
      const agree = ipexExnBody(requester.pre, "/ipex/agree", [], { message: "agree", prior: offer });
      const grant = ipexExnBody(responder.pre, "/ipex/grant", [], { message: "vacuous grant", prior: agree });
      const admit = ipexExnBody(requester.pre, "/ipex/admit", [], { message: "admit", prior: grant });
      for (const [body, signer] of [[agree, requester], [grant, responder], [admit, requester]] as const) {
        assertEquals(body.ilk, "exn");
        assertEquals(body.sad!.x, apply.said);
        assertEquals((yield* submit(body, signer)).kind, "accept");
        if (body === grant) {
          assertEquals(
            exchanger.pendingGrant(grant.said!, { xid: apply.said!, sender: responder.pre, recipient: requester.pre }),
            null,
            "an accepted Grant is not pending issuance authority",
          );
        }
      }
      assertEquals(hby.db.erpy.get(grant.said!)!.qb64, admit.said!);
      assertEquals(
        exchanger.pendingGrant(grant.said!, { xid: apply.said!, sender: responder.pre, recipient: requester.pre }),
        null,
        "an actually admitted conversation cannot authorize pending issuance",
      );
      assertEquals(grant.sad!.a, { m: "vacuous grant", o: [] });
      assertEquals(grant.sad!.q, { dp: [[]] });
      for (const verb of ["offer", "grant"] as const) {
        const opener = ipexExnBody(responder.pre, `/ipex/${verb}`, [], {
          message: `empty ${verb}`,
          recipient: requester.pre,
          plan: [],
        });
        assertEquals(opener.ilk, "xip");
        assertEquals((yield* submit(opener, responder)).kind, "accept");
      }
      const anchored = ipexExnBody(responder.pre, "/ipex/grant", [], {
        message: "anchored vacuous grant",
        recipient: requester.pre,
        plan: [],
        anchor: true,
      });
      assertEquals((yield* submit(anchored, responder)).kind, "reject", "empty disclosure cannot waive ax");
      responder.interact({ data: [{ d: anchored.said! }] });
      assertEquals(
        (yield* exchanger.processEvent({
          serder: anchored,
          sscs: [{
            s: responder.kever!.sner,
            d: new Diger({ qb64: responder.kever!.said }),
          }],
        })).kind,
        "accept",
      );
    } finally {
      yield* hby.close(true);
    }
  });
});
