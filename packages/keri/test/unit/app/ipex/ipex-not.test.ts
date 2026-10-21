/** Negation uses authenticated node facts; unknown or malformed evidence never becomes true. */
import {
  b,
  type CesrFrame,
  concatBytes,
  Counter,
  Diger,
  makeBlindState,
  type MapperMap,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SerderACDC,
  Vrsn_2_0,
} from "cesr-ts";
import { ensure, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../../src/acdc/observing.ts";
import { openRegistry, RegistryStore } from "../../../../src/acdc/registering.ts";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import {
  acceptedEventReplayMessage,
  createHabery,
  type Hab,
  type Habery,
} from "../../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import { walkIpexGraph } from "../../../../src/app/ipex/ipex-graph.ts";
import { loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { loadNests } from "../../../../src/db/exchange-nests.ts";

/** Introduce public evidence through the ordinary remote verifier, never accepted-row writes. */
function* learn(receiver: Habery, wire: Uint8Array): Operation<void> {
  for (const frame of parseBytes(wire)) {
    yield* dispatchEnvelope(envelopeFromFrame(frame), receiver.rvy, receiver.kevery);
  }
}

/** Sign using the actual issuer's establishment event, including after later interactions. */
function proof(body: SerderACDC | ReturnType<typeof ipexExnBody>, hab: Hab) {
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
    new Diger({ qb64: hab.kever!.lastEst.d }),
    hab.sign(body.raw, true),
  );
}
function signed(body: SerderACDC, hab: Hab): CesrFrame {
  return { body, attachments: messageAttachmentGroups({ tsgs: [proof(body, hab)] }, Vrsn_2_0), gvrsn: Vrsn_2_0 };
}

/** Independent producer/receiver stores; the receiver has no private issuer habitats. */
function* peers() {
  const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  yield* ensure(() => source.close(true));
  const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  yield* ensure(() => receiver.close(true));
  const store = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
  yield* ensure(() => store.close(true));
  const near = source.makeHab("near"),
    far = source.makeHab("far"),
    tail = source.makeHab("tail"),
    sender = source.makeHab("sender");
  const recipient = receiver.makeHab("recipient");
  for (const hab of [near, far, tail, sender]) {
    yield* learn(receiver, acceptedEventReplayMessage(source, hab.pre, 0).message);
    assertEquals(receiver.habs.has(hab.pre), false);
  }
  const registry = new RegistryStore(store);
  const observer = new RegistryObserver(receiver.db, registry);
  const exchanger = new Exchanger(receiver);
  loadIpexHandlers(receiver, exchanger, { registry });
  // These focused graphs use a single link at each depth; broader branching has separate cases.
  const grant = (nodes: CesrFrame[], paths?: readonly string[]) => {
    const bodies = nodes.map((node) => node.body as SerderACDC);
    const serder = ipexExnBody(sender.pre, "/ipex/grant", bodies, {
      recipient: recipient.pre,
      xid: bodies[0].said!,
      message: crypto.randomUUID(),
      plan: bodies.map((body, i) => [
        (body.schema as { $id: string }).$id ?? body.schema as string,
        paths?.[i] ?? (i ? `/e/link/_/${"e/link/_/".repeat(i - 1)}` : "/"),
        [""],
      ]),
    });
    return { serder, tsgs: [proof(serder, sender)], nests: nodes };
  };
  return { source, receiver, near, far, tail, sender, store, registry, observer, exchanger, grant };
}

/** Each negated root still declares its independent identity/schema constraints. */
function root(hab: Hab, far: SerderACDC, o: string | string[] = ["NOT", "NI2I"], extra: MapperMap = {}) {
  return acdcmap(hab.pre, { attribute: { d: "", name: "root" }, edge: { d: "", link: { n: far.said, o, ...extra } } });
}

for (const negated of [false, true]) {
  Deno.test(`NOT evaluates an authenticated valid far leaf: negated=${negated}`, async () => {
    await run(function*() {
      const p = yield* peers();
      const far = acdcmap(p.far.pre, { attribute: { d: "", name: "valid" } });
      const near = root(p.near, far, negated ? ["NOT", "NI2I"] : "NI2I");
      const args = p.grant([signed(near, p.near), signed(far, p.far)]);
      assertEquals((yield* p.exchanger.processEvent(args)).kind, negated ? "reject" : "accept");
      assertEquals(p.receiver.db.exns.get(args.serder.said!) !== null, !negated);
      assertEquals(p.receiver.db.exns.get(far.said!), null, "parent acceptance never publishes the child");
    });
  });
}

for (const negated of [false, true]) {
  Deno.test(`NOT evaluates a proved false far relationship: negated=${negated}`, async () => {
    await run(function*() {
      const p = yield* peers();
      const tail = acdcmap(p.tail.pre, { issuee: p.near.pre, attribute: { d: "", name: "tail" } });
      const far = acdcmap(p.far.pre, {
        attribute: { d: "", name: "invalid relation" },
        edge: { d: "", link: { n: tail.said, o: "I2I" } },
      });
      const near = root(p.near, far, negated ? ["NOT", "NI2I"] : "NI2I");
      const args = p.grant([signed(near, p.near), signed(far, p.far), signed(tail, p.tail)]);
      assertEquals((yield* p.exchanger.processEvent(args)).kind, negated ? "accept" : "reject");
      assertEquals(p.receiver.db.exns.get(args.serder.said!) !== null, negated);
      if (negated) {
        yield* p.receiver.db.reopen();
        assertExists(p.receiver.db.exns.get(args.serder.said!));
        assertEquals((yield* p.exchanger.processEvent(args)).kind, "accept");
        assertEquals(p.receiver.db.exns.get(args.serder.said!)!.raw, args.serder.raw);
        assertEquals(loadNests(p.receiver.db, args.serder.said!).map((frame) => frame.body.said), [
          near.said,
          far.said,
          tail.said,
        ]);
      }
    });
  });
}

Deno.test("NOT does not invert a missing node, missing proof or foreign signature", async () => {
  await run(function*() {
    const p = yield* peers();
    const tail = acdcmap(p.tail.pre, { issuee: p.near.pre, attribute: { d: "", name: "tail" } });
    const far = acdcmap(p.far.pre, {
      attribute: { d: "", name: "far" },
      edge: { d: "", link: { n: tail.said, o: "I2I" } },
    });
    const near = root(p.near, far);
    for (const bad of [null, { ...signed(tail, p.tail), attachments: [] }, signed(tail, p.far)]) {
      const args = p.grant([signed(near, p.near), signed(far, p.far), ...(bad ? [bad] : [])]);
      assertEquals((yield* p.exchanger.processEvent(args)).kind, "reject");
      assertEquals(p.receiver.db.exns.get(args.serder.said!), null);
    }
    assertEquals(
      (yield* p.exchanger.processEvent(p.grant([signed(near, p.near), signed(far, p.far), signed(tail, p.tail)]))).kind,
      "accept",
    );
  });
});

Deno.test("NOT retains a missing issuer dependency until actual KEL intake closes it", async () => {
  await run(function*() {
    const p = yield* peers(), unknown = p.source.makeHab("unknown");
    const tail = acdcmap(p.tail.pre, { issuee: p.near.pre, attribute: { d: "", name: "tail" } });
    const far = acdcmap(unknown.pre, {
      attribute: { d: "", name: "far" },
      edge: { d: "", link: { n: tail.said, o: "I2I" } },
    });
    const near = root(p.near, far);
    const args = p.grant([signed(near, p.near), signed(far, unknown), signed(tail, p.tail)]);
    assertEquals((yield* p.exchanger.processEvent(args)).kind, "escrow");
    assertExists(p.receiver.db.epse.get(args.serder.said!));
    yield* p.receiver.db.reopen();
    yield* p.exchanger.processEscrows();
    assertEquals(p.receiver.db.exns.get(args.serder.said!), null);
    yield* learn(p.receiver, acceptedEventReplayMessage(p.source, unknown.pre, 0).message);
    yield* p.exchanger.processEscrows();
    assertExists(p.receiver.db.exns.get(args.serder.said!));
    assertEquals(p.receiver.db.epse.get(args.serder.said!), null);
  });
});

for (const op of [["NOT", "I2I"], ["NOT", "NI2I"], ["NOT", "E1E"]]) {
  Deno.test(`NOT preserves independent identity policy: ${op.join("+")}`, async () => {
    await run(function*() {
      const p = yield* peers();
      const tail = acdcmap(p.tail.pre, { issuee: p.near.pre, attribute: { d: "", name: "tail" } });
      for (const match of [false, true]) {
        const issuee = match ? p.near.pre : p.tail.pre;
        const far = acdcmap(p.far.pre, {
          issuee,
          attribute: { d: "", name: "far" },
          edge: { d: "", link: { n: tail.said, o: "I2I" } },
        });
        const near = acdcmap(p.near.pre, {
          issuee: p.near.pre,
          attribute: { d: "", name: "near" },
          edge: { d: "", link: { n: far.said, o: op } },
        });
        const args = p.grant([signed(near, p.near), signed(far, p.far), signed(tail, p.tail)]);
        assertEquals((yield* p.exchanger.processEvent(args)).kind, match || op.includes("NI2I") ? "accept" : "reject");
      }
    });
  });
}

Deno.test("NOT never hides malformed edge/schema evidence behind a false relation", async () => {
  await run(function*() {
    const p = yield* peers();
    const tail = acdcmap(p.tail.pre, { issuee: p.near.pre, attribute: { d: "", name: "tail" } });
    const invalidSchema = new Schemer({ sed: { $id: "", version: "1.0.0", type: "string", pattern: "[" } });
    const malformed: MapperMap[] = [{ o: "UNKNOWN" }, { s: false }, { s: invalidSchema.sed as MapperMap }];
    for (const bad of malformed) {
      const far = acdcmap(p.far.pre, {
        attribute: { d: "", name: "far" },
        edge: { d: "", link: { n: tail.said, o: "I2I" }, bad: { n: tail.said, ...bad } },
      });
      const args = p.grant([signed(root(p.near, far), p.near), signed(far, p.far), signed(tail, p.tail)]);
      assertEquals((yield* p.exchanger.processEvent(args)).kind, "reject");
      assertEquals(p.receiver.db.exns.get(args.serder.said!), null);
    }
  });
});

for (const group of ["AND", "OR"]) {
  Deno.test(`NOT composes far-node truth through nested ${group} groups`, async () => {
    await run(function*() {
      const p = yield* peers();
      const tail = acdcmap(p.tail.pre, { attribute: { d: "", name: "valid leaf" } });
      const far = root(p.far, tail); // NOT(valid) is false.
      const near = acdcmap(p.near.pre, {
        attribute: { d: "", name: "root" },
        edge: {
          d: "",
          o: "AND",
          nested: {
            o: group,
            link: { n: far.said, o: ["NOT", "NI2I"] }, // NOT(false) is true.
            other: { n: far.said, o: "NI2I" },
          },
        },
      });
      // First graph path names the nested group; disclosure order remains independent of truth.
      const args = p.grant([signed(near, p.near), signed(far, p.far), signed(tail, p.tail)], [
        "/",
        "/e/nested/link/_/",
        "/e/nested/link/_/e/link/_/",
      ]);
      assertEquals(
        (yield* p.exchanger.processEvent(args)).kind,
        group === "OR" ? "accept" : "reject",
      );
    });
  });
}

Deno.test("NOT rechecks missing edge schemas and cannot invert a failing own-node schema", async () => {
  await run(function*() {
    const p = yield* peers();
    const schema = new Schemer({
      sed: {
        $id: "",
        version: "1.0.0",
        type: "object",
        properties: { a: { properties: { name: { const: "expected" } } } },
      },
    });
    const tail = acdcmap(p.tail.pre, { attribute: { d: "", name: "other" } });
    const far = acdcmap(p.far.pre, {
      attribute: { d: "", name: "far" },
      edge: { d: "", link: { n: tail.said, o: "NI2I", s: schema.said } },
    });
    const args = p.grant([signed(root(p.near, far), p.near), signed(far, p.far), signed(tail, p.tail)]);
    assertEquals((yield* p.exchanger.processEvent(args)).kind, "escrow");
    assertExists(p.receiver.db.emse!.get([args.serder.said!, schema.said]));
    p.receiver.db.schema.pin(schema.said, schema);
    yield* p.exchanger.processEscrows();
    assertExists(
      p.receiver.db.exns.get(args.serder.said!),
      "a valid edge schema can disprove its far payload constraint",
    );
    const extra = p.grant([
      signed(root(p.near, far, ["NOT", "NI2I"], { s: schema.said }), p.near),
      signed(far, p.far),
      signed(tail, p.tail),
    ]);
    assertEquals(
      (yield* p.exchanger.processEvent(extra)).kind,
      "reject",
      "NOT does not invert the near edge schema constraint",
    );
    const invalid = acdcmap(p.far.pre, { schema: schema.said, attribute: { d: "", name: "other" } });
    const own = p.grant([signed(root(p.near, invalid), p.near), signed(invalid, p.far)]);
    assertEquals(
      (yield* p.exchanger.processEvent(own)).kind,
      "reject",
      "every own schema is an admission prerequisite",
    );
  });
});

Deno.test("NOT uses current accepted issued/revoked facts on fresh validation, never stale or custom state", async () => {
  await run(function*() {
    const p = yield* peers();
    const rip = regcept(p.far.pre);
    const far = acdcmap(p.far.pre, { regid: rip.said!, attribute: { d: "", name: "registered" } });
    const near = root(p.near, far), positive = root(p.near, far, "NI2I");
    let prior = rip.said!;
    yield* learn(p.receiver, p.far.interact({ data: [{ i: rip.said!, s: rip.sad!.n, d: rip.said! }] }));
    let previous: CesrFrame | undefined;
    let accepted: string | undefined;
    const pending: ReturnType<typeof p.grant>[] = [];
    for (const [i, state] of ["issued", "revoked", "issued", "custom"].entries()) {
      const blinder = makeBlindState({ acdc: far.said!, state, sn: BigInt(i + 1), raw: b("0123456789abcdef") });
      const event = blindate(rip.said!, prior, blinder.d.nonce, { sn: i + 1 });
      const attachment = Counter.enclose({
        code: "BlindedStateQuadruples",
        version: Vrsn_2_0,
        qb64: concatBytes(blinder.d.qb64b, blinder.u.qb64b, blinder.td.qb64b, blinder.ts.qb64b),
      });
      const node = parseBytes(messagize(far, attachment, { gvrsn: Vrsn_2_0 }))[0];
      if (!i) {
        for (const origin of [positive, near]) {
          const args = p.grant([signed(origin, p.near), node]);
          assertEquals((yield* p.exchanger.processEvent(args)).kind, "escrow");
          pending.push(args);
        }
        yield* p.store.reopen();
        yield* p.receiver.db.reopen();
        yield* p.exchanger.processEscrows();
        for (const args of pending) {
          assertEquals(p.receiver.db.exns.get(args.serder.said!), null, "anchored KEL alone is not observer intake");
        }
        assertEquals(p.observer.processEvent(rip).kind, "accept");
      }
      yield* learn(p.receiver, p.far.interact({ data: [{ i: rip.said!, s: event.sad!.n, d: event.said! }] }));
      assertEquals(p.observer.processEvent(event).kind, "accept");
      if (!i) {
        yield* p.exchanger.processEscrows();
        assertExists(p.receiver.db.exns.get(pending[0].serder.said!));
        assertEquals(
          p.receiver.db.exns.get(pending[1].serder.said!),
          null,
          "issued evidence cannot satisfy pending NOT",
        );
        assertEquals(p.receiver.db.epse.get(pending[1].serder.said!), null);
      }
      if (previous) {
        const stale = p.grant([signed(near, p.near), previous]);
        assertEquals(
          (yield* p.exchanger.processEvent(stale)).kind,
          "reject",
          "obsolete disclosure cannot prove invalidity",
        );
      }
      for (const [rootNode, expected] of [[near, state === "revoked"], [positive, state === "issued"]] as const) {
        const args = p.grant([signed(rootNode, p.near), node]);
        assertEquals(
          (yield* p.exchanger.processEvent(args)).kind,
          expected ? "accept" : "reject",
          `${state}: ${rootNode === near ? "NOT" : "ordinary"}`,
        );
        if (expected && rootNode === near) accepted = args.serder.said!;
      }
      if (accepted) {
        assertExists(
          p.receiver.db.exns.get(accepted),
          "a later state does not rewrite historical conversation acceptance",
        );
      }
      previous = node;
      prior = event.said!;
    }
  });
});

Deno.test("IPEX graph dependency order handles shared cross-links independently of disclosure order", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer");
    const tail = acdcmap(issuer.pre, { attribute: { d: "", name: "tail" } });
    const left = acdcmap(issuer.pre, {
      attribute: { d: "", name: "left" },
      edge: { d: "", link: { n: tail.said, o: "NI2I" } },
    });
    const right = acdcmap(issuer.pre, {
      attribute: { d: "", name: "right" },
      edge: { d: "", link: { n: left.said, o: "NI2I" } },
    });
    const root = acdcmap(issuer.pre, {
      attribute: { d: "", name: "root" },
      edge: { d: "", left: { n: left.said, o: "NI2I" }, right: { n: right.said, o: "NI2I" } },
    });
    const graph = walkIpexGraph(
      root.said!,
      [root, left, right, tail].map((body) => ({
        body,
        attachments: [],
        gvrsn: Vrsn_2_0,
      })),
      true,
    );
    assertExists(graph);
    assertEquals(graph.order, [root.said!, left.said!, right.said!, tail.said!]);
    assertEquals(graph.dependencyOrder, [tail.said!, left.said!, right.said!, root.said!]);
  });
});
