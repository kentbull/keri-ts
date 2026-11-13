/** Per-identifier IPEX auxiliary owners: registry, dispatch by transaction, KRAM invariant and legacy option. */
import { Diger, Kinds, parseBytes, Vrsn_2_0 } from "cesr-ts";
import { ensure, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { Dhke } from "../../../../src/acdc/dhking.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import { Unblind } from "../../../../src/acdc/unblinding.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import {
  type AgentRuntimeOptions,
  createAgentRuntime,
  runAgentRuntime,
} from "../../../../src/app/runtime/agent-runtime.ts";
import type { IpexAuxiliaries } from "../../../../src/app/runtime/ipex-auxiliaries.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { query, reply } from "../../../../src/core/protocol-eventing.ts";
import { TxnMsgCacheRecord } from "../../../../src/core/records.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";
import { makeNowIso8601 } from "../../../../src/time/mod.ts";
import { world } from "../../../support/registry-root-world.ts";

const KRAM = { enabled: true } as const;

/** One wallet Habery with two local identifiers, one remote sender, and a runtime over them. */
function* wallet(
  options: (habs: { a: Hab; b: Hab }) => Partial<AgentRuntimeOptions> = () => ({ kram: KRAM }),
) {
  const hby = yield* createHabery({
    name: crypto.randomUUID(),
    temp: true,
    skipConfig: true,
    bran: "WalletPasscodeSecretAB",
  });
  yield* ensure(() => hby.close(true));
  const remoteHby = yield* createHabery({
    name: crypto.randomUUID(),
    temp: true,
    skipConfig: true,
    bran: "RemotePasscodeSecretAB",
  });
  yield* ensure(() => remoteHby.close(true));
  const [a, b] = [hby.makeHab("a"), hby.makeHab("b")];
  const remote = remoteHby.makeHab("remote");
  const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
  yield* ensure(() => baser.close(true));
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
    acdc: new Regery(hby, baser),
    ...options({ a, b }),
  });
  yield* ensure(() => runtime.close());
  return { hby, a, b, remote, runtime };
}

const frame = (remote: Hab, route: string, xid: string) =>
  parseBytes(remote.endorse(
    query(route, { x: xid, pk: {} }, { pre: remote.pre, replyRoute: route, pvrsn: Vrsn_2_0, kind: Kinds.json }),
    { gvrsn: Vrsn_2_0 },
  ))[0];

/** Replace an owner's query entry so the test sees exactly which owner a query reached. */
function spyQueries(owner: Dhke | Unblind, tag: string, seen: string[]) {
  owner.processQuery = () => {
    seen.push(tag);
    return { kind: "accept" };
  };
}

/** Stand in for an approved operation, which is what makes an owner claim a transaction; removed before teardown. */
function* approve(owner: Dhke | Unblind, xid: string) {
  const operations = (owner as unknown as { operations: Map<string, unknown> }).operations;
  operations.set(xid, {});
  yield* ensure(() => {
    operations.delete(xid);
  });
}

Deno.test("per-identifier owners are created once per identifier and kind, and released", async () => {
  await run(function*() {
    const { a, b, runtime } = yield* wallet();
    const ipex = runtime.ipex!;
    assert(ipex.dhke(a) === ipex.dhke(a));
    assert(ipex.dhke(a) !== ipex.dhke(b));
    assert(ipex.unblind(a) === ipex.unblind(a));
    assertEquals(ipex.dhke(a).hab, a);
    assertEquals(ipex.unblind(a).hab, a);
    const before = ipex.dhke(a);
    ipex.release(a.pre!);
    assert(ipex.dhke(a) !== before, "a released identifier gets a fresh owner");
  });
});

Deno.test("each identifier receives only its own DH queries, and both kinds coexist on one identifier", async () => {
  await run(function*() {
    const { a, b, remote, runtime } = yield* wallet();
    const ipex = runtime.ipex!;
    const seen: string[] = [];
    spyQueries(ipex.dhke(a), "dhke-a", seen);
    spyQueries(ipex.dhke(b), "dhke-b", seen);
    spyQueries(ipex.unblind(a), "unblind-a", seen);
    yield* approve(ipex.dhke(a), "xid-a");
    yield* approve(ipex.dhke(b), "xid-b");
    yield* approve(ipex.unblind(a), "xid-u");
    for (const [route, xid] of [[Dhke.Route, "xid-b"], [Dhke.Route, "xid-a"], [Unblind.Route, "xid-u"]]) {
      const envelope = envelopeFromFrame(frame(remote, route, xid));
      assert(runtime.protocol.qvy!.claims!(envelope.serder));
      runtime.protocol.qvy!.processQuery(envelope);
    }
    assertEquals(seen, ["dhke-b", "dhke-a", "unblind-a"]);
    // A transaction is claimed by the kind of its route only.
    assertEquals(runtime.protocol.qvy!.claims!(envelopeFromFrame(frame(remote, Unblind.Route, "xid-a")).serder), false);
  });
});

Deno.test("a runtime that refuses peer queries drops them unrecorded, so a resend reaches the consenting runtime", async () => {
  await run(function*() {
    const { a, remote, runtime } = yield* wallet(() => ({ kram: KRAM, ipexQueries: "refuse" }));
    const seen: string[] = [];
    spyQueries(runtime.ipex!.dhke(a), "dhke-a", seen);
    yield* approve(runtime.ipex!.dhke(a), "xid-a");
    const wire = frame(remote, Dhke.Route, "xid-a");
    const result = yield* runtime.protocol.dispatch(wire);
    assertEquals(result.decision, { kind: "drop", reason: "missingProcessor" });
    assertEquals(seen, []);
    // Dropped before KRAM intake: nothing is recorded, so the identical resend is not a replay later.
    assertEquals([...runtime.hby.db.msgc.getTopItemIter()].length, 0);
  });
});

Deno.test("a message for an identifier with no owner is handled as without any owner", async () => {
  await run(function*() {
    const { a, remote, runtime } = yield* wallet();
    const plain = yield* wallet(() => ({}));
    yield* approve(runtime.ipex!.dhke(a), "xid-a");
    for (const side of [runtime, plain.runtime]) {
      const result = yield* side.protocol.dispatch(frame(remote, Dhke.Route, "unowned"));
      assertEquals(result.decision, { kind: "drop", reason: "missingProcessor" });
      const unowned = reply(Dhke.Route, { x: "unowned", pk: {} }, {
        pre: remote.pre,
        pvrsn: Vrsn_2_0,
        kind: Kinds.json,
      });
      const error = assertThrows(() =>
        side.protocol.rvy.rtr.dispatch({ serder: unowned, diger: new Diger({ qb64: unowned.said! }) })
      );
      assertEquals((error as Error).message, `No resource is registered to handle route ${Dhke.Route}`);
    }
  });
});

Deno.test("replies reach the owner of their transaction, including owners registered while the runtime runs", async () => {
  await run(function*() {
    const { a, b, remote, runtime } = yield* wallet();
    const worker = yield* spawn(() => runAgentRuntime(runtime));
    yield* sleep(20);
    const seen: string[] = [];
    for (const [hab, tag] of [[a, "a"], [b, "b"]] as const) {
      const owner = runtime.ipex!.dhke(hab);
      owner.processReply = () => {
        seen.push(tag);
        return { kind: "accept" };
      };
      yield* approve(owner, `xid-${tag}`);
    }
    for (const xid of ["xid-b", "xid-a"]) {
      const serder = reply(Dhke.Route, { x: xid, pk: {} }, { pre: remote.pre, pvrsn: Vrsn_2_0, kind: Kinds.json });
      runtime.protocol.rvy.rtr.dispatch({ serder, diger: new Diger({ qb64: serder.said! }) });
    }
    assertEquals(seen, ["b", "a"]);
    yield* worker.halt();
  });
});

for (const kram of [undefined, { enabled: false }]) {
  Deno.test(`with KRAM off (${JSON.stringify(kram)}) the owners still compose and approve says KRAM is required`, async () => {
    await run(function*() {
      const { a, runtime } = yield* wallet(() => ({ kram }));
      assert(runtime.ipex && runtime.operations, "owners compose without a KRAM option");
      assertThrows(() => runtime.ipex!.dhke(a).approve("Egrant"), ValidationError, "DH requires KRAM");
      assertThrows(() => runtime.ipex!.unblind(a).approve("Egrant"), ValidationError, "Unblind requires KRAM");
    });
  });
}

/** Store a KRAM-accepted v2 Grant between `from` and `to`; returns its exchange id. */
function stored(hby: Habery, from: Hab, to: Hab, { pending }: { pending: boolean }): string {
  const [grant] = exchange("/ipex/grant", { n: crypto.randomUUID() }, {
    sender: from.pre!,
    recipient: to.pre!,
    pvrsn: Vrsn_2_0,
  });
  const now = makeNowIso8601();
  (pending ? hby.db.epse : hby.db.exns).pin([grant.said!], grant);
  hby.db.tmsc.pin(
    [from.pre!, grant.said!, grant.said!],
    new TxnMsgCacheRecord({ mdt: now, d: 1000, ml: 5000, pml: 5000, xl: 300000, pxl: 300000, xdt: now, rdt: now }),
  );
  return grant.said!;
}

const owned = (runtime: { ipex: IpexAuxiliaries | null }) => [...runtime.ipex!.dhkeOwners()].map((o) => o.hab.pre);

Deno.test("a hab made after the runtime gets its owner at the first DH query, with none created before", async () => {
  await run(function*() {
    const { hby, remote, runtime } = yield* wallet();
    assertEquals(owned(runtime), []);
    const late = hby.makeHab("late");
    const xid = stored(hby, remote, late, { pending: true });
    const envelope = envelopeFromFrame(frame(remote, Dhke.Route, xid));
    assert(runtime.protocol.qvy!.claims!(envelope.serder));
    assertEquals(owned(runtime), [late.pre]);
    const seen: string[] = [];
    spyQueries([...runtime.ipex!.dhkeOwners()][0], "late", seen);
    assertEquals(runtime.protocol.qvy!.processQuery(envelope), { kind: "accept" });
    assertEquals(seen, ["late"]);
  });
});

Deno.test("two habs with the same remote and different exchange ids each get only their own DH owner", async () => {
  await run(function*() {
    const { hby, a, b, remote, runtime } = yield* wallet();
    const [xa, xb] = [stored(hby, remote, a, { pending: true }), stored(hby, remote, b, { pending: true })];
    assert(runtime.protocol.qvy!.claims!(envelopeFromFrame(frame(remote, Dhke.Route, xa)).serder));
    assertEquals(owned(runtime), [a.pre]);
    assert(runtime.protocol.qvy!.claims!(envelopeFromFrame(frame(remote, Dhke.Route, xb)).serder));
    assertEquals(owned(runtime), [a.pre, b.pre]);
    assertEquals(runtime.protocol.qvy!.claims!(envelopeFromFrame(frame(remote, Dhke.Route, "unknown")).serder), false);
  });
});

Deno.test("DH and Unblind resolve to one identifier from the Grants each kind involves", async () => {
  await run(function*() {
    const { hby, a, remote, runtime } = yield* wallet();
    const dh = stored(hby, remote, a, { pending: true }), unblind = stored(hby, a, remote, { pending: false });
    const ipex = runtime.protocol.qvy!;
    assert(ipex.claims!(envelopeFromFrame(frame(remote, Unblind.Route, unblind)).serder));
    assert(ipex.claims!(envelopeFromFrame(frame(remote, Dhke.Route, dh)).serder));
    assertEquals(owned(runtime), [a.pre]);
    assertEquals(ipex.claims!(envelopeFromFrame(frame(remote, Unblind.Route, dh)).serder), false);
    assertEquals(ipex.claims!(envelopeFromFrame(frame(remote, Dhke.Route, unblind)).serder), false);
  });
});

Deno.test("without DH traffic no owner is allocated, and an unclaimed or ambiguous message stays unowned", async () => {
  await run(function*() {
    const { hby, a, b, remote, runtime } = yield* wallet();
    assertEquals(owned(runtime), []);
    const ipex = runtime.protocol.qvy!;
    assertEquals(ipex.claims!(envelopeFromFrame(frame(remote, Dhke.Route, "nothing stored")).serder), false);
    assertEquals(owned(runtime), []);
    // Two local identifiers are both party to the same sender and exchange id.
    const [grant] = exchange("/ipex/grant", { n: "shared" }, {
      sender: remote.pre,
      recipient: a.pre!,
      pvrsn: Vrsn_2_0,
    });
    const [other] = exchange("/ipex/grant", { n: "shared" }, {
      sender: remote.pre,
      recipient: b.pre!,
      pvrsn: Vrsn_2_0,
    });
    for (const serder of [grant, other]) {
      hby.db.epse.pin([serder.said!], serder);
      const now = makeNowIso8601();
      hby.db.tmsc.pin(
        [remote.pre!, "shared", serder.said!],
        new TxnMsgCacheRecord({ mdt: now, d: 1000, ml: 5000, pml: 5000, xl: 300000, pxl: 300000, xdt: now, rdt: now }),
      );
    }
    assertEquals(ipex.claims!(envelopeFromFrame(frame(remote, Dhke.Route, "shared")).serder), false);
    assertEquals(owned(runtime), []);
  });
});

Deno.test("a stale owner is replaced when the Habery's identifier object differs", async () => {
  await run(function*() {
    const { hby, a, remote, runtime } = yield* wallet();
    const ipex = runtime.ipex!, xid = stored(hby, remote, a, { pending: true });
    const first = ipex.dhke(a);
    const reloaded = Object.create(a) as Hab;
    hby.habs.set(a.pre!, reloaded);
    try {
      assert(runtime.protocol.qvy!.claims!(envelopeFromFrame(frame(remote, Dhke.Route, xid)).serder));
      assert(ipex.dhke(reloaded) !== first && ipex.dhke(reloaded).hab === reloaded);
    } finally {
      hby.habs.set(a.pre!, a);
    }
  });
});

Deno.test("a local group's own contribution is routed to the group's DH owner, so KRAM can pool it", async () => {
  await run(function*() {
    const w = yield* world();
    const { runtime, group } = w.alice, ipex = runtime.protocol.qvy!;
    assertEquals(owned(runtime), []);
    const own = query(Dhke.Route, { x: "any-xid", pk: {} }, {
      pre: group!.pre!,
      replyRoute: Dhke.Route,
      pvrsn: Vrsn_2_0,
      kind: Kinds.json,
    });
    assert(ipex.claims!(own));
    assertEquals(owned(runtime), [group!.pre]);
    // A message from a non-local sender without stored state is not claimed.
    assertEquals(ipex.claims!(envelopeFromFrame(frame(w.bob.hab, Dhke.Route, "any-xid")).serder), false);
  });
});

Deno.test("a read-only Habery has no v2 registry store, so no owners and no operations", async () => {
  await run(function*() {
    const name = crypto.randomUUID();
    const writable = yield* createHabery({ name, temp: true, skipConfig: true, bran: "ReadOnlyPasscodeSecretAB" });
    writable.makeHab("a");
    const hby = yield* createHabery({
      name,
      temp: true,
      skipConfig: true,
      readonly: true,
      skipSignator: true,
      bran: "ReadOnlyPasscodeSecretAB",
    });
    yield* ensure(() => hby.close());
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {});
    yield* ensure(() => runtime.close());
    assertEquals([runtime.ipex, runtime.operations, runtime.rootReplicator], [null, null, null]);
    yield* writable.close(true);
  });
});
