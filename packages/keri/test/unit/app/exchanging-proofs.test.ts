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
      verifyEvidence({ evidence }) {
        return evidence.invalid ? null : evidence;
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
        verifyEvidence({ evidence }) {
          return evidence;
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
