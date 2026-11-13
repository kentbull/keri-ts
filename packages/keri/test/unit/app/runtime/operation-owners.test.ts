/**
 * Runtime wiring of the operations owners: owner composition, DH owners created at the first
 * message that addresses an identifier, one fiber per owner, and root replication as a runtime reaction.
 */
import { concatBytes, makeBlindState, parseBytes, SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race, run, sleep, spawn, suspend } from "effection";
import { assert, assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { publicOpeningAttachment } from "../../../../src/acdc/registering.ts";
import { prepareIpexExn } from "../../../../src/app/ipex/ipex-building.ts";
import { exchangeWire } from "../../../../src/app/ipex/ipex-discloser.ts";
import {
  approveIssuanceExchange,
  beginIssuance,
  issuanceStatus,
  pendingIssuanceGrants,
  proposeIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import type { DoerPacing } from "../../../../src/app/runtime/doing.ts";
import { operationOwnersDo, OWNER_TOCK_MS } from "../../../../src/app/runtime/operation-owners.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { DatabaseOperationError, ValidationError } from "../../../../src/core/errors.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";
import { rotate, seed, type Side, storeGrant, type World, world } from "../../../support/registry-root-world.ts";
import { scenario } from "../ipex/issuance-fixtures.ts";

function* until(condition: () => boolean, ms = 4000): Operation<void> {
  for (let waited = 0; !condition() && waited < ms; waited += 20) yield* sleep(20);
}

/** Run one side's postman and owners loops, as `runAgentRuntime` does; a shorter idle sleep keeps the tests quick. */
function* running(side: Side, pacing: DoerPacing = { tockMs: OWNER_TOCK_MS, sweepTocks: 1 }): Operation<void> {
  const { runtime } = side;
  yield* spawn(() => runtime.postman.deliverDo());
  yield* spawn(() =>
    operationOwnersDo({
      operations: runtime.operations!,
      rootReplicator: runtime.rootReplicator,
      ipex: runtime.ipex!,
      clock: runtime.clock,
    }, pacing)
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

const OWNERS = {};

Deno.test("a DH query that arrives before any explicit dhke(hab) call finds its owner", async () => {
  await run(function*() {
    const s = yield* scenario(1, undefined, false);
    const reg = yield* s.registry(0), ops = s.owner();
    yield* proposeIssuance(ops, {
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

Deno.test("owners compose with in-memory tables on every runtime that has a registry store", async () => {
  await run(function*() {
    const s = yield* scenario();
    assert(s.holder.runtime.operations && s.holder.runtime.rootReplicator);
    const w = yield* world();
    assert(
      w.alice.runtime.operations && w.alice.runtime.rootReplicator,
      "every runtime with a registry store composes them",
    );
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
    yield* sleep(3 * OWNER_TOCK_MS);
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
    yield* sleep(3 * OWNER_TOCK_MS);
    assertEquals(posted.length, 3, "one copy for the newcomer and one for the rekeyed member, once");
  });
});

Deno.test("a completed group rotation makes the new member's root copy due on the next owner tock", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, { ...OWNERS, newcomer: true });
    yield* seed(w);
    w.alice.rgy.store.retainOpening(w.event, w.opening);
    reachable(w.alice, w.bob);
    reachable(w.alice, w.outsider);
    // Only tock 0 sweeps, so a later copy is due only because the Counselor put the group on the replicator's deck.
    yield* running(w.alice, { tockMs: OWNER_TOCK_MS, sweepTocks: 1_000_000 });
    yield* until(() => posted.length >= 1);
    const current = [w.alice, w.bob, w.outsider];
    const said = yield* rotate(w, current, current, "2");
    const { counselor, hby } = w.alice.runtime;
    const event = { pre: w.gid, sn: hby.db.getKever(w.gid)!.sn, said };
    counselor.start(event);
    yield* counselor.processOnce();
    assert(counselor.complete(event));
    const sentTo = (recipient: Side) => hby.db.rrsn.get([w.gid, w.registry, recipient.hab.pre!]);
    yield* until(() => !!sentTo(w.outsider));
    assert(sentTo(w.outsider), "the member rotated in is sent its copy");
  });
});

Deno.test("an idle runtime passes every tock and reads no protocol store; the first pass scans once", async () => {
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
    yield* running(w.bob, { tockMs: 20, sweepTocks: 1_000_000 });
    yield* sleep(400);
    assertEquals(passes, { issuance: 1, presentation: 0, unblinding: 0 }, "only the one-time sweep of issuance ran");
    assertEquals([scans, retained], [1, 0], "one scan of the pending escrow, then no store reads by the owners");
    assertEquals(posted, []);
  });
});

Deno.test("an operation begun between tocks is picked up on the next tock, with no wake", async () => {
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
      }, { tockMs: 20, sweepTocks: 1_000_000 })
    );
    yield* sleep(50);
    assertEquals(passes, 1, "the one-time sweep, then idle");
    const reg = yield* s.registry(0);
    yield* proposeIssuance(issuance, {
      credential: reg.credential(),
      options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
    });
    yield* until(() => passes > 1, 1000);
    assert(passes > 1, "the next tock found the operation");
  });
});

Deno.test("a delivery that throws is retried, not failed, and the loop keeps serving", async () => {
  await run(function*() {
    const s = yield* scenario();
    const { operations, ipex } = s.issuer.runtime;
    // The runtime's own delivery path throws, as a Poster that refuses the wire does.
    (operations!.issuance.deps.delivery as { deliver: unknown }).deliver = function*() {
      throw new Error("refused");
    };
    yield* spawn(() =>
      operationOwnersDo({ operations: operations!, rootReplicator: null, ipex: ipex!, clock: s.clock }, {
        tockMs: 10,
        sweepTocks: 1_000_000,
      })
    );
    const reg = yield* s.registry(0);
    const { grant } = yield* proposeIssuance(operations!.issuance, {
      credential: reg.credential(),
      options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
    });
    yield* until(() => (operations!.issuance.liveOf(grant)?.outbox.attempts ?? 0) > 1, 1500);
    assert((operations!.issuance.liveOf(grant)?.outbox.attempts ?? 0) > 1, "the refusal is retried by the same loop");
    assertEquals(
      issuanceStatus(operations!.issuance, grant).state,
      "active",
      "a delivery failure does not end the issuance",
    );
  });
});

/**
 * Run `operation` and return what it threw, `"returned"`, or `"still running"` after `ms`. `call` is the error
 * boundary: a failed loop that `operation` spawned is thrown here, as it ends a host's scope.
 */
function* outcomeWithin(operation: () => Operation<unknown>, ms: number): Operation<unknown> {
  return yield* race([
    (function*(): Operation<unknown> {
      try {
        yield* call(operation);
        return "returned";
      } catch (error) {
        return error;
      }
    })(),
    (function*(): Operation<unknown> {
      yield* sleep(ms);
      return "still running";
    })(),
  ]);
}

Deno.test("a store fault in an operation owner ends the runtime", async () => {
  await run(function*() {
    const s = yield* scenario();
    const db = s.issuer.hby.db;
    // The issuance owner's first pass scans the pending exchange escrow; that read fails as a damaged store would.
    db.epse.getTopItemIter = () => {
      throw new DatabaseOperationError("pending exchange escrow is unreadable");
    };
    const ended = yield* outcomeWithin(() => runAgentRuntime(s.issuer.runtime, { pollMailbox: false }), 3000);
    assertInstanceOf(ended, DatabaseOperationError);
    assertEquals(ended.message, "pending exchange escrow is unreadable");
  });
});

Deno.test("closing the runtime during a pass is not reported as a fault", async () => {
  await run(function*() {
    const s = yield* scenario();
    const { operations } = s.issuer.runtime;
    let delivering = false;
    // A delivery that never returns keeps the issuance pass in flight until the runtime is halted.
    (operations!.issuance.deps.delivery as { deliver: unknown }).deliver = function*() {
      delivering = true;
      yield* suspend();
    };
    const worker = yield* spawn(() => runAgentRuntime(s.issuer.runtime, { pollMailbox: false }));
    const reg = yield* s.registry(0);
    yield* proposeIssuance(operations!.issuance, {
      credential: reg.credential(),
      options: { recipient: s.holder.habs[0].pre!, message: "Issue" },
    });
    yield* until(() => delivering);
    assert(delivering, "the owner pass is in flight");
    // The wallet's order: halt the runtime's loops mid-pass; scope exit then runs `runtime.close()` and closes the
    // stores. `run` rejects if the halt, the close or any other teardown threw.
    yield* worker.halt();
  });
});

Deno.test("a peer Grant with a non-canonical registry root ends that operation and nothing else", async () => {
  await run(function*() {
    const s = yield* scenario();
    const reg = yield* s.registry(0);
    const issued = reg.credential();
    // The issuer presents a credential whose registry is not a SAID; the holder escrows the Grant waiting for its TEL.
    const forged = new SerderACDC({ sad: { ...issued.sad!, rd: "notasaid" }, makify: true });
    const raw = messagize(forged, publicOpeningAttachment(makeBlindState({ acdc: forged.said!, state: "issued" })), {
      gvrsn: Vrsn_2_0,
    });
    const issuer = s.issuer.habs[0], holder = s.holder.habs[0];
    const [exn, nests] = yield* prepareIpexExn(issuer.pre!, "/ipex/grant", raw, {
      recipient: holder.pre!,
      message: "",
    });
    const support = s.owner().discloser.proofSupportFor(concatBytes(raw, issued.raw), [issuer.pre!]);
    yield* s.holder.runtime.reactor.processBytes(concatBytes(support, exchangeWire(issuer, exn, nests)));
    assert(s.holder.runtime.exc.retainedInput(exn.said!, { pending: true }), "the peer's Grant is held pending");
    // The holder's resumable-Grant sweep reads the registry of every pending Grant; this one names no held root.
    const ops = s.holderOwner();
    yield* ops.processOnce();
    assertEquals(ops.liveOps(), [], "the Grant is not resumable, so no operation is adopted");
    // It reads as any Grant awaiting consent, and consenting to its exchange is refused for this Grant alone.
    assertEquals(pendingIssuanceGrants(ops).map(({ grant }) => grant), [exn.said]);
    assertThrows(() => approveIssuanceExchange(ops, exn.said!), ValidationError);
    // The holder's runtime keeps running past the sweep that reads it.
    const ended = yield* outcomeWithin(() => runAgentRuntime(s.holder.runtime, { pollMailbox: false }), 500);
    assertEquals(ended, "still running");
  });
});
