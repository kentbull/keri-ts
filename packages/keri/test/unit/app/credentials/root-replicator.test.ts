/**
 * `RootReplicator` turns the Dhke completion cue and an accepted group rotation into owed
 * `/registry/root` copies in the embedder's ledger and sends them without a command.
 *
 * Runs over the shared real-object registry-root world. Copies are posted through each side's
 * real Poster to a capturing HTTP client; delivery to the recipient is done from the capture.
 */
import { type Operation, run, spawn } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import type { RootCopyReport } from "../../../../src/app/credentials/root-replicating.ts";
import {
  MemoryRootLedger,
  type OwedCopy,
  RootReplicator,
} from "../../../../src/app/credentials/root-replicator.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";
import {
  held,
  issueRegistry,
  receive,
  rotate,
  said,
  seed,
  type Side,
  stored,
  storeGrant,
  type World,
  world,
} from "../../../support/registry-root-world.ts";

function* posting(posted: Uint8Array[], options: Parameters<typeof world>[0] = {}): Operation<World> {
  return yield* world({
    ...options,
    http: httpClient(async (url, init) => {
      posted.push(await readCesrRequestBytes(new Request(url, init)));
      return new Response(null, { status: 204 });
    }),
  });
}

/** Give `from` a controller endpoint for `to`, so its Poster can deliver to `to`. */
function reachable(from: Side, to: Side): void {
  from.hby.db.locs.pin([to.hab.pre!, "https"], { url: `https://${to.name}.test/` });
  from.hby.db.ends.pin([to.hab.pre!, Roles.controller, to.hab.pre!], { allowed: true });
}

function replicator(side: Side, ledger = new MemoryRootLedger(), changes?: MemoryChangeSink) {
  const { root, runtime } = side;
  return new RootReplicator({ root, postman: runtime.postman, clock: runtime.clock, ledger, changes });
}

/** One processing pass while the side's Poster delivers. */
function* pass(side: Side, replicating: RootReplicator): Operation<RootCopyReport[]> {
  const delivering = yield* spawn(() => side.runtime.postman.deliverDo());
  try {
    return yield* replicating.processOnce();
  } finally {
    yield* delivering.halt();
  }
}

const coordinates = (owed: readonly OwedCopy[]) => owed.map(({ registry, recipient }) => [registry, recipient]);

Deno.test("root replicator: a Dhke cue owes the other members and a pass sends and settles it", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    const ledger = new MemoryRootLedger(), changes = new MemoryChangeSink();
    const replicating = replicator(w.alice, ledger, changes);
    const cue = { gid: w.gid, registries: [w.registry] };
    assertEquals(replicating.replicate(cue), 1);
    assertEquals(replicating.replicate(cue), 0, "a duplicate cue does not double-owe");
    assertEquals(coordinates(ledger.owed()), [[w.registry, w.bob.hab.pre]]);
    assertEquals(ledger.owed()[0].rotation, null);
    assertEquals(changes.changes, [{ kind: "group", id: w.gid }]);
    const reports = yield* pass(w.alice, replicating);
    assertEquals(reports.map(report => [report.recipient, report.transmitted]), [[w.bob.hab.pre, true]]);
    assertEquals(ledger.owed(), []);
    assertEquals(replicating.status().owed, []);
    assertEquals(posted.map(said), reports.map(report => report.exchange));
    yield* receive(w.bob, posted[0]);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
    // Nothing owed, nothing sent.
    assertEquals(yield* pass(w.alice, replicating), []);
    assertEquals(posted.length, 1);
  });
});

Deno.test("root replicator: a group-issued registry's custodian replicates its root", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    const issued = yield* issueRegistry(w, "group-issued-rt1", { group: true });
    yield* storeGrant(w.alice, [issued.acdc]);
    reachable(w.alice, w.bob);
    const replicating = replicator(w.alice);
    assertEquals(replicating.replicate({ gid: w.gid, registries: [issued.registry] }), 1);
    yield* pass(w.alice, replicating);
    yield* receive(w.bob, posted[0]);
    assertEquals(w.bob.hby.mgr.getRegistryRoot(w.gid, issued.registry)?.qb64, issued.root.qb64);
  });
});

Deno.test("root replicator: a deferred or undelivered copy stays owed and a later pass sends it", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    const replicating = replicator(w.alice);
    replicating.replicate({ gid: w.gid, registries: [w.registry] });
    // No hint evidence yet: reported, kept, nothing sent.
    const [deferred] = yield* pass(w.alice, replicating);
    assertEquals(deferred.transmitted, false);
    const [owed] = replicating.status().owed;
    assertEquals([owed.registry, owed.recipient], [w.registry, w.bob.hab.pre]);
    assertStringIncludes(owed.lastFailure!, "no held opening or stored Grant");
    // Evidence arrives but Bob has no end role: the Poster fails, the row stays.
    yield* storeGrant(w.alice, [w.credential]);
    yield* pass(w.alice, replicating);
    assertStringIncludes(replicating.status().owed[0].lastFailure!, "No end roles");
    assertEquals(posted, []);
    // Bob becomes reachable: the same row is sent and settled.
    reachable(w.alice, w.bob);
    const [sent] = yield* pass(w.alice, replicating);
    assertEquals(sent.transmitted, true);
    assertEquals(replicating.status().owed, []);
    assertEquals(posted.length, 1);
  });
});

Deno.test("root replicator: a restarted replicator resumes the copies its ledger still owes", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    const ledger = new MemoryRootLedger();
    // The first process owes the copy and dies before sending.
    replicator(w.alice, ledger).replicate({ gid: w.gid, registries: [w.registry] });
    assertEquals(posted, []);
    const restarted = replicator(w.alice, ledger);
    assertEquals(restarted.status().owed.map(copy => copy.recipient), [w.bob.hab.pre]);
    yield* pass(w.alice, restarted);
    assertEquals(posted.length, 1);
    assertEquals(ledger.owed(), []);
  });
});

Deno.test("root replicator: a copy that can never be authorized is dropped, not retried", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    const ledger = new MemoryRootLedger(), replicating = replicator(w.alice, ledger);
    // The issuer is not a signing member of the holder group.
    ledger.owe({ group: w.gid, registry: w.registry, recipient: w.issuer.hab.pre!, rotation: null });
    const [report] = yield* pass(w.alice, replicating);
    assertStringIncludes(report.error!, "not a current signing member");
    assertEquals(ledger.owed(), []);
    assertEquals(posted, []);
  });
});

Deno.test("root replicator: a member holding no root owes nothing", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, { newcomer: true });
    yield* seed(w);
    const ledger = new MemoryRootLedger();
    // Bob holds no root, so neither the cue nor the rotation scan owes anything for him.
    const replicating = replicator(w.bob, ledger);
    assertEquals(replicating.replicate({ gid: w.gid, registries: [w.registry] }), 0);
    const current = [w.alice, w.bob, w.outsider];
    const rotation = yield* rotate(w, current, current, "2");
    assertEquals(yield* pass(w.bob, replicating), []);
    assertEquals([ledger.owed(), ledger.examined(w.gid, rotation)], [[], true]);
  });
});

Deno.test("root replicator: the scan owes an accepted rotation once, to newcomers and rekeyed members", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, { newcomer: true });
    yield* seed(w);
    w.alice.rgy.store.retainOpening(w.event, w.opening);
    reachable(w.alice, w.bob);
    reachable(w.alice, w.outsider);
    const ledger = new MemoryRootLedger(), replicating = replicator(w.alice, ledger);
    replicating.scan();
    assertEquals(ledger.owed(), [], "an inception owes nothing");
    const current = [w.alice, w.bob, w.outsider];
    const rotation = yield* rotate(w, current, current, "2");
    replicating.scan();
    assertEquals(coordinates(ledger.owed()), [[w.registry, w.bob.hab.pre], [w.registry, w.outsider.hab.pre]]);
    assertEquals(ledger.owed().map(copy => copy.rotation), [rotation, rotation]);
    assertEquals(ledger.examined(w.gid, rotation), true);
    // A restarted replicator over the same ledger does not examine it again.
    replicator(w.alice, ledger).scan();
    assertEquals(ledger.owed().length, 2);
    const reports = yield* pass(w.alice, replicating);
    assertEquals(reports.map(report => report.transmitted), [true, true]);
    assertEquals(ledger.owed(), []);
    // Settled copies are not re-owed by a later pass.
    assertEquals(yield* pass(w.alice, replicating), []);
    for (const [index, wire] of posted.entries()) {
      yield* receive(w.sides.find(side => side.hab.pre === reports[index].recipient)!, wire);
    }
    assertEquals(new Set(current.map(side => held(w, side)?.qb64)), new Set([w.root.qb64]));
    assertEquals([stored(w.bob), stored(w.outsider)], [[], []]);
    // The newcomer held no prior key, so it re-seals nothing.
    const newcomer = replicator(w.outsider);
    assertEquals(yield* pass(w.outsider, newcomer), []);
    assertEquals(newcomer.status(), { owed: [], examinations: [] });
  });
});
