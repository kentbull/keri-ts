/** Per-identifier IPEX auxiliary owners: registry, dispatch by transaction, KRAM invariant and legacy option. */
import { Diger, Kinds, parseBytes, Vrsn_2_0 } from "cesr-ts";
import { ensure, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { Dhke } from "../../../../src/acdc/dhking.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import { Unblind } from "../../../../src/acdc/unblinding.ts";
import type { Hab } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import {
  type AgentRuntimeOptions,
  createAgentRuntime,
  runAgentRuntime,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { query, reply } from "../../../../src/core/protocol-eventing.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

const KRAM = { enabled: true } as const;
const STATES = ["issued", "revoked", ""];

/** One wallet Habery with two local identifiers, one remote sender, and a runtime over them. */
function* wallet(
  options: (habs: { a: Hab; b: Hab }) => Partial<AgentRuntimeOptions> = () => ({
    ipexOwners: "per-identifier",
    kram: KRAM,
  }),
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

/** Stand in for an approved operation, which is what makes an owner claim a transaction. */
function approve(owner: Dhke | Unblind, xid: string) {
  (owner as unknown as { operations: Map<string, unknown> }).operations.set(xid, {});
}

Deno.test("per-identifier owners are created once per identifier and kind, and released", async () => {
  await run(function*() {
    const { a, b, runtime } = yield* wallet();
    const ipex = runtime.ipex!;
    assert(ipex.dhke(a) === ipex.dhke(a));
    assertNotEquals(ipex.dhke(a), ipex.dhke(b));
    assert(ipex.unblind(a, STATES) === ipex.unblind(a, STATES));
    assertEquals(ipex.dhke(a).hab, a);
    assertEquals(ipex.unblind(a, STATES).hab, a);
    assertThrows(() => ipex.unblind(a, ["issued"]), ValidationError, "different states");
    const before = ipex.dhke(a);
    ipex.release(a.pre!);
    assertNotEquals(ipex.dhke(a), before, "a released identifier gets a fresh owner");
    assertEquals(runtime.ipexAuxiliary, null);
  });
});

Deno.test("each identifier receives only its own DH queries, and both kinds coexist on one identifier", async () => {
  await run(function*() {
    const { a, b, remote, runtime } = yield* wallet();
    const ipex = runtime.ipex!;
    const seen: string[] = [];
    spyQueries(ipex.dhke(a), "dhke-a", seen);
    spyQueries(ipex.dhke(b), "dhke-b", seen);
    spyQueries(ipex.unblind(a, STATES), "unblind-a", seen);
    approve(ipex.dhke(a), "xid-a");
    approve(ipex.dhke(b), "xid-b");
    approve(ipex.unblind(a, STATES), "xid-u");
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

Deno.test("a message for an identifier with no owner is handled as without any owner", async () => {
  await run(function*() {
    const { a, remote, runtime } = yield* wallet();
    const plain = yield* wallet(() => ({}));
    approve(runtime.ipex!.dhke(a), "xid-a");
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
      approve(owner, `xid-${tag}`);
    }
    for (const xid of ["xid-b", "xid-a"]) {
      const serder = reply(Dhke.Route, { x: xid, pk: {} }, { pre: remote.pre, pvrsn: Vrsn_2_0, kind: Kinds.json });
      runtime.protocol.rvy.rtr.dispatch({ serder, diger: new Diger({ qb64: serder.said! }) });
    }
    assertEquals(seen, ["b", "a"]);
    yield* worker.halt();
  });
});

Deno.test("the legacy single owner is the registry's owner and other identifiers stay unowned", async () => {
  await run(function*() {
    const { a, remote, runtime } = yield* wallet(({ a }) => ({
      kram: KRAM,
      ipexAuxiliary: { kind: "unblind", hab: a, states: STATES },
    }));
    const owner = runtime.ipexAuxiliary!.owner;
    assertEquals(runtime.ipexAuxiliary!.kind, "unblind");
    assert(owner === runtime.ipex!.unblind(a, STATES));
    assert(runtime.protocol.qvy === runtime.ipex);
    const seen: string[] = [];
    spyQueries(owner, "legacy", seen);
    approve(owner, "xid-a");
    runtime.protocol.qvy!.processQuery(envelopeFromFrame(frame(remote, Unblind.Route, "xid-a")));
    assertEquals(seen, ["legacy"]);
    const other = yield* runtime.protocol.dispatch(frame(remote, Unblind.Route, "xid-other"));
    assertEquals(other.decision, { kind: "drop", reason: "missingProcessor" });
    const dhke = yield* runtime.protocol.dispatch(frame(remote, Dhke.Route, "xid-a"));
    assertEquals(dhke.decision, { kind: "drop", reason: "missingProcessor" });
  });
});

for (const kram of [undefined, { enabled: false }]) {
  Deno.test(`owners require explicitly enabled KRAM (${JSON.stringify(kram)})`, async () => {
    await assertRejects(
      () =>
        run(function*() {
          yield* wallet(({ a }) => ({ ipexOwners: "per-identifier", kram, ipexAuxiliary: { kind: "dhke", hab: a } }));
        }),
      ValidationError,
      "IPEX auxiliary runtime requires explicitly enabled KRAM",
    );
    await assertRejects(
      () =>
        run(function*() {
          yield* wallet(() => ({ ipexOwners: "per-identifier", kram }));
        }),
      ValidationError,
      "IPEX auxiliary runtime requires explicitly enabled KRAM",
    );
  });
}
