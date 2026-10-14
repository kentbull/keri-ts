/** Frozen wire decisions exercise parser, issuer authentication, durable acceptance and replay. */
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
  Kinds,
  type MapperMap,
  makeBlindState,
  MemoryPayloadSink,
  parseBytes,
  Prefixer,
  ResourceLimitError,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { openRegistry, RegistryStore } from "../../../src/acdc/registering.ts";
import { type ExchangeDecision, Exchanger } from "../../../src/app/exchanging.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../src/app/habbing.ts";
import { ipexExnBody, prepareIpexExn } from "../../../src/app/ipex-building.ts";
import { verifyIpexRelations, walkIpexGraph } from "../../../src/app/ipex-graph.ts";
import { IpexV2Handler } from "../../../src/app/ipex-v2.ts";
import { type IpexRoute, loadIpexHandlers } from "../../../src/app/ipexing.ts";
import { Notifier, openNoterForHabery } from "../../../src/app/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import fixture from "../../fixtures/keripy-ipex-vectors.json" with { type: "json" };

/** Feed signed public KEL bytes through normal event verification. */
async function learn(hby: Habery, wire: string | Uint8Array): Promise<void> {
  for (const frame of await parseBytes(typeof wire === "string" ? b(wire) : wire)) {
    try {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery));
    } finally {
      await discardFrame(frame);
    }
  }
}

Deno.test("v2 IPEX matches frozen wire decisions and retains only parent-owned authenticated disclosures", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `ipex-vectors-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(hby);
    const notifier = new Notifier(hby, { noter });
    const exchanger = new Exchanger(hby);
    loadIpexHandlers(hby, exchanger, { notifier });
    try {
      assertEquals(fixture.reference, "927c0cb8794d7c84fc17143c67df64aab9deda6c");
      let through = 0;
      let notifications = 0;
      for (const row of fixture.cases) {
        while (through < row.through) yield* call(() => learn(hby, fixture.wires[through++]));
        const frames = yield* call(() => parseBytes(b(row.wire)));
        try {
          assertEquals(frames.length, 1, row.name);
          let decision: ExchangeDecision | undefined;
          let childDispatches = 0;
          yield* dispatchEnvelope(envelopeFromFrame(frames[0]), hby.rvy, hby.kevery, {
            /** Observe the real Exchanger decision without bypassing runtime normalization. */
            *processEvent(args) {
              decision = yield* exchanger.processEvent(args);
              return decision;
            },
          }, {
            vry: {
              processACDC() {
                childDispatches++;
              },
            },
          });
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
            try {
              assertEquals(restored.length, 1);
              assertEquals(restored[0].body.raw, frames[0].body.raw, row.name);
              assertEquals(
                restored[0].nests?.map((f) => f.body.raw) ?? [],
                frames[0].nests?.map((f) => f.body.raw) ?? [],
                row.name,
              );
              for (const [i, child] of (restored[0].nests ?? []).entries()) {
                const before = yield* call(() => collectPayload(framePayload(frames[0].nests![i]), 8 * 1024 ** 2));
                const after = yield* call(() => collectPayload(framePayload(child), 8 * 1024 ** 2));
                assertEquals(after, before, "replay retains each child's own proof enclosure");
                assertEquals(hby.db.exns.get(child.body.said!), null);
              }
            } finally {
              yield* call(() => Promise.all(restored.map(discardFrame)));
            }
          } else {
            assertEquals(hby.db.exns.get(row.said), null, row.name);
            assertEquals(hby.db.enst.get(row.said), [], row.name);
          }
          assertEquals(notifier.list().length, notifications, row.name);
        } finally {
          yield* call(() => Promise.all(frames.map(discardFrame)));
        }
      }
    } finally {
      yield* noter.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("v2 IPEX construction uses parsed bodies directly and byte preparation preserves frozen commitments", async () => {
  const row = fixture.cases[0];
  const [frame] = await parseBytes(b(row.wire));
  try {
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
    const childWire = await collectPayload(framePayload(frame.nests![0]), 8 * 1024 ** 2);
    const [prepared, nested] = await run(() => prepareIpexExn(parent.pre!, "/ipex/grant", childWire, opts));
    assertEquals(prepared.raw, built.raw);
    assertEquals(nested.length > 0, true);
    assertEquals(prepared.gvrsn, Vrsn_2_0);
    const childAgain = await parseBytes(nested);
    try {
      assertEquals(childAgain[0].body.raw, nodes[0].raw);
    } finally {
      await Promise.all(childAgain.map(discardFrame));
    }
  } finally {
    await discardFrame(frame);
  }
});

Deno.test("nested IPEX between two Haberies retains missing issuer evidence for joined reopen and retry", async () => {
  await run(function*() {
    const left = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const right = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const noter = yield* openNoterForHabery(left);
    const notifier = new Notifier(left, { noter });
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
        const wire = yield* call(() => collectPayload(framePayload(frame), 8 * 1024 ** 2));
        for (const [hby, exn] of [[left, receiving], [right, sending]] as const) {
          const [parsed] = yield* call(() => parseBytes(wire));
          try {
            yield* dispatchEnvelope(envelopeFromFrame(parsed), hby.rvy, hby.kevery, exn);
          } finally {
            yield* call(() => discardFrame(parsed));
          }
          if (body !== grant || hby === right) assertExists(hby.db.exns.get(body.said!));
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
      yield* call(() => discardFrame(reference));
      yield* noter.close(true);
      yield* right.close(true);
      yield* left.close(true);
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
      const limited = new IpexV2Handler("/ipex/grant", hby, null, registry, 1);
      const seqEvent = registry.seqEvent;
      const reads: number[] = [];
      try {
        registry.seqEvent = (regid, sn) => {
          reads.push(sn);
          if (sn > 0) throw new Error("limit must precede update reads");
          return seqEvent.call(registry, regid, sn);
        };
        assertThrows(
          () => limited.verify({ serder: body, nests: [node], attachments: [] }),
          ResourceLimitError,
          "event limit",
        );
        assertEquals(reads, [0]);
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
      assertThrows(() => new IpexV2Handler("/ipex/grant", hby, null, registry, 0), RangeError);
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
      yield* call(() => discardFrame(node));
      yield* source.close(true);
      yield* store.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("IPEX byte preparation cancels its read and joins payload-owner disposal", async () => {
  const [parent] = await parseBytes(b(fixture.cases[0].wire));
  const node = parent.nests![0];
  const sink = new MemoryPayloadSink(8);
  await sink.write(b("4BABYWJj"));
  node.essr = essrPayload(await sink.finish(), 1, 3, Vrsn_2_0);
  const wire = await collectPayload(framePayload(node), 8192);
  const body = parent.body as SerderKERI;
  const options = { kind: body.kind, message: "cancel", recipient: body.sad!.ri as string, xid: body.sad!.x as string };
  await discardFrame(parent);
  const original = MemoryPayloadSink.prototype.finish;
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
  MemoryPayloadSink.prototype.finish = async function() {
    const owner = await original.call(this);
    return {
      size: owner.size,
      /** Stop the real parser-owned payload read at the cancellation boundary. */
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
      /** Cleanup must follow the joined reader, never race it. */
      async discard() {
        assertEquals(closed, true);
        discarded++;
        await owner.discard();
      },
    };
  };
  const task = run(function*() {
    yield* prepareIpexExn(body.pre!, "/ipex/grant", wire, options);
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
  } finally {
    release();
    await task.halt();
    MemoryPayloadSink.prototype.finish = original;
  }
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
        bad: { n: valid.said, s: false },
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
