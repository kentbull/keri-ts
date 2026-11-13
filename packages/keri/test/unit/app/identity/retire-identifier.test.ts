/**
 * `retireIdentifier` and the member retirement in `replaceGroupMember`: the runtime's refusals before any write,
 * and the runtime state a retirement ends (held signers, mailbox workers, cursors, KEL publisher rows) while the
 * KEL stays. LMDB-backed Haberies, so it runs in Docker.
 */
import { type Operation, run, spawn } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { MtrDex, type SerderKERI, type Siger, Signer, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { retireIdentifier, retireIdentifierRefusal } from "../../../../src/app/identity/retire-identifier.ts";
import { MAILBOX_POLLER_PACING } from "../../../../src/app/mailbox/mailbox-poller.ts";
import { replaceGroupMember } from "../../../../src/app/multisig/replace-member.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { runtimeTurn } from "../../../../src/app/runtime/runtime-turn.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { incept } from "../../../../src/core/protocol-eventing.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { waitForTaskHalt } from "../../../effection-http.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

interface Opened {
  hby: Habery;
  runtime: AgentRuntime;
  http: FakeRuntimeHttpClient;
  clock: ManualRuntimeClock;
}

/** A temporary LMDB Habery with a runtime over a fake HTTP client and a manual clock. */
function* opened(hby?: Habery): Operation<Opened> {
  hby ??= yield* temp();
  const http = new FakeRuntimeHttpClient(), clock = new ManualRuntimeClock();
  const runtime = yield* createAgentRuntime(hby, http, clock);
  return { hby, runtime, http, clock };
}

function* temp(): Operation<Habery> {
  return yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
}

/** Close the runtime, then its Habery. */
function* closed({ hby, runtime }: Opened): Operation<void> {
  yield* runtime.close();
  yield* hby.close(true);
}

const single = (hby: Habery, name: string): Hab => hby.makeHab(name);

/** A keyless habitat whose signer the host holds. */
function heldHab(hby: Habery, alias: string): { hab: Hab; signer: Signer } {
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  const hab = hby.makeSignedHab(alias, undefined, { serder, sigers: [signer.sign(serder.raw, { index: 0 }) as Siger] });
  hby.mgr.hold([signer]);
  return { hab, signer };
}

/** Assert `pre` is refused with `reason` and is still local. */
function assertRefused(runtime: AgentRuntime, pre: string, reason: string) {
  assert(retireIdentifierRefusal(runtime, pre)?.includes(reason));
  assertThrows(() => retireIdentifier(runtime, pre), ValidationError, reason);
  assert(runtime.hby.habs.has(pre), "a refused identifier stays local");
  assert(runtime.hby.db.getHab(pre), "and keeps its record");
}

Deno.test("retireIdentifier drops the retired identifier's held signers", async () => {
  await run(function*() {
    const o = yield* opened();
    try {
      const { hab, signer } = heldHab(o.hby, "custodial"), other = heldHab(o.hby, "other");
      const retired = retireIdentifier(o.runtime, hab.pre);
      assertEquals(retired, { pre: hab.pre, name: "custodial", released: [signer.verfer.qb64], mailboxes: [] });
      assertEquals(o.hby.mgr.hasSigner(signer.verfer.qb64), false, "the retired signer is no longer held");
      assert(o.hby.mgr.hasSigner(other.signer.verfer.qb64), "others stay held");
      assertEquals(o.hby.habs.has(hab.pre), false);
      assert(o.hby.db.getKever(hab.pre), "the KEL stays");
      // A salty habitat's keys are stored, not held: nothing to release.
      const salty = single(o.hby, "salty");
      assertEquals(retireIdentifier(o.runtime, salty.pre).released, []);
    } finally {
      yield* closed(o);
    }
  });
});

/** Advance the poller's tock clock until `until` holds. */
function* tockUntil(clock: ManualRuntimeClock, until: () => boolean, message: string): Operation<void> {
  for (let tock = 0; tock < 20 && !until(); tock++) {
    clock.advance(MAILBOX_POLLER_PACING.tockMs);
    for (let turn = 0; turn < 20; turn++) yield* runtimeTurn();
  }
  assert(until(), message);
}

Deno.test("retireIdentifier stops its mailbox workers and clears cursors", async () => {
  await run(function*() {
    const o = yield* opened();
    const { hby, runtime, http, clock } = o;
    try {
      const hab = single(hby, "polled"), other = single(hby, "kept");
      const eid = `mailbox-${crypto.randomUUID()}`, url = "http://retire.mailbox.test/";
      hby.db.locs.pin([eid, "http"], { url });
      hby.db.ends.pin([hab.pre, Roles.mailbox, eid], { allowed: true });
      const bodies: string[] = [];
      http.registerOrigin(url, async (request) => {
        bodies.push(new TextDecoder().decode(await request.arrayBuffer()));
        return new Response(null, { status: 204 });
      });
      const polls = () => bodies.filter((body) => body.includes(`"i":"${hab.pre}"`)).length;
      const cursor = { topics: { "/reply": 2 } }, published = { d: null, dt: "2026-01-01T00:00:00.000000+00:00" };
      hby.db.tops.pin([hab.pre, eid], cursor);
      hby.db.tops.pin([other.pre, eid], cursor);
      hby.db.kpub.pin([hab.pre, eid], published);
      hby.db.kpub.pin([other.pre, eid], published);

      runtime.mailboxPoller.registerTopic("/reply");
      const worker = yield* spawn(() => runtime.mailboxPoller.pollDo(() => {}, MAILBOX_POLLER_PACING));
      try {
        yield* tockUntil(clock, () => polls() > 0, "the identifier is polled");
        const retired = retireIdentifier(runtime, hab.pre);
        assertEquals(retired.mailboxes, [eid]);
        assertEquals(hby.db.tops.get([hab.pre, eid]), null, "its cursor is deleted");
        assertEquals(hby.db.kpub.get([hab.pre, eid]), null, "its publisher row is deleted");
        assert(hby.db.tops.get([other.pre, eid]), "another identifier's cursor stays");
        assert(hby.db.kpub.get([other.pre, eid]), "and its publisher row");
        assert(hby.db.ends.get([hab.pre, Roles.mailbox, eid]), "the accepted end role stays");
        // The worker halts on the next tock.
        const stale = polls();
        for (let tock = 0; tock < 5; tock++) {
          clock.advance(MAILBOX_POLLER_PACING.tockMs);
          for (let turn = 0; turn < 20; turn++) yield* runtimeTurn();
        }
        assertEquals(polls(), stale, "the retired identifier is not polled again");
        assertEquals(hby.db.tops.get([hab.pre, eid]), null, "and no cursor comes back");
        assertEquals(runtime.kelPublisher.statusOf(hab.pre), [], "the publisher owes it nothing");
      } finally {
        yield* waitForTaskHalt(worker);
      }
    } finally {
      yield* closed(o);
    }
  });
});

Deno.test("retireIdentifier refuses a registry owner", async () => {
  await run(function*() {
    const o = yield* opened();
    try {
      const issuer = single(o.hby, "issuer"), legacy = single(o.hby, "legacy");
      o.runtime.acdc!.makeRegistry("local", issuer.pre);
      assertRefused(o.runtime, issuer.pre, "is the issuer of registry local");
      o.runtime.vdr!.reger.regs.pin("old", { registryKey: "Eregistry", prefix: legacy.pre });
      assertRefused(o.runtime, legacy.pre, "is the issuer of registry old");
    } finally {
      yield* closed(o);
    }
  });
});

Deno.test("retireIdentifier refuses pending delegation", async () => {
  await run(function*() {
    const o = yield* opened();
    try {
      const delegate = single(o.hby, "delegate"), proxy = single(o.hby, "proxy");
      const icp = o.hby.db.getEvtSerder(delegate.pre, delegate.kever!.said)!;
      o.runtime.delegating.begin(icp, { communicationHab: proxy });
      assertRefused(o.runtime, delegate.pre, "has a pending delegated event");
      assertRefused(o.runtime, proxy.pre, "is the delegation proxy of");
      // The store level has no reason to keep the proxy; only the runtime's live workflow does.
      assertEquals(o.hby.retireRefusal(proxy.pre), null);
    } finally {
      yield* closed(o);
    }
  });
});

Deno.test("retireIdentifier refuses queued sends", async () => {
  await run(function*() {
    const o = yield* opened();
    const { hby, runtime } = o;
    try {
      const sender = single(hby, "sender"), querier = single(hby, "querier"), configured = single(hby, "default");
      runtime.postman.send({ src: sender.pre, dest: "Eremote", topic: "/challenge", msg: new Uint8Array([1]) });
      assertRefused(runtime, sender.pre, "has queued outgoing messages");
      runtime.querying.enqueue({ pre: "Esubject", signer: querier.pre, route: "logs", q: {} });
      assertRefused(runtime, querier.pre, "signs queued queries");
      runtime.querying.configure({ hab: configured });
      assertRefused(runtime, configured.pre, "is the runtime's configured query signer");
      runtime.querying.configure({});
      assertEquals(retireIdentifier(runtime, configured.pre).pre, configured.pre, "a refusal is not sticky");
    } finally {
      yield* closed(o);
    }
  });
});

// --- member replacement -------------------------------------------------------------------------------------

interface Side {
  hby: Habery;
  hab: Hab;
}

/** Accept `serder` at `hby` as group coordination does: local intake, then escrows. */
function deliver(hby: Habery, serder: SerderKERI, sigers: Siger[], wigers: Siger[] = []) {
  hby.kevery.processEvent({ serder, sigers, wigers, frcs: [], sscs: [], ssts: [], local: true });
  hby.kevery.processEscrows();
}

/** Replay every accepted event of `pre` from `from` into each `to`. */
function share(from: Habery, pre: string, to: Habery[]) {
  for (const [, said] of [...from.db.getKelItemIter(pre)]) {
    const serder = from.db.getEvtSerder(pre, said)!;
    for (const hby of to) deliver(hby, serder, from.db.sigs.get(dgKey(pre, said)), from.db.wigs.get(dgKey(pre, said)));
  }
}

const groupArgs = { isith: "2", nsith: "2", toad: 0 };

/**
 * Three members `a`, `b`, `c` in their own Haberies and a group `g` whose rotation, by `b` and `c`, replaced `a`
 * with `fresh`, another habitat of `a`'s Habery. The point where `replaceGroupMember` applies at `a`.
 */
function* rotatedOutMember(): Operation<{ sides: Side[]; fresh: Hab; gid: string; next: string[] }> {
  const sides: Side[] = [];
  for (let i = 0; i < 3; i++) {
    const hby = yield* temp();
    sides.push({ hby, hab: hby.makeHab(`member${i}`) });
  }
  const [a, b, c] = sides, fresh = a.hby.makeHab("replacement");
  for (const from of sides) share(from.hby, from.hab.pre, sides.filter((s) => s !== from).map((s) => s.hby));
  share(a.hby, fresh.pre, [b.hby, c.hby]);
  const smids = sides.map((s) => s.hab.pre), rmids = [...smids, fresh.pre];
  const created = sides.map((s) => s.hby.makeGroupHab("g", s.hab, smids, rmids, undefined, groupArgs));
  sides.forEach((s, i) => created.forEach((g, j) => i !== j && deliver(s.hby, g.serder, g.sigers)));
  b.hab.rotate();
  c.hab.rotate();
  fresh.rotate();
  share(b.hby, b.hab.pre, [a.hby, c.hby]);
  share(c.hby, c.hab.pre, [a.hby, b.hby]);
  share(a.hby, fresh.pre, [b.hby, c.hby]);
  const next = [b.hab.pre, c.hab.pre, fresh.pre];
  const rots = [b, c].map((s) => s.hby.rotateGroupHab("g", next, next, groupArgs));
  deliver(b.hby, rots[1].serder, rots[1].sigers);
  deliver(c.hby, rots[0].serder, rots[0].sigers);
  rots.forEach((r) => deliver(a.hby, r.serder, r.sigers));
  return { sides, fresh, gid: created[0].serder.pre!, next };
}

/** Run `body` against a replaced-member setup whose `a` side has a runtime; closes everything after. */
function withReplacement(
  body: (o: Opened, a: Hab, fresh: Hab, gid: string, next: string[]) => void,
): Promise<void> {
  return run(function*() {
    const { sides, fresh, gid, next } = yield* rotatedOutMember();
    const o = yield* opened(sides[0].hby);
    try {
      assertEquals(o.hby.db.getKever(gid)!.sn, 1, "the rotation is accepted where the replacement applies");
      body(o, sides[0].hab, fresh, gid, next);
    } finally {
      yield* closed(o);
      for (const side of sides.slice(1)) yield* side.hby.close(true);
    }
  });
}

Deno.test("replaceGroupMember retires the replaced member", async () => {
  await withReplacement((o, a, fresh, gid, next) => {
    const replaced = replaceGroupMember(o.runtime, { group: gid, member: fresh, smids: next });
    assertEquals(o.hby.db.getHab(gid)!.mid, fresh.pre);
    assertEquals(replaced.previousMember, {
      kind: "retired",
      retired: { pre: a.pre, name: "member0", released: [], mailboxes: [] },
    });
    assertEquals(o.hby.habs.has(a.pre), false);
    assertEquals(o.hby.db.getHab(a.pre), null);
    assert(o.hby.db.getKever(a.pre), "the old member's KEL stays");
  });
});

Deno.test("replaceGroupMember keeps a replaced member that is still needed and says why", async () => {
  await withReplacement((o, a, fresh, gid, next) => {
    o.runtime.querying.enqueue({ pre: "Esubject", signer: a.pre, route: "logs", q: {} });
    const replaced = replaceGroupMember(o.runtime, { group: gid, member: fresh, smids: next });
    assertEquals(o.hby.db.getHab(gid)!.mid, fresh.pre, "the replacement succeeds");
    assertEquals(replaced.previousMember, { kind: "kept", reason: `${a.pre} signs queued queries.` });
    assert(o.hby.habs.has(a.pre));
  });
});

Deno.test("replaceGroupMember keepPrevious keeps the old member", async () => {
  await withReplacement((o, a, fresh, gid, next) => {
    const replaced = replaceGroupMember(o.runtime, { group: gid, member: fresh, smids: next, keepPrevious: true });
    assertEquals(o.hby.db.getHab(gid)!.mid, fresh.pre);
    assertEquals(replaced.previousMember.kind, "kept");
    assert(o.hby.habs.has(a.pre));
    assertEquals(retireIdentifierRefusal(o.runtime, a.pre), null, "it could have been retired");
  });
});
