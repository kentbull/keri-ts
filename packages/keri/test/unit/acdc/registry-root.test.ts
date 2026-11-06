/**
 * Registry roots replicate to members as ESSR exchanges over real KELs, TELs and Keepers.
 *
 * Ports KERIpy kentbull/keripy v2-spec e6985345 tests/acdc/test_registry_root.py (automatic acceptance, untimed escrow).
 * The wire vector is copied byte-for-byte from tests/acdc/fixtures/registry_root_essr.json,
 * Git blob 50dc56f4c79cbbae675e1d2f5f76a272d2db171f.
 */
import {
  concatBytes,
  Counter,
  Dater,
  Decrypter,
  Diger,
  Encrypter,
  essrChunks,
  Kinds,
  LabelDex,
  makeBlindState,
  MtrDex,
  parseBytes,
  Salter,
  type SerderACDC,
  Texter,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, run } from "effection";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import { registryRoot } from "../../../../tufa/src/cli/commands/registry-root.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { openRegistry } from "../../../src/acdc/registering.ts";
import { Regery } from "../../../src/acdc/registraring.ts";
import { RegistryRoot, RootDeferred, rootExn, RootRefused, RootUnverified } from "../../../src/acdc/salting.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { KramPolicy } from "../../../src/core/mailbox/kram-policy.ts";
import { exchange } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import vector from "../../fixtures/registry_root_essr.json" with { type: "json" };

interface Side {
  name: string;
  hby: Habery;
  hab: Hab;
  rgy: Regery;
  runtime: AgentRuntime;
  root: RegistryRoot;
  group?: Hab;
}

interface World {
  sides: Side[];
  issuer: Side;
  alice: Side;
  bob: Side;
  outsider: Side;
  registry: string;
  root: Salter;
  opening: ReturnType<typeof makeBlindState>;
  event: SerderACDC;
  acdc: string;
  gid: string;
  late: [Side, Uint8Array, Uint8Array][];
  held: Uint8Array[];
}

const encoder = new TextEncoder();

function said(wire: Uint8Array): string {
  return parseBytes(wire)[0].body.said!;
}

function* receive(side: Side, wire: Uint8Array, local = false): Operation<void> {
  yield* side.runtime.reactor.processBytes(wire, { local });
}

function stored(side: Side): string[] {
  return side.root.pending().map(item => item.said);
}

function notes(side: Side) {
  return [...side.runtime.notifier!.noter.notes.getTopItemIter()].map(([, note]) => note);
}

/** Run the side's ordinary Exchanger escrow pass, which drives `RegistryRoot.processEscrows`. */
function* escrows(side: Side): Operation<void> {
  yield* side.runtime.exc.processEscrows();
}

/** Deliver the late side's deferred issuer KEL and TEL. */
function* catchUp(w: World): Operation<void> {
  for (const [side, kel, tel] of w.late) {
    yield* receive(side, kel);
    yield* receive(side, tel);
  }
}

function held(w: World, side: Side, gid = w.gid) {
  return side.hby.mgr.getRegistryRoot(gid, w.registry);
}

/** Individual issuer; Alice/Bob 2-of-2 holder group, optionally Outsider as next-key member. */
function* world({ enabled = true, newcomer = false, late = [] as string[] } = {}): Operation<World> {
  const sides: Side[] = [];
  for (const name of ["issuer", "alice", "bob", "outsider"]) {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: `${name}RootReplicaPasscode`,
    });
    yield* ensure(() => hby.close(true));
    const hab = hby.makeHab(name);
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    yield* ensure(() => baser.close(true));
    const rgy = new Regery(hby, baser);
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      acdc: rgy,
      kram: { enabled, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    yield* ensure(() => runtime.close());
    assertExists(runtime.notifier);
    const root = new RegistryRoot(hby, rgy, runtime.notifier);
    runtime.exc.addHandler(root);
    sides.push({ name, hby, hab, rgy, runtime, root });
  }
  const [issuer, alice, bob, outsider] = sides;
  for (const side of sides) {
    for (const other of sides) {
      if (side === other) continue;
      for (const wire of other.hby.db.clonePreIter(other.hab.pre!, 0)) yield* receive(side, wire);
    }
  }
  const mids = [alice.hab.pre!, bob.hab.pre!];
  const creations = [alice, bob].map(side =>
    side.hby.makeGroupHab("group", side.hab, mids, newcomer ? [...mids, outsider.hab.pre!] : mids, undefined, {
      isith: "2",
      nsith: "1",
    })
  );
  alice.group = creations[0].hab;
  bob.group = creations[1].hab;
  const inception = messagize(creations[0].serder, {
    sigers: creations.flatMap(creation => creation.sigers),
    gvrsn: Vrsn_2_0,
  });
  for (const side of sides) {
    yield* receive(side, inception, true);
    assertExists(side.hby.db.getKever(alice.group.pre!));
  }
  const gid = alice.group.pre!;
  const deferred: World["late"] = [];
  const transfer = function*(event: SerderACDC, sn: number) {
    const kel = issuer.hab.interact({ data: [{ i: event.regid ?? event.said!, s: sn.toString(16), d: event.said! }] });
    yield* receive(issuer, event.raw);
    for (const side of sides.slice(1)) {
      if (late.includes(side.name)) {
        deferred.push([side, kel, event.raw]);
        continue;
      }
      yield* receive(side, kel);
      yield* receive(side, event.raw);
    }
  };
  const rip = regcept(issuer.hab.pre!);
  yield* transfer(rip, 0);
  const root = new Salter({ raw: encoder.encode("public-test-root"), code: MtrDex.Salt_128 });
  issuer.hab.mgr.putRegistryRoot(issuer.hab.pre!, rip.said!, root);
  const acdc = acdcmap(issuer.hab.pre!, { regid: rip.said!, attribute: { d: "", i: gid, role: "member" } });
  const opening = makeBlindState({ salt: root.qb64, sn: 1, acdc: acdc.said!, state: "issued" });
  const event = blindate(rip.said!, rip.said!, opening.d.nonce);
  yield* transfer(event, 1);
  for (const side of sides) {
    if (!late.includes(side.name)) assertEquals(side.rgy.store.headEvent(rip.said!)?.said, event.said);
  }
  return {
    sides,
    issuer,
    alice,
    bob,
    outsider,
    registry: rip.said!,
    root,
    opening,
    event,
    acdc: acdc.said!,
    gid,
    late: deferred,
    held: [],
  };
}

/** Send one authorized copy from the sender's individual habitat and return its SAID. */
function* copy(w: World, sender: Side, recipient: Side, { td, gid }: { td?: string; gid?: string } = {}) {
  const wire = sender.root.prepare(sender.hab, recipient.hab.pre!, gid ?? w.gid, w.registry, { td: td ?? w.acdc });
  yield* receive(recipient, wire);
  return said(wire);
}

/** The issuer's cross-party copy gives Alice's group its first root on arrival. */
function* seed(w: World): Operation<void> {
  yield* copy(w, w.issuer, w.alice);
  assertEquals(held(w, w.alice)?.qb64, w.root.qb64);
  assertEquals(stored(w.alice), []);
}

/** Real member and group rotations; `current` becomes the signing roster. */
function* rotate(w: World, members: Side[], current: Side[], sith: string, hold: Side[] = []) {
  for (const member of members) {
    const kel = member.hab.rotate();
    for (const side of w.sides) if (side !== member) yield* receive(side, kel);
  }
  const smids = current.map(side => side.hab.pre!);
  for (const side of current) {
    side.group ??= side.hby.joinGroupHab(w.gid, "group", side.hab, smids, smids);
  }
  const signers = current.filter(side => !hold.includes(side));
  const proposals = signers.map(side => side.hby.rotateGroupHab("group", smids, smids, { isith: sith, nsith: sith }));
  for (const proposal of proposals) assertEquals(proposal.serder.raw, proposals[0].serder.raw);
  const event = proposals[0].serder;
  const wire = messagize(event, { sigers: proposals.flatMap(proposal => proposal.sigers), gvrsn: Vrsn_2_0 });
  w.held = [wire];
  for (const side of w.sides) {
    if (hold.includes(side)) {
      assertNotEquals(side.hby.db.getKever(w.gid)!.said, event.said);
      continue;
    }
    yield* receive(side, wire, true);
    assertEquals(side.hby.db.getKever(w.gid)!.said, event.said);
  }
  for (const side of signers) side.hby.joinGroupHab(w.gid, "group", side.hab, smids, smids);
  return event.said!;
}

function texter(raw: Uint8Array): Texter {
  const rem = raw.length % 3;
  return new Texter({ code: rem === 0 ? LabelDex.Bytes_L0 : rem === 1 ? LabelDex.Bytes_L1 : LabelDex.Bytes_L2, raw });
}

/** Build a copy outside policy, as an attacker or stale sender could. */
function forge(
  sender: Side,
  recipient: string,
  gid: string,
  registry: string,
  plain: Record<string, string>,
  { digest, sealed, stamp }: { digest?: string; sealed?: Uint8Array; stamp?: string } = {},
): Uint8Array {
  const raw = sealed ?? new Encrypter({ verkey: sender.hby.db.getKever(recipient)!.verfers[0].qb64 }).encrypt({
    ser: encoder.encode(JSON.stringify(plain)),
  }).raw;
  const essr = digest ?? new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(raw, MtrDex.Blake3_256) }).qb64;
  const serder = exchange(RegistryRoot.Route, {
    sender: sender.hab.pre!,
    receiver: recipient,
    attributes: { essr, gid, rd: registry },
    stamp,
    pvrsn: Vrsn_2_0,
    kind: Kinds.json,
  });
  const signed = sender.hab.endorse(serder, { gvrsn: Vrsn_2_0, pipelined: false });
  const atc = concatBytes(signed.slice(serder.raw.length), ...essrChunks([texter(raw)], { gvrsn: Vrsn_2_0 }));
  return concatBytes(serder.raw, Counter.enclose({ qb64: atc, code: "AttachmentGroup", version: Vrsn_2_0 }));
}

function plaintext(w: World, sender: Side, recipient: Side, extra: Record<string, string> = {}) {
  return {
    i: sender.hab.pre!,
    ri: recipient.hab.pre!,
    gid: w.gid,
    rd: w.registry,
    s: w.root.qb64,
    e: w.event.said!,
    td: w.acdc,
    ...extra,
  };
}

for (const enabled of [false, true]) {
  Deno.test(`registry root: a member copy is retained on arrival by commitment reproduction (KRAM ${enabled})`, async () => {
    await run(function*() {
      const w = yield* world({ enabled });
      yield* seed(w);
      const bob = w.bob;
      assertEquals(held(w, bob), null);
      const pending = yield* copy(w, w.alice, bob);
      // No approval step: the handler verifies and retains the root at once.
      assertEquals(held(w, bob)?.qb64, w.root.qb64);
      assertEquals(bob.root.pending(), []);
      assertExists(bob.hby.db.exns.get([pending]));
      const [note] = notes(bob);
      assertEquals(notes(bob).length, 1);
      assertEquals([note.attrs.r, note.attrs.d, note.attrs.deferred], [RegistryRoot.Note, pending, undefined]);
      assertEquals([note.attrs.i, note.attrs.ri, note.attrs.gid, note.attrs.rd], [
        w.alice.hab.pre,
        bob.hab.pre,
        w.gid,
        w.registry,
      ]);
      // A second holder's identical copy is retained idempotently with no second note.
      yield* copy(w, w.issuer, bob);
      assertEquals(held(w, bob)?.qb64, w.root.qb64);
      assertEquals(bob.root.pending(), []);
      assertEquals(notes(bob).length, 1);
    });
  });

  Deno.test(`registry root: duplicate delivery is idempotent (KRAM ${enabled})`, async () => {
    await run(function*() {
      const w = yield* world({ enabled });
      yield* seed(w);
      let wire = w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry, { td: w.acdc });
      yield* receive(w.bob, wire);
      yield* receive(w.bob, wire);
      assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
      assertEquals(stored(w.bob), []);
      assertEquals(notes(w.bob).length, 1);
      // A duplicate of a still-escrowed copy is not escrowed twice.
      wire = w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry, { td: "" });
      yield* receive(w.bob, wire);
      yield* receive(w.bob, wire);
      assertEquals(stored(w.bob), [said(wire)]);
    });
  });
}

Deno.test("registry root: an unverifiable root stays escrowed until a held opening is supplied", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    const pending = yield* copy(w, w.alice, w.bob, { td: "" });
    assertEquals(stored(w.bob), [pending]);
    assertEquals(held(w, w.bob), null);
    assertEquals(notes(w.bob), []);
    yield* escrows(w.bob);
    assertEquals(stored(w.bob), [pending]);
    assertThrows(() => w.bob.root.receive(pending), RootUnverified);
    assertEquals(stored(w.bob), [pending]);
    // Manual retry supplies evidence the copy lacks.
    assertEquals(w.bob.root.receive(pending, { opening: w.opening }), true);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
  });
});

Deno.test("registry root: an escrowed copy is retried by a fresh handler over the same store", async () => {
  await run(function*() {
    const w = yield* world({ late: ["bob"] });
    yield* seed(w);
    const pending = yield* copy(w, w.alice, w.bob);
    assertEquals(stored(w.bob), [pending]);
    yield* catchUp(w);
    // A fresh command runtime over Bob's store installs its own route owner.
    const runtime = yield* createAgentRuntime(w.bob.hby, new FetchHttpClient(), systemClock, { acdc: w.bob.rgy });
    yield* ensure(() => runtime.close());
    const restarted = new RegistryRoot(w.bob.hby, w.bob.rgy);
    runtime.exc.addHandler(restarted);
    assertEquals(restarted.pending().map(item => item.said), [pending]);
    yield* runtime.exc.processEscrows();
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(restarted.pending(), []);
  });
});

Deno.test("registry root: a deferred copy is retained long after it was escrowed", async () => {
  await run(function*() {
    const w = yield* world({ late: ["bob"] });
    yield* seed(w);
    const pending = yield* copy(w, w.alice, w.bob);
    // The copy entered escrow two hours ago, before any former timeout.
    const old = makeNowIso8601(new Date(Date.now() - 7_200_000));
    w.bob.hby.db.rrpe.pin([pending], new Dater({ dts: old }));
    yield* escrows(w.bob);
    assertEquals(stored(w.bob), [pending]);
    assertEquals(held(w, w.bob), null);
    assertEquals(w.bob.root.pending()[0].escrowed, old);
    yield* catchUp(w);
    yield* escrows(w.bob);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
    assertEquals(notes(w.bob).map(note => note.attrs.d), [pending]);
  });
});

Deno.test("registry root: an identical resend of an unretained stored copy is escrowed again", async () => {
  await run(function*() {
    const w = yield* world({ late: ["bob"] });
    yield* seed(w);
    const wire = w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry, { td: w.acdc });
    const pending = said(wire);
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), [pending]);
    // The stored copy left escrow without retention (dropped or expired).
    w.bob.hby.db.rrpe.rem([pending]);
    assertEquals(stored(w.bob), []);
    assertExists(w.bob.hby.db.exns.get([pending]));
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), [pending]);
    yield* catchUp(w);
    // Still escrowed: the resend is ignored, not escrowed twice.
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), [pending]);
    assertEquals(held(w, w.bob), null);
    yield* escrows(w.bob);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
    // Once retained, the identical resend is ignored and adds no note.
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), []);
    assertEquals(notes(w.bob).map(note => note.attrs.d), [pending]);
  });
});

Deno.test("registry root: KRAM exempts a copy delivered long after its window", async () => {
  await run(function*() {
    const w = yield* world({ enabled: true });
    const body = exchange(RegistryRoot.Route, { pvrsn: Vrsn_2_0 });
    assertEquals(new KramPolicy(w.bob.hby.db, { enabled: true }).exempts(body), true);
    yield* seed(w);
    // A mailbox copy fetched a day after it was sent, far past the 6 s window.
    const stale = makeNowIso8601(new Date(Date.now() - 86_400_000));
    const wire = forge(w.alice, w.bob.hab.pre!, w.gid, w.registry, plaintext(w, w.alice, w.bob), { stamp: stale });
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), []);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
  });
});

for (const missing of ["tel", "rotation"] as const) {
  Deno.test(`registry root: offline newcomer copy is retained by escrow once ${missing} state arrives`, async () => {
    await run(function*() {
      const w = yield* world({ newcomer: true, late: missing === "tel" ? ["outsider"] : [] });
      yield* seed(w);
      yield* copy(w, w.alice, w.bob);
      assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
      const current = [w.alice, w.bob, w.outsider];
      yield* rotate(w, current, current, "2", missing === "rotation" ? [w.outsider] : []);
      // The witnesser sends catch-up while the newcomer still lacks local state.
      const pending = yield* copy(w, w.alice, w.outsider);
      assertEquals(stored(w.outsider), [pending]);
      assertEquals(notes(w.outsider), []);
      yield* escrows(w.outsider);
      assertEquals(held(w, w.outsider), null);
      assertEquals(stored(w.outsider), [pending]);
      const error = assertThrows(() => w.outsider.root.receive(pending), RootDeferred);
      assert(error.message.includes("not yet verifiable"));
      if (missing === "tel") yield* catchUp(w);
      else for (const wire of w.held) yield* receive(w.outsider, wire, true);
      assertEquals(held(w, w.outsider), null);
      // Ordinary escrow processing retains it; no approval, no resend.
      yield* escrows(w.outsider);
      assertEquals(held(w, w.outsider)?.qb64, w.root.qb64);
      assertEquals(stored(w.outsider), []);
      assertEquals(notes(w.outsider).map(note => note.attrs.d), [pending]);
    });
  });
}

Deno.test("registry root: a member removed before escrow retry is refused and dropped", async () => {
  await run(function*() {
    const w = yield* world({ newcomer: true, late: ["bob"] });
    yield* seed(w);
    const pending = yield* copy(w, w.alice, w.bob);
    assertEquals(stored(w.bob), [pending]);
    yield* rotate(w, [w.alice, w.outsider], [w.alice, w.outsider], "2");
    yield* catchUp(w);
    yield* escrows(w.bob);
    assertEquals(held(w, w.bob), null);
    assertEquals(stored(w.bob), []);
    assertEquals(notes(w.bob), []);
    const error = assertThrows(() => w.bob.root.receive(pending), ValidationError, "current signing member");
    assert(!(error instanceof RootUnverified));
  });
});

Deno.test("registry root: a deferred copy with unbound plaintext is dropped on retry", async () => {
  await run(function*() {
    const w = yield* world({ late: ["bob"] });
    yield* seed(w);
    const wire = forge(
      w.alice,
      w.bob.hab.pre!,
      w.gid,
      w.registry,
      plaintext(w, w.alice, w.bob, { i: w.issuer.hab.pre! }),
    );
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), [said(wire)]);
    yield* catchUp(w);
    yield* escrows(w.bob);
    assertEquals(stored(w.bob), []);
    assertEquals(held(w, w.bob), null);
    assertEquals(notes(w.bob), []);
  });
});

for (const fault of ["digest", "payload", "wrong-recipient", "outsider-sender", "group-recipient"] as const) {
  Deno.test(`registry root: ${fault} copies are refused and never persisted`, async () => {
    await run(function*() {
      const w = yield* world();
      yield* seed(w);
      const { alice, bob } = w;
      let sender = alice, recipient = bob.hab.pre!;
      const options: Parameters<typeof forge>[5] = {};
      if (fault === "digest") {
        options.digest =
          new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(encoder.encode("other"), MtrDex.Blake3_256) })
            .qb64;
      } else if (fault === "payload") {
        options.sealed = encoder.encode("not the digested box");
        options.digest = new Diger({
          code: MtrDex.Blake3_256,
          raw: Diger.digest(encoder.encode("not the digested box!"), MtrDex.Blake3_256),
        }).qb64;
      } else if (fault === "wrong-recipient") recipient = w.outsider.hab.pre!;
      else if (fault === "outsider-sender") sender = w.outsider;
      else recipient = w.gid;
      const wire = forge(sender, recipient, w.gid, w.registry, plaintext(w, alice, bob), options);
      yield* receive(bob, wire);
      assertEquals(bob.hby.db.exns.get([said(wire)]), null);
      assertEquals(bob.root.pending(), []);
      assertEquals(held(w, bob), null);
      assertEquals(notes(bob).length, 0);
    });
  });
}

for (const fault of ["unknown-registry", "holder-not-local"] as const) {
  Deno.test(`registry root: ${fault} copies are stored pending, not dropped`, async () => {
    await run(function*() {
      const w = yield* world();
      yield* seed(w);
      const { alice, bob } = w;
      // Not a registry Bob accepted, or a holder with no local habitat.
      const registry = fault === "unknown-registry" ? w.event.said! : w.registry;
      const gid = fault === "holder-not-local" ? w.issuer.hab.pre! : w.gid;
      const wire = forge(alice, bob.hab.pre!, gid, registry, plaintext(w, alice, bob, { gid, rd: registry }));
      yield* receive(bob, wire);
      assertEquals(stored(bob), [said(wire)]);
      assertEquals(notes(bob), []);
      yield* escrows(bob);
      assertThrows(() => bob.root.receive(said(wire)), RootDeferred);
      assertEquals(held(w, bob), null);
      assertEquals(stored(bob), [said(wire)]);
    });
  });
}

const plaintextFaults = [
  "inner-sender",
  "inner-recipient",
  "inner-gid",
  "inner-registry",
  "noncanonical-root",
  "wrong-root",
  "stale-key",
] as const;
for (const fault of plaintextFaults) {
  Deno.test(`registry root: a copy with ${fault} is never retained`, async () => {
    await run(function*() {
      const w = yield* world();
      yield* seed(w);
      const { alice, bob } = w;
      const changes = ({
        "inner-sender": { i: w.issuer.hab.pre! },
        "inner-recipient": { ri: alice.hab.pre! },
        "inner-gid": { gid: bob.hab.pre! },
        "inner-registry": { rd: w.event.said! },
        "noncanonical-root": { s: `${w.root.qb64}AAAA` },
        "wrong-root": { s: new Salter({ raw: encoder.encode("wrong-test-root!"), code: MtrDex.Salt_128 }).qb64 },
        "stale-key": {},
      } as Record<string, Record<string, string>>)[fault];
      const wire = forge(alice, bob.hab.pre!, w.gid, w.registry, plaintext(w, alice, bob, changes));
      if (fault === "stale-key") {
        const kel = bob.hab.rotate();
        for (const side of w.sides) if (side !== bob) yield* receive(side, kel);
      }
      yield* receive(bob, wire);
      const pending = said(wire);
      assertEquals(held(w, bob), null);
      assertEquals(notes(bob), []);
      assertExists(bob.hby.db.exns.get([pending]));
      // Hard refusals leave escrow at once; a wrong root may still be an
      // unknown commitment, so it waits for evidence.
      assertEquals(stored(bob), fault === "wrong-root" ? [pending] : []);
      const error = assertThrows(() => bob.root.receive(pending));
      assertInstanceOf(error, fault === "wrong-root" ? RootUnverified : RootRefused);
      assertEquals(held(w, bob), null);
    });
  });
}

Deno.test("registry root: a conflicting retained root is never replaced", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    const other = new Salter({ raw: encoder.encode("wrong-test-root!"), code: MtrDex.Salt_128 });
    w.bob.hby.mgr.putRegistryRoot(w.gid, w.registry, other);
    const pending = yield* copy(w, w.alice, w.bob);
    // Refused on arrival and dropped from escrow; the retained root stays.
    assertEquals(held(w, w.bob)?.qb64, other.qb64);
    assertEquals(stored(w.bob), []);
    assertEquals(notes(w.bob), []);
    assertThrows(() => w.bob.root.receive(pending, { opening: w.opening }), RootRefused);
    assertEquals(held(w, w.bob)?.qb64, other.qb64);
  });
});

Deno.test("registry root: a copy with a root other than the retained one is refused and dropped", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    yield* copy(w, w.alice, w.bob);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(notes(w.bob).length, 1);
    // The wrong root never reproduces the commitment; without this refusal it
    // would wait in escrow forever behind the immutable retained root.
    const wrong = new Salter({ raw: encoder.encode("wrong-test-root!"), code: MtrDex.Salt_128 });
    const wire = forge(w.alice, w.bob.hab.pre!, w.gid, w.registry, plaintext(w, w.alice, w.bob, { s: wrong.qb64 }));
    yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), []);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(notes(w.bob).length, 1);
    const error = assertThrows(() => w.bob.root.receive(said(wire)), RootRefused);
    assert(error.message.includes("different root"));
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
  });
});

Deno.test("registry root: newcomer catches up after a real rotation; next-key members are never recipients", async () => {
  await run(function*() {
    const w = yield* world({ newcomer: true });
    yield* seed(w);
    yield* copy(w, w.alice, w.bob);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertThrows(
      () => w.alice.root.prepare(w.alice.hab, w.outsider.hab.pre!, w.gid, w.registry),
      ValidationError,
      "current signing member",
    );
    const current = [w.alice, w.bob, w.outsider];
    const rotation = yield* rotate(w, current, current, "2");
    assertEquals(w.alice.root.newcomers(w.alice.group!, rotation), [w.outsider.hab.pre]);
    assertEquals(w.alice.root.members(w.gid), current.map(side => side.hab.pre));
    assertEquals(w.alice.root.held(w.gid), [w.registry]);
    assertEquals(w.alice.root.witnesser(w.alice.group!, rotation), true);
    assertEquals(w.bob.root.witnesser(w.bob.group!, rotation), false);
    yield* copy(w, w.alice, w.outsider);
    assertEquals(stored(w.outsider), []);
    // Every current member holds every root the group knows.
    assertEquals(new Set(current.map(side => held(w, side)?.qb64)), new Set([w.root.qb64]));
  });
});

Deno.test("registry root: full roster replacement catches up from a removed historical member", async () => {
  await run(function*() {
    const w = yield* world({ newcomer: true });
    yield* seed(w);
    yield* copy(w, w.alice, w.bob);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    const rotation = yield* rotate(w, [w.outsider], [w.outsider], "1");
    assertEquals(w.bob.root.newcomers(w.bob.group!, rotation), [w.outsider.hab.pre]);
    // Bob left the roster: never a recipient, still an authorized historical sender.
    assertThrows(
      () => w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry),
      ValidationError,
      "current signing member",
    );
    yield* copy(w, w.bob, w.outsider);
    assertEquals(held(w, w.outsider)?.qb64, w.root.qb64);
  });
});

Deno.test("registry root: the KERIpy ESSR fixture decrypts and binds", () => {
  const envelope = envelopeFromFrame(parseBytes(encoder.encode(vector.wire))[0]);
  const serder = envelope.serder, essrs = envelope.essrs ?? [];
  assertEquals([serder.route, serder.pre, serder.sad!.ri], [RegistryRoot.Route, vector.sender, vector.recipient]);
  const data = serder.sad!.a as Record<string, string>;
  assertEquals(Object.keys(data).sort(), ["essr", "gid", "rd"]);
  assertEquals(essrs.length, 1);
  assert(RegistryRoot.essrMatches(data.essr, essrs[0].raw));
  const decrypter = new Decrypter({ seed: encoder.encode(vector.recipient_seed) });
  const plain = JSON.parse(new TextDecoder().decode(decrypter.open(essrs[0].raw)!));
  assertEquals(plain, vector.plaintext);
  assertEquals([plain.i, plain.ri, plain.gid, plain.rd], [serder.pre, serder.sad!.ri, data.gid, data.rd]);
});

Deno.test("registry root: the KERIpy negative fixture fails its ESSR digest", () => {
  const good = envelopeFromFrame(parseBytes(encoder.encode(vector.wire))[0]);
  const [negative] = vector.negative;
  assertEquals(negative.name, "essr-digest-mismatch");
  const bad = envelopeFromFrame(parseBytes(encoder.encode(negative.wire))[0]);
  // The signed exchange is unchanged; only the attached payload differs.
  assertEquals(bad.serder.said, good.serder.said);
  assertNotEquals(bad.essrs![0].raw, good.essrs![0].raw);
  assertEquals(RegistryRoot.essrMatches((bad.serder.sad!.a as Record<string, string>).essr, bad.essrs![0].raw), false);
});

Deno.test("registry root: rootExn requires an individual sender and a Salt128 root", async () => {
  await run(function*() {
    const w = yield* world();
    assertThrows(
      () => rootExn(w.alice.group!, w.bob.hab.pre!, w.gid, w.registry, w.root, { event: w.event.said! }),
      ValidationError,
    );
    // A qb64 string is not a Salt128 primitive.
    const text = w.root.qb64 as unknown as Salter;
    assertThrows(
      () => rootExn(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry, text, { event: w.event.said! }),
      ValidationError,
    );
  });
});

Deno.test("registry root: Tufa send --out and receive --message use the same exchange path", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    const directory = yield* call(() => Deno.makeTempDir({ prefix: "tufa-registry-root-" }));
    yield* ensure(() => call(() => Deno.remove(directory, { recursive: true })));
    const out = `${directory}/root.cesr`;
    const base = { registries: [w.registry], recipients: [], listen: false, messages: [], timeoutMs: 30_000 };
    // A group alias sends as its member to the other current members by default.
    yield* registryRoot(w.alice.runtime, w.alice.group!, {
      ...base,
      verb: "send",
      registry: w.registry,
      acdc: w.acdc,
      out,
    });
    const wire = yield* call(() => Deno.readFile(out));
    assertEquals(parseBytes(wire).map(frame => envelopeFromFrame(frame).serder.sad?.ri), [w.bob.hab.pre]);
    assertEquals(new TextDecoder().decode(wire).includes(w.root.qb64), false);
    yield* call(() =>
      assertRejects(
        () =>
          run(() =>
            registryRoot(w.alice.runtime, w.alice.group!, { ...base, verb: "send", registry: w.registry, out })
          ),
        ValidationError,
        "output already exists",
      )
    );
    // A fresh command runtime over Bob's store installs its own route owner, as the CLI does.
    const runtime = yield* createAgentRuntime(w.bob.hby, new FetchHttpClient(), systemClock, { acdc: w.bob.rgy });
    yield* ensure(() => runtime.close());
    yield* registryRoot(runtime, w.bob.group!, {
      ...base,
      verb: "receive",
      registry: w.registry,
      messages: [out],
    });
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(w.bob.root.pending(), []);
  });
});
