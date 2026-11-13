/**
 * Malformed field values in well-formed, SAID-valid remote messages end that one message as a typed refusal.
 *
 * Each case is a message a remote party can send: its body parses and its SAID verifies, but one field value is not
 * a valid value for its type. Before the fix each threw a cesr codec error out of dispatch or escrow replay, which ends
 * the agent runtime (and, for an escrowed row, does so again on every pass).
 */
import {
  Dater,
  Diger,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealSource,
  SerderKERI,
  type Siger,
  Vrsn_2_0,
} from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import type { ProtocolDispatchResult, ProtocolProcessor } from "../../../../src/app/protocol/protocol-processing.ts";
import { exchange, query } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../../src/time/mod.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

/** A remote party's habitat and the victim's store and protocol processor, all temporary. */
interface Parties {
  remote: Habery;
  victim: Habery;
  protocol: ProtocolProcessor;
  hab: Hab;
}

/**
 * Run one case with a remote signer and a victim that has not yet seen the signer's KEL.
 * @param body Case body; both stores are closed afterwards.
 */
function withParties(body: (parties: Parties) => Operation<void>): Promise<void> {
  return run(function*() {
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const victim = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = remote.makeHab("remote", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      yield* body({ remote, victim, protocol: protocolFixture(victim), hab });
    } finally {
      yield* remote.close(true);
      yield* victim.close(true);
    }
  });
}

/** Dispatch one complete wire message through the runtime's protocol owner. */
function* dispatchWire(protocol: ProtocolProcessor, wire: Uint8Array): Operation<ProtocolDispatchResult> {
  const [frame] = parseBytes(wire);
  return yield* protocol.dispatch(frame);
}

/** Give the victim the remote party's accepted event at `sn`. */
function* deliverEvent(parties: Parties, sn: number): Operation<void> {
  const { message } = acceptedEventReplayMessage(parties.remote, parties.hab.pre, sn);
  const result = yield* dispatchWire(parties.protocol, message);
  assertEquals(result.decision?.kind, "accept");
}

/** Re-make `serder` with some field values replaced, recomputing its SAID (and a self-addressing prefix). */
function remake(serder: SerderKERI, fields: Record<string, unknown>, readdress = false): SerderKERI {
  const sad: Record<string, unknown> = { ...serder.sad!, ...fields, d: "" };
  if (readdress) sad.i = "";
  return new SerderKERI({ sad, makify: true });
}

/** Sign `serder` with the remote habitat's current keys and attach the signatures. */
function signed(hab: Hab, serder: SerderKERI): Uint8Array {
  return messagize(serder, { sigers: hab.sign(serder.raw, true) as Siger[] });
}

/** Assert a dispatch result is the invalid-message drop, the refusal for a message with malformed fields. */
function assertInvalidDrop(result: ProtocolDispatchResult, detail: string): void {
  const decision = result.decision;
  assertEquals(decision?.kind === "drop" && decision.reason, "invalidMessage");
  const reported = decision && "detail" in decision ? decision.detail : undefined;
  assert(reported?.includes(detail), `expected "${detail}" in "${reported}"`);
}

/** Assert a dispatch result is a KEL rejection with `code`. */
function assertRejected(result: ProtocolDispatchResult, code: string): void {
  assertEquals(result.decision?.kind, "reject");
  if (result.decision?.kind !== "reject" || !("code" in result.decision)) throw new Error("expected a KEL rejection");
  assertEquals(result.decision.code, code);
}

Deno.test("a receipt with an over-wide sequence number is dropped", async () => {
  await withParties(function*({ victim, protocol, hab }) {
    const icp = hab.kever!.serder;
    const rct = new SerderKERI({
      sad: { v: "KERI10JSON000000_", t: "rct", d: icp.said, i: hab.pre, s: "f".repeat(40) },
      makify: true,
    });
    yield* dispatchWire(protocol, signed(hab, rct));
    const cues = [];
    while (!protocol.cues.empty) cues.push(protocol.cues.pull()!);
    assertEquals(cues.map((cue) => cue.kin), ["invalid"]);
    assertEquals([...victim.db.ures.getTopItemIter()].length, 0);
  });
});

Deno.test("an event with a non-hex sequence number is rejected", async () => {
  await withParties(function*(parties) {
    yield* deliverEvent(parties, 0);
    parties.hab.interact();
    const ixn = remake(
      parties.remote.db.getEvtSerder(parties.hab.pre, parties.remote.db.kels.getLast(parties.hab.pre, 1)!)!,
      {
        s: "zz",
      },
    );
    assertRejected(yield* dispatchWire(parties.protocol, signed(parties.hab, ixn)), "invalidSn");
  });
});

Deno.test("an inception with junk keys is rejected", async () => {
  await withParties(function*({ protocol, hab }) {
    const icp = remake(hab.kever!.serder, { k: ["junk"] }, true);
    assertRejected(yield* dispatchWire(protocol, signed(hab, icp)), "malformedField");
  });
});

Deno.test("an inception with a junk next digest is rejected", async () => {
  await withParties(function*({ victim, protocol, hab }) {
    const icp = remake(hab.kever!.serder, { n: ["notadigest"] }, true);
    assertRejected(yield* dispatchWire(protocol, signed(hab, icp)), "malformedField");
    assertEquals(victim.db.getKever(icp.pre!), null);
  });
});

Deno.test("an inception with a junk witness is rejected before escrow", async () => {
  await withParties(function*({ victim, protocol, hab }) {
    const icp = remake(hab.kever!.serder, { b: ["junk"], bt: "1" }, true);
    assertRejected(yield* dispatchWire(protocol, signed(hab, icp)), "malformedField");
    assertEquals([...victim.db.pwes.getTopItemIter()].length, 0);
  });
});

Deno.test("an out-of-order rotation with junk keys is rejected and does not poison the escrow", async () => {
  await withParties(function*(parties) {
    const { remote, victim, protocol, hab } = parties;
    hab.rotate();
    const rot = remake(remote.db.getEvtSerder(hab.pre, remote.db.kels.getLast(hab.pre, 1)!)!, { k: ["junk"] });
    assertRejected(yield* dispatchWire(protocol, signed(hab, rot)), "malformedField");
    assertEquals([...victim.db.ooes.getTopItemIter()].length, 0);
    yield* deliverEvent(parties, 0);
    yield* protocol.processEscrowsOnce();
    assertEquals(victim.db.getKever(hab.pre)?.sn, 0);
  });
});

Deno.test("a stored out-of-order escrow with junk keys is removed on replay", async () => {
  await withParties(function*(parties) {
    const { remote, victim, protocol, hab } = parties;
    hab.rotate();
    // A row escrowed before the boundary check existed: the rotation's fields were never decoded.
    const rot = remake(remote.db.getEvtSerder(hab.pre, remote.db.kels.getLast(hab.pre, 1)!)!, { k: ["junk"] });
    const key = dgKey(hab.pre, rot.said!);
    victim.db.dtss.put(key, new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }));
    victim.db.evts.put(key, rot);
    victim.db.ooes.addOn(hab.pre, 1, rot.said!);
    yield* deliverEvent(parties, 0);
    yield* protocol.processEscrowsOnce();
    for (const escrow of [victim.db.ooes, victim.db.pses, victim.db.pwes, victim.db.pdes, victim.db.ldes]) {
      assertEquals([...escrow.getTopItemIter()].length, 0);
    }
    yield* protocol.processEscrowsOnce();
    assertEquals(victim.db.getKever(hab.pre)?.sn, 0);
  });
});

/** Build a remote `/ksn` reply about the remote party itself whose `d` is not a digest, signed at its latest key event. */
function nonDigestKeyStateNotice(hab: Hab): Uint8Array {
  return hab.reply(`/ksn/${hab.pre}`, { i: hab.pre, s: "5", d: "notadigest", dt: makeNowIso8601() });
}

Deno.test("a key state notice with a non-digest is rejected and does not poison the reply escrow", async () => {
  await withParties(function*(parties) {
    const { victim, protocol, hab } = parties;
    yield* deliverEvent(parties, 0);
    hab.rotate();
    // Signed at an establishment event the victim lacks, so before the fix it was escrowed "unverified".
    assertInvalidDrop(yield* dispatchWire(protocol, nonDigestKeyStateNotice(hab)), "key state notice");
    assertEquals(victim.db.rpes.cnt(), 0);
    yield* deliverEvent(parties, 1);
    yield* protocol.processEscrowsOnce();
    assertEquals(victim.db.knas.get([hab.pre, hab.pre]), null);
  });
});

Deno.test("a stored reply escrow carrying a non-digest key state is removed on replay", async () => {
  await withParties(function*(parties) {
    const { remote, victim, protocol, hab } = parties;
    yield* deliverEvent(parties, 0);
    hab.rotate();
    yield* deliverEvent(parties, 1);
    const [frame] = parseBytes(nonDigestKeyStateNotice(hab));
    const serder = frame.body as SerderKERI;
    const rotSaid = remote.db.kels.getLast(hab.pre, 1)!;
    // A row escrowed before the route checked its fields.
    protocol.rvy.escrowReply({
      serder,
      saider: new Diger({ qb64: serder.said! }),
      dater: new Dater({ qb64: encodeDateTimeToDater(serder.ked!.dt as string) }),
      route: serder.route!,
      prefixer: new Prefixer({ qb64: hab.pre }),
      seqner: NumberPrimitive.fromNum(1n),
      diger: new Diger({ qb64: rotSaid }),
      sigers: hab.sign(serder.raw, true) as Siger[],
    });
    assertEquals(victim.db.rpes.cnt(), 1);
    yield* protocol.processEscrowsOnce();
    assertEquals(victim.db.rpes.cnt(), 0);
    assertEquals(victim.db.rpys.get([serder.said!]), null);
  });
});

Deno.test("an end role reply with a non-prefix controller is rejected", async () => {
  await withParties(function*({ protocol, hab }) {
    const wire = hab.reply("/end/role/add", { cid: "zz", role: "mailbox", eid: hab.pre });
    assertInvalidDrop(yield* dispatchWire(protocol, wire), "/end/role");
  });
});

Deno.test("a location reply with a non-prefix endpoint is rejected", async () => {
  await withParties(function*({ protocol, hab }) {
    const wire = hab.reply("/loc/scheme", { eid: "zz", scheme: "http", url: "http://host.test/" });
    assertInvalidDrop(yield* dispatchWire(protocol, wire), "/loc/scheme");
  });
});

Deno.test("a location reply with an unparseable URL is rejected", async () => {
  await withParties(function*({ protocol, hab }) {
    const wire = hab.reply("/loc/scheme", { eid: hab.pre, scheme: "http", url: "not a url" });
    assertInvalidDrop(yield* dispatchWire(protocol, wire), "URL");
  });
});

Deno.test("a watcher reply with a non-prefix controller is rejected", async () => {
  await withParties(function*({ protocol, hab }) {
    const wire = hab.reply(`/watcher/${hab.pre}/add`, { cid: "zz", oid: hab.pre });
    assertInvalidDrop(yield* dispatchWire(protocol, wire), "/watcher");
  });
});

Deno.test("a reply with a malformed datetime is rejected", async () => {
  await withParties(function*({ protocol, hab }) {
    const wire = hab.reply("/end/role/add", { cid: hab.pre, role: "mailbox", eid: hab.pre }, "yesterday");
    assertInvalidDrop(yield* dispatchWire(protocol, wire), "dt");
  });
});

Deno.test("a v2 query whose sender is not a prefix is dropped as unauthenticated", async () => {
  await withParties(function*({ protocol, hab }) {
    const qry = query("logs", { i: hab.pre }, { pre: "zz", pvrsn: Vrsn_2_0 });
    const wire = messagize(qry, { sigers: hab.sign(qry.raw, true) as Siger[], gvrsn: Vrsn_2_0 });
    const result = yield* dispatchWire(protocol, wire);
    assertEquals(result.decision, { kind: "drop", reason: "missingAuthentication" });
  });
});

Deno.test("an exchange whose sender is not a prefix is rejected before its source seals are resolved", async () => {
  await withParties(function*({ protocol, hab }) {
    const exn = exchange("/challenge/response", { sender: "zz", attributes: { words: ["a"] } });
    const decision = yield* protocol.exc.processEvent({
      serder: exn,
      tsgs: [],
      cigars: [],
      ptds: [],
      sscs: [SealSource.fromTuple([NumberPrimitive.fromNum(0n), new Diger({ qb64: hab.kever!.serder.said! })])],
    });
    assertEquals(decision.kind, "reject");
  });
});
