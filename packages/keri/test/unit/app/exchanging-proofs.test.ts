/** Route-selected EXN proofs remain independent, historical, and verifiable after durable replay. */
import {
  Cigar,
  concatBytes,
  Diger,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SealEvent,
  type SerderKERI,
  Siger,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { Exchanger, type ExchangeRouteHandler } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { TransIdxSigGroup, TransLastIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { serializeMessage } from "../../../src/core/protocol-serialization.ts";

/** Scope real stores and independently controlled transferable/nontransferable signers. */
async function parties(check: (hby: Habery, alice: Hab, bob: Hab, carol: Hab) => Promise<void>): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: `exchange-proofs-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      yield* call(() =>
        check(hby, hby.makeHab("alice"), hby.makeHab("bob"), hby.makeHab("carol", undefined, { transferable: false }))
      );
    } finally {
      yield* hby.close(true);
    }
  });
}

/** Explicit historical signature coordinates, unaffected by a later key rotation. */
function endorse(hab: Hab, serder: SerderKERI): TransIdxSigGroup {
  const est = hab.db.getEvtSerder(hab.pre, hab.kever!.lastEst.d)!;
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    est.sner!,
    new Diger({ qb64: est.said! }),
    hab.sign(serder.raw, true),
  );
}

/** A source seal may anchor a body in an interaction event, independently of signatures. */
function anchor(hab: Hab, serder: SerderKERI): SealEvent {
  hab.interact({ data: [{ d: serder.said }] });
  return {
    i: new Prefixer({ qb64: hab.pre }),
    s: NumberPrimitive.fromNum(BigInt(hab.kever!.serder.sn!)),
    d: new Diger({ qb64: hab.kever!.said }),
  };
}

/** Collect only these small test messages to inspect the actual replay serializer. */
async function replay(exchanger: Exchanger, said: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of exchanger.replay(said)) chunks.push(chunk);
  return concatBytes(...chunks);
}

Deno.test("EXN sender interaction seals authenticate independently and survive parser storage and replay", async () => {
  await parties(async (hby, alice) => {
    const serder = exchange("/proof", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const seal = anchor(alice, serder);
    const good = endorse(alice, serder);
    const bad = new TransIdxSigGroup(good.prefixer, good.seqner, good.diger, [
      new Siger({ raw: new Uint8Array(64), code: "A", index: 0 }),
    ]);
    let sealed = 0;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/proof",
        acceptsSscs: true,
        /** An accepted source coordinate must reach the owning workflow. */
        verify({ sscs }) {
          assertEquals(sscs?.[0].d.qb64, seal.d.qb64);
          return true;
        },
        /** Count only durable delivery. */
        handle() {
          sealed++;
        },
      }],
    });
    const wire = serializeMessage(serder, { tsgs: [bad], sourceSeals: [seal], gvrsn: Vrsn_2_0, genusify: true });
    for (const frame of await parseBytes(wire)) {
      await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery, exchanger));
    }
    assertEquals(sealed, 1);
    assertEquals(hby.db.esigs.getTopItemIter([serder.said!, ""]).next().done, true);
    assertEquals(hby.db.ests.get([serder.said!, alice.pre])[0][1].qb64, seal.d.qb64);
    await run(() => hby.db.reopen());
    const [frame] = await parseBytes(await replay(exchanger, serder.said!));
    const restored = envelopeFromFrame(frame);
    assertEquals(restored.tsgs.length, 0);
    assertEquals(restored.ssts[0].s.num, seal.s.num);
    assertEquals(restored.ssts[0].i.qb64, alice.pre);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, sscs: [{ s: seal.s, d: seal.d }] }))).kind,
      "accept",
    );
    assertEquals(sealed, 2);
  });
});

Deno.test("EXN missing sender anchors retain cigars and freeze foreign last groups before reopen retry", async () => {
  await parties(async (hby, alice, bob, carol) => {
    const serder = exchange("/proof", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const seal = anchor(alice, serder);
    const event = hby.db.getEvtSerder(alice.pre, seal.d.qb64)!;
    const bobEst = bob.kever!.lastEst.d;
    const lsg = new TransLastIdxSigGroup(new Prefixer({ qb64: bob.pre }), bob.sign(serder.raw, true));
    const cigar = carol.sign(serder.raw, false)[0];
    const handler: ExchangeRouteHandler = {
      resource: "/proof",
      acceptsSscs: true,
      /** Strict routes retain every valid factor and reject invalid supplemental evidence. */
      verifyEvidence({ factors, invalid }) {
        return invalid ? null : factors;
      },
      /** Authentication alone is enough for this proof-boundary fixture. */
      handle() {},
    };
    const exchanger = new Exchanger(hby, { handlers: [handler] });
    hby.db.evts.rem([alice.pre, seal.d.qb64]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, sourceSeals: [seal], lsgs: [lsg], cigars: [cigar] }))).kind,
      "escrow",
    );
    assertEquals(hby.db.ecigs.get([serder.said!]).length, 1);
    assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])][0][0][3], bobEst);
    bob.rotate();
    await run(() => hby.db.reopen());
    hby.db.evts.pin([alice.pre, seal.d.qb64], event);
    await run(() => exchanger.processEscrows());
    assertEquals(exchanger.complete(serder.said!), true);
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals(hby.db.eidx.get([bob.pre])[0].qb64, serder.said);
    assertEquals(hby.db.eidx.get([carol.pre])[0].qb64, serder.said);
    assertEquals(hby.db.eidx.get([alice.pre]), []);
    const [frame] = await parseBytes(await replay(exchanger, serder.said!));
    const restored = envelopeFromFrame(frame);
    assertEquals(restored.tsgs[0].said, bobEst);
    assertEquals(restored.cigars[0].verfer?.qb64, carol.pre);
    assertEquals(restored.ssts[0].i.qb64, alice.pre);
  });
});

Deno.test("EXN route dependency escrow preserves proofs while optional extras require explicit policy", async () => {
  await parties(async (hby, alice, bob) => {
    const serder = exchange("/proof", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const sender = endorse(alice, serder);
    const missing = endorse(bob, serder);
    hby.db.evts.rem([bob.pre, missing.said]);
    let ready = false;
    let handled = 0;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/proof",
        acceptsMissingEvidence: true,
        /** Model grant's explicit ability to query and omit unresolved optional factors. */
        verifyEvidence({ factors, invalid }) {
          return factors;
        },
        /** Credential evidence absence is an expected pending decision, never acceptance. */
        verify() {
          return ready ? true : { kind: "escrow", reason: "TEL history unavailable" };
        },
        /** Count only durable verified delivery. */
        handle() {
          handled++;
        },
      }],
    });
    assertEquals((await run(() => exchanger.processEvent({ serder, tsgs: [sender, missing] }))).kind, "escrow");
    assertEquals(handled, 0);
    assertEquals(exchanger.complete(serder.said!), false);
    assertExists(hby.db.epse.get([serder.said!]));
    assertEquals(hby.db.eidx.get([bob.pre]), []);
    assertEquals(exchanger.cues.toArray().some((cue) => cue.kin === "proof"), true);
    exchanger.cues.clear();
    await run(() => exchanger.processEscrows());
    assertEquals(exchanger.cues.toArray(), []); // An existing dependency escrow emits no new proof cue.
    ready = true;
    await run(() => hby.db.reopen());
    await run(() => exchanger.processEscrows());
    assertEquals(exchanger.complete(serder.said!), true);
    assertEquals(handled, 1);
    assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])].length, 1);
    const strict = new Exchanger(hby);
    const other = exchange("/strict", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    assertEquals(
      (await run(() => strict.processEvent({ serder: other, tsgs: [endorse(alice, other), missing] }))).kind,
      "reject",
    );
  });
});

Deno.test("EXN replay rechecks every stored factor and nontransferable verifier context", async () => {
  await parties(async (hby, alice, bob, carol) => {
    const serder = exchange("/proof", {}, { sender: carol.pre, pvrsn: Vrsn_2_0 })[0];
    const exchanger = new Exchanger(hby);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, cigars: carol.sign(serder.raw, false) }))).kind,
      "accept",
    );
    await run(() => hby.db.reopen());
    const [frame] = await parseBytes(await replay(exchanger, serder.said!));
    assertEquals(envelopeFromFrame(frame).cigars[0].verfer?.qb64, carol.pre);
    // A corrupted supplemental proof must not hide behind a valid stored sender cigar.
    const bad = endorse(bob, serder);
    hby.db.esigs.add(
      [serder.said!, bob.pre, bad.snh, bad.said],
      new Siger({ raw: new Uint8Array(64), code: "A", index: 0 }),
    );
    await assertRejects(() => replay(exchanger, serder.said!), Error, "stored exchange authentication");
    const other = exchange("/proof", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const transferableCigar = new Cigar({ code: "0B", raw: new Uint8Array(64) }, alice.kever!.verfers[0]);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder: other, cigars: [transferableCigar] }))).kind,
      "reject",
    );
  });
});

Deno.test("EXN source proofs preserve the legacy intake guard and reject mismatched establishment claims", async () => {
  await parties(async (hby, alice) => {
    const exchanger = new Exchanger(hby);
    for (const pvrsn of [Vrsn_1_0, Vrsn_2_0]) {
      const serder = exchange("/proof", {}, { sender: alice.pre, pvrsn })[0];
      const seal = anchor(alice, serder);
      const wire = serializeMessage(serder, { sourceSeals: [seal], gvrsn: pvrsn, genusify: true });
      const [frame] = await parseBytes(wire);
      await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery, exchanger));
      // Frozen v1 parser requires signatures; v2 processMsg supports source-only authentication.
      assertEquals(exchanger.complete(serder.said!), pvrsn.major === 2);
    }
    const serder = exchange("/proof", { m: "different body" }, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const group = endorse(alice, serder);
    const unbound = {
      i: new Prefixer({ qb64: alice.pre }),
      s: NumberPrimitive.fromNum(BigInt(alice.kever!.serder.sn!)),
      d: new Diger({ qb64: alice.kever!.said }),
    };
    const forged = new TransIdxSigGroup(group.prefixer, group.seqner, unbound.d, group.sigers);
    assertEquals((await run(() => exchanger.processEvent({ serder, tsgs: [forged] }))).kind, "reject");
    // A valid signature can authenticate a body; an unrelated seal must never be retained as its proof.
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: [group], sourceSeals: [unbound] }))).kind,
      "accept",
    );
    assertEquals(hby.db.ests.get([serder.said!, alice.pre]), []);
  });
});

/** Rejection must leave neither accepted nor partial authentication rows behind. */
function assertUnstored(hby: Habery, said: string): void {
  assertEquals(hby.db.exns.get([said]), null);
  assertEquals(hby.db.epse.get([said]), null);
  assertEquals(hby.db.epsd.get([said]), null);
  assertEquals([...hby.db.esigs.getTopItemIter([said, ""])], []);
  assertEquals(hby.db.ecigs.get([said]), []);
  assertEquals([...hby.db.ests.getTopItemIter([said, ""])], []);
  assertEquals(hby.db.epath.get([said]), []);
}

Deno.test("EXN supplemental selection and delivery are independent route capabilities", async () => {
  await parties(async (hby, alice, bob) => {
    for (const [select, deliver] of [[false, false], [true, false], [false, true], [true, true]]) {
      const serder = exchange("/proof", { select, deliver }, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
      const extra = endorse(bob, serder);
      let selections = 0;
      let verifications = 0;
      let handled = 0;
      const handler: ExchangeRouteHandler = {
        resource: "/proof",
        acceptsEvidence: deliver,
        acceptsSscs: true,
        /** Only the explicit delivery flag changes route verification arguments. */
        verify(args) {
          verifications++;
          assertEquals(Object.hasOwn(args, "evidence"), deliver);
          if (deliver) {
            assertEquals(
              args.evidence?.tsgs.map((
                group,
              ) => [group.pre, group.snh, group.said, group.sigers.map((sig) => sig.qb64)]),
              select ? [[extra.pre, extra.snh, extra.said, extra.sigers.map((sig) => sig.qb64)]] : [],
            );
            assertEquals(args.evidence?.cigars, []);
            assertEquals(args.evidence?.sourceSeals, []);
          }
          assertEquals(Object.hasOwn(args, "sscs"), false);
          return true;
        },
        /** Selected supplemental evidence belongs only to verify, never handle. */
        handle(args) {
          handled++;
          assertEquals(Object.hasOwn(args, "evidence"), false);
          assertEquals(Object.hasOwn(args, "sscs"), false);
        },
      };
      if (select) {
        handler.verifyEvidence = (args) => {
          selections++;
          assertEquals(Object.hasOwn(args, "missing"), false);
          assertEquals(args.invalid, false);
          assertEquals(
            args.factors.tsgs.map((group) => [group.pre, group.snh, group.said, group.sigers.map((sig) => sig.qb64)]),
            [[
              extra.pre,
              extra.snh,
              extra.said,
              extra.sigers.map((sig) => sig.qb64),
            ]],
          );
          return args.factors;
        };
      }
      const exchanger = new Exchanger(hby, { handlers: [handler] });
      const decision = await run(() =>
        exchanger.processEvent({
          serder,
          tsgs: [endorse(alice, serder), ...(select ? [extra] : [])],
        })
      );
      assertEquals(decision.kind, "accept");
      assertEquals([selections, verifications, handled], [Number(select), 1, 1]);
      assertEquals(hby.db.epse.get([serder.said!]), null);
      assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])].length, select ? 2 : 1);
      assertEquals(exchanger.cues.toArray(), []);
    }
  });
});

Deno.test("EXN missing sender seals escrow only for opted routes and deliver validated couples after retry", async () => {
  await parties(async (hby, alice) => {
    for (const acceptsSscs of [false, true]) {
      const serder = exchange("/proof", { acceptsSscs }, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
      const seal = anchor(alice, serder);
      const event = hby.db.getEvtSerder(alice.pre, seal.d.qb64)!;
      const input = { serder, sourceSeals: [seal, seal] };
      let verified = 0;
      let handled = 0;
      const exchanger = new Exchanger(hby, {
        handlers: [{
          resource: "/proof",
          acceptsSscs,
          /** Validated nonempty sender coordinates require explicit delivery permission. */
          verify(args) {
            verified++;
            assertEquals(Object.hasOwn(args, "sscs"), acceptsSscs);
            if (acceptsSscs) assertEquals(args.sscs?.[0].d.qb64, seal.d.qb64);
            return true;
          },
          /** Verify and handle use the same sender-couple capability. */
          handle(args) {
            handled++;
            assertEquals(Object.hasOwn(args, "sscs"), acceptsSscs);
          },
        }],
      });
      hby.db.evts.rem([alice.pre, seal.d.qb64]);
      assertEquals((await run(() => exchanger.processEvent(input))).kind, acceptsSscs ? "escrow" : "reject");
      assertEquals([verified, handled], [0, 0]);
      assertEquals(exchanger.cues.toArray(), [{
        kin: "query",
        pre: alice.pre,
        q: { r: "logs", pre: alice.pre, sn: seal.s.num.toString(16) },
      }]);
      if (acceptsSscs) {
        assertExists(hby.db.epse.get([serder.said!]));
        assertEquals(hby.db.ests.get([serder.said!, alice.pre]).length, 1);
        await run(() => hby.db.reopen());
        hby.db.evts.pin([alice.pre, seal.d.qb64], event);
        await run(() => exchanger.processEscrows());
      } else {
        assertUnstored(hby, serder.said!);
        hby.db.evts.pin([alice.pre, seal.d.qb64], event);
        assertEquals((await run(() => exchanger.processEvent(input))).kind, "accept");
      }
      assertEquals([verified, handled], [1, 1]);
      assertEquals(exchanger.complete(serder.said!), true);
      assertEquals(hby.db.epse.get([serder.said!]), null);
    }
  });
});

Deno.test("EXN strict supplemental state failures query without persistence or route dispatch", async () => {
  await parties(async (hby, alice, bob) => {
    const strict: ExchangeRouteHandler = {
      resource: "/proof",
      /** Missing state must stop before the selection hook. */
      verifyEvidence() {
        throw new Error("Unexpected selection");
      },
      /** Missing state must stop before route verification. */
      verify() {
        throw new Error("Unexpected verification");
      },
      /** Missing state must never publish a handled message. */
      handle() {
        throw new Error("Unexpected handling");
      },
    };
    for (const factor of ["signature", "seal", "last"] as const) {
      const serder = exchange("/proof", { factor }, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
      const group = endorse(bob, serder);
      const seal = anchor(bob, serder);
      const event = hby.db.getEvtSerder(bob.pre, factor === "seal" ? seal.d.qb64 : group.said)!;
      const state = hby.db.states.get([bob.pre])!;
      if (factor === "last") {
        hby.db.kevers.delete(bob.pre);
        hby.db.states.rem([bob.pre]);
      } else hby.db.evts.rem([bob.pre, event.said!]);
      const exchanger = new Exchanger(hby, { handlers: [strict] });
      const decision = await run(() =>
        exchanger.processEvent({
          serder,
          tsgs: [endorse(alice, serder), ...(factor === "signature" ? [group] : [])],
          sourceSeals: factor === "seal" ? [seal, seal] : [],
          lsgs: factor === "last" ? [new TransLastIdxSigGroup(group.prefixer, group.sigers)] : [],
        })
      );
      assertEquals(decision.kind, "reject");
      assertUnstored(hby, serder.said!);
      assertEquals(hby.db.eidx.get([bob.pre]), []);
      assertEquals(exchanger.cues.toArray(), [{
        kin: "query",
        pre: bob.pre,
        q: {
          r: "logs",
          pre: bob.pre,
          ...(factor === "last" ? {} : { sn: (factor === "seal" ? seal.s.num : group.sn).toString(16) }),
        },
      }]);
      hby.db.evts.pin([bob.pre, event.said!], event);
      hby.db.states.pin([bob.pre], state);
      if (factor === "last") {
        // KEL recovery cannot reinterpret an unresolved reference from an earlier receipt.
        assertExists(hby.db.getKever(bob.pre));
        exchanger.cues.clear();
        assertEquals(
          (await run(() =>
            exchanger.processEvent({
              serder,
              tsgs: [endorse(alice, serder)],
              unresolvedLast: [group.prefixer],
            })
          )).kind,
          "reject",
        );
        assertUnstored(hby, serder.said!);
        assertEquals(exchanger.cues.toArray(), [{ kin: "query", pre: bob.pre, q: { r: "logs", pre: bob.pre } }]);
      }
    }
  });
});

Deno.test("EXN optional unresolved extras query once and expose missing state only to an opted selector", async () => {
  await parties(async (hby, alice, bob) => {
    const serder = exchange("/proof", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const group = endorse(bob, serder);
    hby.db.kevers.delete(bob.pre);
    hby.db.states.rem([bob.pre]);
    let selected = 0;
    let handled = 0;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/proof",
        acceptsMissingEvidence: true,
        /** Missing metadata stays separate from the independently valid subset. */
        verifyEvidence({ factors, invalid, missing }) {
          selected++;
          assertEquals(factors, { tsgs: [], cigars: [], sourceSeals: [] });
          assertEquals(invalid, false);
          assertEquals(missing, [{ pre: bob.pre, sn: null }, { pre: bob.pre, sn: null }]);
          return factors;
        },
        /** A selector alone must not expose its result to route verification. */
        verify(args) {
          assertEquals(Object.hasOwn(args, "evidence"), false);
          return true;
        },
        /** Only sender authentication is durably accepted in this optional case. */
        handle() {
          handled++;
        },
      }],
    });
    const last = new TransLastIdxSigGroup(group.prefixer, group.sigers);
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: [endorse(alice, serder)], lsgs: [last, last] }))).kind,
      "accept",
    );
    assertEquals([selected, handled], [1, 1]);
    assertEquals(exchanger.cues.toArray(), [{ kin: "query", pre: bob.pre, q: { r: "logs", pre: bob.pre } }]);
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])].length, 1);
    assertEquals(hby.db.eidx.get([bob.pre]), []);
    // Optional unresolved evidence does not require a selection hook either.
    exchanger.routes.get("/proof")!.verifyEvidence = undefined;
    exchanger.cues.clear();
    assertEquals(
      (await run(() => exchanger.processEvent({ serder, tsgs: [endorse(alice, serder)], lsgs: [last] }))).kind,
      "accept",
    );
    assertEquals([selected, handled], [1, 2]);
    assertEquals(exchanger.cues.toArray(), [{ kin: "query", pre: bob.pre, q: { r: "logs", pre: bob.pre } }]);
  });
});

Deno.test("EXN sender query cues follow new escrow rows and incomplete duplicates preserve accepted proofs", async () => {
  await parties(async (hby, alice, bob) => {
    const serder = exchange("/proof", {}, { sender: alice.pre, pvrsn: Vrsn_2_0 })[0];
    const sender = endorse(alice, serder);
    const supplemental = endorse(bob, serder);
    const event = hby.db.getEvtSerder(alice.pre, sender.said)!;
    let ready = true;
    let handled = 0;
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/proof",
        /** Preserve independently verified factors and reject invalid ones. */
        verifyEvidence({ factors, invalid }) {
          return invalid ? null : factors;
        },
        /** Model a route dependency that may be unavailable on a later delivery. */
        verify() {
          return ready ? true : { kind: "escrow", reason: "missing dependency" };
        },
        /** Incomplete duplicate attempts must not run durable handling again. */
        handle() {
          handled++;
        },
      }],
    });
    const input = { serder, tsgs: [sender, supplemental] };
    hby.db.evts.rem([alice.pre, sender.said]);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
    assertEquals(exchanger.cues.toArray(), [{
      kin: "query",
      pre: alice.pre,
      q: { r: "logs", pre: alice.pre, sn: sender.sn.toString(16) },
    }]);
    assertExists(hby.db.epse.get([serder.said!]));
    assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])].length, 2);
    assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])].map(([keys]) => keys[2]), [
      "0".repeat(32),
      "0".repeat(32),
    ]);
    exchanger.cues.clear();
    await run(() => exchanger.processEscrows());
    assertEquals(exchanger.cues.toArray(), []);
    hby.db.evts.pin([alice.pre, sender.said], event);
    const foreignEvent = hby.db.getEvtSerder(bob.pre, supplemental.said)!;
    hby.db.evts.rem([bob.pre, supplemental.said]);
    await run(() => exchanger.processEscrows());
    assertExists(hby.db.epse.get([serder.said!])); // Strict rejection does not create escrow or erase an earlier one.
    assertEquals([...hby.db.esigs.getTopItemIter([serder.said!, ""])].length, 2);
    assertEquals(handled, 0);
    assertEquals(exchanger.cues.toArray(), [{
      kin: "query",
      pre: bob.pre,
      q: { r: "logs", pre: bob.pre, sn: supplemental.sn.toString(16) },
    }]);
    exchanger.cues.clear();
    hby.db.evts.pin([bob.pre, supplemental.said], foreignEvent);
    await run(() => hby.db.reopen());
    await run(() => exchanger.processEscrows());
    assertEquals(handled, 1);
    const accepted = await replay(exchanger, serder.said!);
    const endorsers = hby.db.eidx.get([bob.pre]).map((diger) => diger.qb64);
    ready = false;
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "escrow");
    assertEquals((await run(() => exchanger.processEvent({ serder }))).kind, "escrow");
    hby.db.evts.rem([bob.pre, supplemental.said]);
    assertEquals((await run(() => exchanger.processEvent(input))).kind, "reject");
    hby.db.evts.pin([bob.pre, supplemental.said], foreignEvent);
    assertEquals(exchanger.cues.toArray(), [{
      kin: "query",
      pre: bob.pre,
      q: { r: "logs", pre: bob.pre, sn: supplemental.sn.toString(16) },
    }]);
    assertEquals(handled, 1);
    assertEquals(exchanger.complete(serder.said!), true);
    assertEquals(hby.db.epse.get([serder.said!]), null);
    assertEquals(hby.db.epsd.get([serder.said!]), null);
    assertEquals(hby.db.eidx.get([bob.pre]).map((diger) => diger.qb64), endorsers);
    await run(() => hby.db.reopen());
    assertEquals(await replay(exchanger, serder.said!), accepted);
  });
});
