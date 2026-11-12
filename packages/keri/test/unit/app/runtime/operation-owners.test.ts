/**
 * Runtime wiring of the operations owners (`ipexOwners: "per-identifier"`): owner composition, DH owners for every
 * local identifier before traffic, one fiber per owner, and root replication as a runtime reaction.
 */
import { parseBytes } from "cesr-ts";
import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { MemoryRootLedger } from "../../../../src/app/credentials/root-replicator.ts";
import { beginIssuance } from "../../../../src/app/ipex/issuance.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { operationOwnersDo, OWNER_LOOP_MS } from "../../../../src/app/runtime/operation-owners.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";
import { rotate, seed, type Side, storeGrant, type World, world } from "../../../support/registry-root-world.ts";
import { scenario } from "../ipex/issuance-fixtures.ts";

function* until(condition: () => boolean, ms = 4000): Operation<void> {
  for (let waited = 0; !condition() && waited < ms; waited += 20) yield* sleep(20);
}

/** Run one side's postman and owners loops, as `runAgentRuntime` does. */
function* running(side: Side): Operation<void> {
  const { runtime } = side;
  yield* spawn(() => runtime.postman.deliverDo());
  yield* spawn(() =>
    operationOwnersDo({
      operations: runtime.operations!,
      rootReplicator: runtime.rootReplicator,
      ipex: runtime.ipex!,
      clock: runtime.clock,
    })
  );
}

function reachable(from: Side, to: Side): void {
  from.hby.db.locs.pin([to.hab.pre!, "https"], { url: `https://${to.name}.test/` });
  from.hby.db.ends.pin([to.hab.pre!, Roles.controller, to.hab.pre!], { allowed: true });
}

function* posting(posted: Uint8Array[], options: Parameters<typeof world>[0] = {}): Operation<World> {
  return yield* world({
    ...options,
    http: httpClient(async (url, init) => {
      posted.push(await readCesrRequestBytes(new Request(url, init)));
      return new Response(null, { status: 204 });
    }),
  });
}

const OWNERS = { runtime: { ipexOwners: "per-identifier" as const } };

Deno.test("a DH query that arrives before any explicit dhke(hab) call finds its owner", async () => {
  await run(function*() {
    const s = yield* scenario(1, undefined, false);
    const reg = yield* s.registry(0), ops = s.owner();
    yield* beginIssuance(ops, {
      hab: s.issuer.habs[0],
      credential: reg.credential(),
      options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
    });
    yield* ops.processOnce();
    const query = s.log.find((sent) => new TextDecoder().decode(sent.msg).includes("/ipex/dhke"))!;
    const serder = envelopeFromFrame(parseBytes(query.msg)[0]).serder;
    const owners = [...s.holder.runtime.ipex!.dhkeOwners()].map((owner) => owner.hab.pre);
    assertEquals(owners, [s.holder.habs[0].pre], "the owner exists without an explicit call");
    assert(s.holder.runtime.ipex!.claims(serder), "the held Grant lets that owner claim the query");
    // An identifier created after the runtime gets its owner at the next DH dispatch.
    const late = s.holder.hby.makeHab("late");
    s.holder.runtime.ipex!.claims(serder);
    assert([...s.holder.runtime.ipex!.dhkeOwners()].some((owner) => owner.hab.pre === late.pre));
  });
});

Deno.test("owners compose with in-memory stores and expose themselves additively; legacy runtimes have none", async () => {
  await run(function*() {
    const s = yield* scenario();
    assert(s.holder.runtime.operations && s.holder.runtime.rootReplicator);
    const w = yield* world();
    assertEquals([w.alice.runtime.operations, w.alice.runtime.rootReplicator], [null, null]);
  });
});

Deno.test("runtime loop: a Dhke completion cue sends the owed copy with no explicit call", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, OWNERS);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    yield* running(w.alice);
    w.alice.runtime.ipex!.dhke(w.alice.group!).replicated.push({ gid: w.gid, registries: [w.registry] });
    yield* until(() => posted.length > 0);
    assertEquals(posted.length, 1);
    yield* sleep(3 * OWNER_LOOP_MS);
    assertEquals(posted.length, 1, "a settled copy is not sent again");
  });
});

Deno.test("runtime loop: an accepted rotation that adds a member re-seals the held root", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, { ...OWNERS, newcomer: true });
    yield* seed(w);
    w.alice.rgy.store.retainOpening(w.event, w.opening);
    reachable(w.alice, w.bob);
    reachable(w.alice, w.outsider);
    yield* running(w.alice);
    yield* sleep(2 * OWNER_LOOP_MS);
    assertEquals(posted.length, 0, "an inception owes nothing");
    const current = [w.alice, w.bob, w.outsider];
    yield* rotate(w, current, current, "2");
    yield* until(() => posted.length >= 2);
    assertEquals(posted.length, 2, "one copy for the newcomer and one for the rekeyed member");
  });
});

Deno.test("with rootReplication off nothing is sent, and an idle loop is bounded by its cadence", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const ledger = new MemoryRootLedger();
    const w = yield* posting(posted, {
      runtime: { ipexOwners: "per-identifier", operationStores: { rootReplication: "off", rootLedger: ledger } },
    });
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    assertEquals(w.alice.runtime.rootReplicator, null);
    yield* running(w.alice);
    w.alice.runtime.ipex!.dhke(w.alice.group!).replicated.push({ gid: w.gid, registries: [w.registry] });
    yield* sleep(5 * OWNER_LOOP_MS);
    assertEquals(posted, []);
    assertEquals(ledger.owed(), []);

    // Idle cost: with nothing owed or in progress an owner is polled once per cadence, not spun.
    let passes = 0;
    const issuance = w.bob.runtime.operations!.issuance, once = issuance.processOnce.bind(issuance);
    issuance.processOnce = function*() {
      passes++;
      yield* once();
    };
    yield* running(w.bob);
    yield* sleep(10 * OWNER_LOOP_MS + 20);
    assert(passes >= 5 && passes <= 14, `idle passes ${passes}`);
    assertEquals(posted, []);
  });
});
