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
  MtrDex,
  parseBytes,
  Salter,
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
import { RegistryRoot, RootDeferred, rootExn, RootRefused, RootUnverified } from "../../../src/acdc/salting.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { createProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../src/app/protocol/reactor.ts";
import { createAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { KramPolicy } from "../../../src/core/mailbox/kram-policy.ts";
import { exchange } from "../../../src/core/protocol-eventing.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import vector from "../../fixtures/registry_root_essr.json" with { type: "json" };
import {
  catchUp,
  copy,
  encoder,
  escrows,
  held,
  notes,
  receive,
  rotate,
  said,
  seed,
  type Side,
  stored,
  type World,
  world,
} from "../../support/registry-root-world.ts";

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
    // A fresh command runtime over Bob's store registers its own route owner.
    const runtime = yield* createAgentRuntime(w.bob.hby, new FetchHttpClient(), systemClock, { acdc: w.bob.rgy });
    yield* ensure(() => runtime.close());
    const restarted = runtime.registryRoot!;
    assertEquals(restarted.pending().map(item => item.said), [pending]);
    yield* runtime.exc.processEscrows();
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(restarted.pending(), []);
  });
});

/** Store one copy through an Exchanger with no `/registry/root` handler, as a handler-less process does. */
function* storeUnhandled(w: World, sender: Side, recipient: Side): Operation<string> {
  const wire = sender.root.prepare(sender.hab, recipient.hab.pre!, w.gid, w.registry, { td: w.acdc });
  yield* new Reactor(createProtocolProcessor(recipient.hby)).processBytes(wire);
  const pending = said(wire);
  // Authenticated and stored, but never escrowed or retried.
  assertExists(recipient.hby.db.exns.get([pending]));
  assertEquals(recipient.hby.db.getEssrs(pending)?.length, 1);
  assertEquals(stored(recipient), []);
  return pending;
}

Deno.test("registry root: the next runtime adopts and retains a copy a handler-less Exchanger stored", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    yield* storeUnhandled(w, w.alice, w.bob);
    assertEquals(held(w, w.bob), null);
    // Constructing a runtime over the store reconciles: the copy is escrowed and retained at once.
    const runtime = yield* createAgentRuntime(w.bob.hby, new FetchHttpClient(), systemClock, { acdc: w.bob.rgy });
    yield* ensure(() => runtime.close());
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
    // Nothing is adopted twice.
    assertEquals(runtime.registryRoot!.reconcile(), []);
  });
});

Deno.test("registry root: an adopted copy that is not yet verifiable stays escrowed until state arrives", async () => {
  await run(function*() {
    const w = yield* world({ late: ["bob"] });
    yield* seed(w);
    const pending = yield* storeUnhandled(w, w.alice, w.bob);
    assertEquals(w.bob.root.reconcile(), [pending]);
    assertEquals(stored(w.bob), [pending]);
    assertEquals(held(w, w.bob), null);
    // Already escrowed: a second reconcile adds nothing.
    assertEquals(w.bob.root.reconcile(), []);
    yield* catchUp(w);
    yield* escrows(w.bob);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
  });
});

Deno.test("registry root: reconcile with a Keeper that cannot retain roots leaves the copy escrowed", async () => {
  await run(function*() {
    const w = yield* world({ plain: ["bob"] });
    yield* seed(w);
    const pending = yield* storeUnhandled(w, w.alice, w.bob);
    // Construction reconciles without raising; the unencrypted Keeper keeps the copy pending.
    const runtime = yield* createAgentRuntime(w.bob.hby, new FetchHttpClient(), systemClock, { acdc: w.bob.rgy });
    yield* ensure(() => runtime.close());
    assertEquals(stored(w.bob), [pending]);
    assertEquals(held(w, w.bob), null);
    yield* runtime.exc.processEscrows();
    assertEquals(stored(w.bob), [pending]);
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
    // A fresh command runtime over Bob's store registers its own route owner, as the CLI does.
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
