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
import { assert, assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { type ExchangeDecision, Exchanger } from "../../../src/app/exchanging.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { ipexExnBody, prepareIpexExn } from "../../../src/app/ipex-building.ts";
import { verifyIpexRelations as verifyRelations, walkIpexGraph } from "../../../src/app/ipex-graph.ts";
import { authenticateIpexNode } from "../../../src/app/ipex-node-authentication.ts";
import { IpexV2Handler } from "../../../src/app/ipex-v2.ts";
import { type IpexRoute, loadIpexHandlers } from "../../../src/app/ipexing.ts";
import { Notifier, openNoterForHabery } from "../../../src/app/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import fixture from "../../fixtures/keripy-ipex-vectors.json" with { type: "json" };
/** These relation fixtures are unregistered; signed grants exercise authentication separately. */
const verifyIpexRelations = (graph: Parameters<typeof verifyRelations>[0], db: Habery["db"]) =>
  verifyRelations(graph, db, new Map());

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
Deno.test("v2 IPEX matches frozen wire decisions and retains only parent-owned authenticated disclosures", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `ipex-vectors-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(hby);
    const notifier = new Notifier(hby.signator!, { noter });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const exchanger = new Exchanger(hby);
    loadIpexHandlers(hby, exchanger, { notifier });
    try {
      assertEquals(fixture.reference, "927c0cb8794d7c84fc17143c67df64aab9deda6c");
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
          assertEquals(decision?.kind, row.outcome, row.name);
          assertEquals(childDispatches, 0, "nested nodes are not independent credential intake");
          if (row.outcome === "accept") {
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
Deno.test("v2 IPEX construction uses parsed bodies directly and byte preparation preserves frozen commitments", async () => {
  const row = fixture.cases[0];
  const [frame] = await parseBytes(b(row.wire));
  {
    const parent = frame.body as SerderKERI;
    const nodes = frame.nests!.map((child) => child.body as SerderACDC);
    const opts = {
      kind: parent.kind,
      message: row.name,
      recipient: parent.sad!.ri as string,
      xid: parent.sad!.x as string,
      stamp: parent.sad!.dt as string,
    };
    const built = ipexExnBody(parent.pre!, parent.route as IpexRoute, nodes, opts);
    assertEquals(built.raw, parent.raw);
    // No frame payload is touched by the ordinary body constructor.
    assertThrows(() => ipexExnBody(parent.pre!, "/ipex/apply", nodes, opts), Error, "Only offer and grant");
    const childWire = await collectPayload(framePayload(frame.nests![0]));
    const [prepared, nested] = await run(() => prepareIpexExn(parent.pre!, "/ipex/grant", childWire, opts));
    assertEquals(prepared.raw, built.raw);
    assertEquals(nested.length > 0, true);
    assertEquals(prepared.gvrsn, Vrsn_2_0);
    const childAgain = await parseBytes(nested);
    {
      assertEquals(childAgain[0].body.raw, nodes[0].raw);
    }
  }
});
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
        xid: reference.body.said!,
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
        const children = body === offer || body === grant ? [node] : [];
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
      assertEquals(Array.from(Deno.readDirSync(`${left.db.path}/payloads/staging`)).length, 0);
    } finally {
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
    }
  });
});
Deno.test("IPEX presentation proofs bind the grant and freeze its receiver cutoff across observer retry", async () => {
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
    anchor(issuer, ibup);
    for (const event of [irip, ibup]) assertEquals(observer.processEvent(event).kind, "accept");
    const grant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
      kind: Kinds.json,
      message: "presentation",
      recipient: issuee.pre,
      xid: credential.said!,
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
      assertEquals(hby.db.exns.get([grant.said!]), null);
      now += 1000;
      yield* store.baser.reopen();
      yield* hby.db.reopen();
      for (const event of [prip, pbup]) assertEquals(observer.processEvent(event).kind, "accept");
      // A newer accepted update must not rewrite the already observed grant cutoff.
      const vacant = makeBlindState({ sn: 2 });
      const vacantTime = makeNowIso8601(new Date(now));
      const vacuous = blindate(prip.said!, pbup.said!, vacant.d.nonce, { sn: 2, stamp: vacantTime });
      anchor(issuee, vacuous);
      assertEquals(observer.processEvent(vacuous).kind, "accept");
      now += 1000;
      const newer = makeBlindState({ acdc: credential.said!, state: "revoked", sn: 3 });
      const latest = blindate(prip.said!, vacuous.said!, newer.d.nonce, {
        sn: 3,
        stamp: makeNowIso8601(new Date(now)),
      });
      anchor(issuee, latest);
      assertEquals(observer.processEvent(latest).kind, "accept");
      yield* runtime.exc.processEscrows();
      assertExists(hby.db.exns.get([grant.said!]));
      assertEquals(hby.db.exchangeMeta.get([grant.said!])?.receiverTime, receipt);
      assertEquals(hby.db.exns.get([credential.said!]), null, "parent acceptance never dispatches its child");
      const handler = new IpexV2Handler("/ipex/grant", hby, null, store);
      const verify = (nest: CesrFrame = child, cutoff: string | undefined = receipt, body = grant) =>
        handler.verify({
          serder: body,
          nests: [nest],
          attachments: [],
          evidence: { tsgs: [], cigars: [], sourceSeals: [] },
          receiverTime: cutoff,
        });
      assertEquals(verify(), true, "Issuee presentation proof alone satisfies permitted ax anchoring");
      assertEquals(
        handler.verify({ serder: grant, nests: [child], attachments: [] }),
        false,
        "no sender-time fallback",
      );
      assertEquals(verify(child, receipt.replace("123000", "122999")), false, "one microsecond before binding");
      assertEquals(verify(child, makeNowIso8601(new Date(now))), false, "later time cannot use the old disclosure");
      const continued = yield* node([iblind, pblind, vacant]);
      {
        assertEquals(
          verify(continued, vacantTime),
          true,
          "one authentic vacuous disclosure preserves the preceding binding",
        );
      }
      const otherGrant = ipexExnBody(sender.pre, "/ipex/grant", [credential], {
        kind: Kinds.json,
        message: "other target",
        recipient: issuee.pre,
        xid: credential.said!,
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
        assertEquals(verify(noIssuer), false, "parent and Issuee proofs cannot replace the child's issuer proof");
        assertEquals(verify(duplicate), false, "exactly one disclosure must match each selected BLID");
      }
      for (const sn of [99n, 9007199254740993n]) {
        const unavailable = yield* node([iblind, pblind], [{ ...source, s: NumberPrimitive.fromNum(sn) }]);
        {
          assertEquals((verify(unavailable) as { kind: string }).kind, "escrow");
        }
      }
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
        xid: credential.said!,
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
          () => handler.verify({ serder: body, nests: [node], attachments: [] }),
          Error,
          "missing sequence entry",
        );
        registry.seqEvent = (regid, sn) =>
          sn
            ? blindate(rip.said!, issued.said!, disclosure.d.nonce)
            : seqEvent.call(registry, regid, sn);
        assertThrows(
          () => handler.verify({ serder: body, nests: [node], attachments: [] }),
          Error,
          "sequence is inconsistent",
        );
        registry.seqEvent = () => {
          throw new Error("registry read unavailable");
        };
        assertThrows(
          () => handler.verify({ serder: body, nests: [node], attachments: [] }),
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
        xid: credential.said!,
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
        "reject",
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

Deno.test("714 IPEX schema gates preserve issuer-first grants and validate every edge pin", async () => {
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
        xid: schema.said,
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
      assertEquals((yield* exchanger.processEvent(unsigned)).kind, "reject");
      assertEquals(
        hby.db.emse!.get([unsigned.serder.said!, schema.said]),
        null,
        "issuer proof precedes schema dependency",
      );
      const grant = args("/ipex/grant", [valid]);
      assertEquals((yield* exchanger.processEvent(grant)).kind, "escrow");
      assertExists(hby.db.emse!.get([grant.serder.said!, schema.said]));
      hby.db.schema.pin(schema.said, schema);
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(offer.serder.said!));
      assertExists(hby.db.exns.get(grant.serder.said!));
      for (const verb of ["/ipex/offer", "/ipex/grant"] as const) {
        const rejected = args(verb, [invalid], verb === "/ipex/grant");
        assertEquals((yield* exchanger.processEvent(rejected)).kind, "reject");
        assertEquals(hby.db.exns.get(rejected.serder.said!), null);
      }
      // Same-schema pins still evaluate the far credential; equality of IDs proves no payload constraint.
      const near = (far: SerderACDC, pin: string | MapperMap) =>
        credential("Near", { d: "", link: { n: far.said, s: pin } });
      const graph = (far: SerderACDC, pin: string | MapperMap) => {
        const root = near(far, pin);
        return walkIpexGraph(root.said!, [node(root), node(far)], true)!;
      };
      assertEquals(verifyIpexRelations(graph(valid, schema.said), hby.db), true);
      assertEquals(verifyIpexRelations(graph(invalid, schema.said), hby.db), false);
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
      assertEquals(
        verifyIpexRelations(walkIpexGraph(alternative.said!, [node(alternative), node(valid)], true)!, hby.db),
        true,
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
      const inheritedGraph = walkIpexGraph(inherited.said!, [node(inherited), node(valid)], true)!;
      assertEquals(verifyIpexRelations(inheritedGraph, hby.db), { kind: "missing", said: edgeSchema.said });
      const edgeGrant = args("/ipex/grant", [near(valid, edgeSchema.said), valid]);
      assertEquals((yield* exchanger.processEvent(edgeGrant)).kind, "escrow");
      assertExists(hby.db.emse!.get([edgeGrant.serder.said!, edgeSchema.said]));
      hby.db.schema.pin(edgeSchema.said, edgeSchema);
      yield* exchanger.processEscrows();
      assertExists(hby.db.exns.get(edgeGrant.serder.said!));
      assertEquals(verifyIpexRelations(inheritedGraph, hby.db), true);
      assertEquals(verifyIpexRelations(graph(valid, edgeSchema.sed as MapperMap), hby.db), true);
      assertEquals(verifyIpexRelations(graph(credential("Other"), edgeSchema.said), hby.db), false);
      // A real schema read failure propagates; it is never downgraded to missing-schema escrow.
      const get = hby.db.schema.get.bind(hby.db.schema);
      hby.db.schema.get = () => {
        throw new Error("schema storage unavailable");
      };
      try {
        assertThrows(() => verifyIpexRelations(graph(valid, edgeSchema.said), hby.db), Error, "storage unavailable");
      } finally {
        hby.db.schema.get = get;
      }
      assertEquals(hby.db.exns.get(valid.said!), null, "conversation acceptance does not accept a credential");
    } finally {
      yield* hby.close(true);
    }
  });
});
