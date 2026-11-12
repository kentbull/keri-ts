/**
 * Runtime wiring of the operations owners (`ipexOwners: "per-identifier"`): owner composition, DH owners created at the first
 * message that addresses an identifier, one fiber per owner, and root replication as a runtime reaction.
 */
import { parseBytes } from "cesr-ts";
import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { beginIssuance, issuanceStatus } from "../../../../src/app/ipex/issuance.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { operationOwnersDo, OWNER_BUSY_MS } from "../../../../src/app/runtime/operation-owners.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";
import { rotate, seed, type Side, storeGrant, type World, world } from "../../../support/registry-root-world.ts";
import { scenario } from "../ipex/issuance-fixtures.ts";

function* until(condition: () => boolean, ms = 4000): Operation<void> {
  for (let waited = 0; !condition() && waited < ms; waited += 20) yield* sleep(20);
}

/** Run one side's postman and owners loops, as `runAgentRuntime` does; a shorter idle sleep keeps the tests quick. */
function* running(side: Side, cadence = { idleMs: 100 }): Operation<void> {
  const { runtime } = side;
  yield* spawn(() => runtime.postman.deliverDo());
  yield* spawn(() =>
    operationOwnersDo({
      operations: runtime.operations!,
      rootReplicator: runtime.rootReplicator,
      ipex: runtime.ipex!,
      clock: runtime.clock,
    }, cadence)
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
    const owners = () => [...s.holder.runtime.ipex!.dhkeOwners()].map((owner) => owner.hab.pre);
    assert(s.holder.runtime.ipex!.claims(serder), "the held Grant lets its recipient claim the query");
    assertEquals(owners(), [s.holder.habs[0].pre], "the claimant is the recipient's owner");
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
    yield* sleep(3 * OWNER_BUSY_MS);
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
    yield* until(() => posted.length >= 1);
    assertEquals(posted.length, 1, "the loop's first pass sends the inception member its copy");
    const current = [w.alice, w.bob, w.outsider];
    yield* rotate(w, current, current, "2");
    yield* until(() => posted.length >= 3);
    yield* sleep(3 * OWNER_BUSY_MS);
    assertEquals(posted.length, 3, "one copy for the newcomer and one for the rekeyed member, once");
  });
});

Deno.test("an idle runtime passes at the idle cadence and reads no protocol store; the first pass scans once", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, OWNERS);
    yield* seed(w);
    const { operations } = w.bob.runtime, db = w.bob.hby.db;
    const passes = { issuance: 0, presentation: 0, unblinding: 0 };
    for (const name of Object.keys(passes) as (keyof typeof passes)[]) {
      const owner = operations![name], once = owner.processOnce.bind(owner);
      owner.processOnce = function*() {
        passes[name]++;
        yield* once();
      };
    }
    let scans = 0, retained = 0;
    const scan = db.epse.getTopItemIter.bind(db.epse), retain = w.bob.runtime.exc.retainedInput.bind(w.bob.runtime.exc);
    db.epse.getTopItemIter = function*(...args: Parameters<typeof scan>) {
      scans++;
      yield* scan(...args);
    };
    w.bob.runtime.exc.retainedInput = (...args: Parameters<typeof retain>) => {
      retained++;
      return retain(...args);
    };
    yield* running(w.bob, { idleMs: 20 });
    yield* sleep(400);
    assertEquals(passes, { issuance: 1, presentation: 0, unblinding: 0 }, "only the one-time sweep of issuance ran");
    assertEquals([scans, retained], [1, 0], "one scan of the pending escrow, then no store reads by the owners");
    assertEquals(posted, []);
  });
});

Deno.test("an operation begun while the loop idles is picked up at once, not at the next idle pass", async () => {
  await run(function*() {
    const s = yield* scenario();
    const { issuance } = s.issuer.runtime.operations!;
    let passes = 0;
    const once = issuance.processOnce.bind(issuance);
    issuance.processOnce = function*() {
      passes++;
      yield* once();
    };
    yield* spawn(() =>
      operationOwnersDo({
        operations: s.issuer.runtime.operations!,
        rootReplicator: null,
        ipex: s.issuer.runtime.ipex!,
        clock: s.clock,
      }, { idleMs: 60_000 })
    );
    yield* sleep(50);
    assertEquals(passes, 1, "the sweep, then idle");
    const reg = yield* s.registry(0);
    yield* beginIssuance(issuance, {
      hab: s.issuer.habs[0],
      credential: reg.credential(),
      options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
    });
    yield* until(() => passes > 1, 1000);
    assert(passes > 1, "begin woke the idle loop");
  });
});

Deno.test("a delivery that throws fails its operation and the loop keeps serving; an escaped fault is readable", async () => {
  await run(function*() {
    const s = yield* scenario();
    const { operations, ipex } = s.issuer.runtime;
    // The runtime's own delivery path throws, as a Poster that refuses the wire does.
    (operations!.issuance.deps.delivery as { deliver: unknown }).deliver = function*() {
      throw new Error("refused");
    };
    yield* spawn(() =>
      operationOwnersDo({ operations: operations!, rootReplicator: null, ipex: ipex!, clock: s.clock }, {
        busyMs: 10,
        idleMs: 20,
      })
    );
    const reg = yield* s.registry(0);
    const { grant } = yield* beginIssuance(operations!.issuance, {
      hab: s.issuer.habs[0],
      credential: reg.credential(),
      options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
    });
    yield* until(() => issuanceStatus(operations!.issuance, grant).state === "failed", 1500);
    assertEquals(issuanceStatus(operations!.issuance, grant), { state: "failed", role: "issuer", reason: "refused" });
    assertEquals(operations!.health.faults, 0, "an operation's own failure is not an owner fault");

    // Something no operation owns throws out of an owner pass: the loop survives and records it.
    const presentation = operations!.presentation;
    let faulted = false;
    presentation.active = () => !faulted;
    presentation.processOnce = function*() {
      faulted = true;
      throw new Error("unreadable state");
    };
    operations!.wake.notify();
    yield* until(() => operations!.health.faults > 0, 1500);
    assertEquals(operations!.health.last?.owner, "presentation");
    assertEquals(operations!.health.last?.error, "unreadable state");
    let passes = 0;
    const once = operations!.unblinding.processOnce.bind(operations!.unblinding);
    operations!.unblinding.active = () => true;
    operations!.unblinding.processOnce = function*() {
      passes++;
      yield* once();
    };
    yield* until(() => passes > 2, 1500);
    assert(passes > 2, "the other owners still run after a fault");
  });
});
