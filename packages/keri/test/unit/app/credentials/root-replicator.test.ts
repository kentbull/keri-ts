/**
 * `RootReplicator` derives owed `/registry/root` copies from state (held roots, current
 * members, the `rrsn.` sent marker) and sends them without a command; the Dhke cue only prompts it.
 *
 * Runs over the shared real-object registry-root world. Copies are posted through each side's
 * real Poster to a capturing HTTP client; delivery to the recipient is done from the capture.
 */
import { type Operation, run, spawn } from "effection";
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import type { RootCopyResult } from "../../../../src/app/credentials/root-replicating.ts";
import { replicateRegistryRoots, replicateRootCopies } from "../../../../src/app/credentials/root-replicating.ts";
import { RootReplicator, RootSendsPerPass } from "../../../../src/app/credentials/root-replicator.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { rootCopyLine } from "../../../../src/cli/messaging/root-copy-lines.ts";
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

function replicator(side: Side, changes?: MemoryChangeSink) {
  const { root, runtime } = side;
  return new RootReplicator({ root, postman: runtime.postman, clock: runtime.clock, changes });
}

/** One processing pass while the side's Poster delivers. */
function* pass(side: Side, replicating: RootReplicator): Operation<RootCopyResult[]> {
  const delivering = yield* spawn(() => side.runtime.postman.deliverDo());
  try {
    return yield* replicating.processOnce();
  } finally {
    yield* delivering.halt();
  }
}

const recipients = (reports: readonly RootCopyResult[]) => reports.map(report => [report.recipient, report.kin]);
const markers = (side: Side) => [...side.hby.db.rrsn.getTopItemIter()].map(([keys]) => keys.join("/"));

Deno.test("root replicator: a Dhke cue prompts a pass that sends and records the copy once", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    const changes = new MemoryChangeSink(), replicating = replicator(w.alice, changes);
    replicating.replicate({ gid: w.gid, registries: [w.registry] });
    const reports = yield* pass(w.alice, replicating);
    assertEquals(recipients(reports), [[w.bob.hab.pre, "sent"]]);
    assertEquals(replicating.status().owed, []);
    assertEquals(posted.map(said), reports.map(report => report.exchange));
    assertEquals(changes.changes.at(0), { kind: "group", id: w.gid });
    yield* receive(w.bob, posted[0]);
    assertEquals(held(w, w.bob)?.qb64, w.root.qb64);
    assertEquals(stored(w.bob), []);
    // Recorded: nothing owed, nothing sent.
    assertEquals(markers(w.alice), [[w.gid, w.registry, w.bob.hab.pre].join("/")]);
    assertEquals(yield* pass(w.alice, replicating), []);
    assertEquals(posted.length, 1);
  });
});

Deno.test("root replicator: a crash after retention and before the send is recovered from state, and a second process sends nothing", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    // The first process retained the root, cued, and died: no replicator, no cue deck survives.
    replicator(w.alice).replicate({ gid: w.gid, registries: [w.registry] });
    assertEquals(posted, []);
    const restarted = replicator(w.alice);
    assertEquals(recipients(yield* pass(w.alice, restarted)), [[w.bob.hab.pre, "sent"]]);
    // A later process over the same stores finds the marker.
    const another = replicator(w.alice);
    assertEquals(yield* pass(w.alice, another), []);
    assertEquals(another.status().owed, []);
    assertEquals(posted.length, 1);
  });
});

Deno.test("root replicator: a group-issued registry's custodian sends its root", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    const issued = yield* issueRegistry(w, "group-issued-rt1", { group: true });
    yield* storeGrant(w.alice, [issued.acdc]);
    reachable(w.alice, w.bob);
    const replicating = replicator(w.alice);
    yield* pass(w.alice, replicating);
    yield* receive(w.bob, posted[0]);
    assertEquals(w.bob.hby.mgr.getRegistryRoot(w.gid, issued.registry)?.qb64, issued.root.qb64);
  });
});

Deno.test("root replicator: a deferred or undelivered copy stays owed, backs off, and a later pass sends it", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    const replicating = replicator(w.alice);
    // No hint evidence yet: reported, kept, nothing sent.
    const [deferred] = yield* pass(w.alice, replicating);
    assertEquals(deferred.kin, "deferred");
    const [owed] = replicating.status().owed;
    assertEquals([owed.registry, owed.recipient, owed.attempts], [w.registry, w.bob.hab.pre, 1]);
    assertStringIncludes((owed.lastFailure as Error).message, "no held opening or stored Grant");
    // Backoff: the very next pass does not retry it, a prompt does.
    yield* storeGrant(w.alice, [w.credential]);
    assertEquals(yield* pass(w.alice, replicating), []);
    replicating.prompt(w.gid);
    yield* pass(w.alice, replicating);
    assertStringIncludes((replicating.status().owed[0].lastFailure as Error).message, "No end roles");
    assertEquals(posted, []);
    // Bob becomes reachable: the same copy is sent and recorded.
    reachable(w.alice, w.bob);
    replicating.prompt(w.gid);
    assertEquals((yield* pass(w.alice, replicating)).map(report => report.kin), ["sent"]);
    assertEquals(replicating.status().owed, []);
    assertEquals(posted.length, 1);
  });
});

Deno.test("root replicator: overlapping passes and an explicit send do not double-send", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    const replicating = replicator(w.alice);
    const delivering = yield* spawn(() => w.alice.runtime.postman.deliverDo());
    try {
      const first = yield* spawn(() => replicating.processOnce());
      const second = yield* spawn(() => replicating.processOnce());
      const explicit = yield* spawn(() => replicating.send(w.alice.group!, [w.registry], { timeoutMs: 30_000 }));
      const all = [...yield* first, ...yield* second, ...yield* explicit];
      assertEquals(all.map(report => report.kin), ["sent"]);
    } finally {
      yield* delivering.halt();
    }
    assertEquals(posted.length, 1);
  });
});

Deno.test("root replicator: a newcomer and a rekeyed member get a re-sealed copy after an accepted rotation, once", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, { newcomer: true });
    yield* seed(w);
    w.alice.rgy.store.retainOpening(w.event, w.opening);
    reachable(w.alice, w.bob);
    reachable(w.alice, w.outsider);
    const replicating = replicator(w.alice);
    assertEquals(recipients(yield* pass(w.alice, replicating)), [[w.bob.hab.pre, "sent"]]);
    const current = [w.alice, w.bob, w.outsider];
    yield* rotate(w, current, current, "2");
    const reports = yield* pass(w.alice, replicating);
    assertEquals(
      new Set(recipients(reports).map(([aid]) => aid)),
      new Set([w.bob.hab.pre, w.outsider.hab.pre]),
      "the rekeyed member and the newcomer",
    );
    assertEquals(reports.map(report => report.kin), ["sent", "sent"]);
    // A restarted replicator, and further passes, owe nothing more.
    assertEquals(yield* pass(w.alice, replicator(w.alice)), []);
    assertEquals(yield* pass(w.alice, replicating), []);
    for (const wire of posted.slice(1)) {
      const to = reports.find(report => report.exchange === said(wire))!.recipient;
      yield* receive(w.sides.find(side => side.hab.pre === to)!, wire);
    }
    assertEquals(new Set(current.map(side => held(w, side)?.qb64)), new Set([w.root.qb64]));
    // Every root holder sends: the newcomer now holds the root but has no hint evidence, so its copies stay owed.
    const newcomer = replicator(w.outsider);
    assertEquals((yield* pass(w.outsider, newcomer)).map(report => report.kin), ["deferred", "deferred"]);
    assertEquals(newcomer.status().owed.map(copy => copy.attempts), [1, 1]);
  });
});

Deno.test("root replicator: an existing store with an old rotation sends one copy per member once, a few per pass", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted, { newcomer: true });
    yield* seed(w);
    w.alice.rgy.store.retainOpening(w.event, w.opening);
    reachable(w.alice, w.bob);
    reachable(w.alice, w.outsider);
    const current = [w.alice, w.bob, w.outsider];
    yield* rotate(w, current, current, "2");
    // No marker exists, as in a store from before the table: every other member is sent a copy once.
    const replicating = replicator(w.alice);
    const reports = yield* pass(w.alice, replicating);
    assertEquals(reports.length, 2);
    assert(reports.length <= RootSendsPerPass);
    assertEquals(yield* pass(w.alice, replicating), []);
    assertEquals(posted.length, 2);
  });
});

Deno.test("root replicator: markers of a departed group or recipient are pruned, and hold only identifiers and a public key", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    reachable(w.alice, w.bob);
    const rrsn = w.alice.hby.db.rrsn, stray = { key: "Dstray", dt: "2026-01-01T00:00:00.000000+00:00" };
    rrsn.pin([w.issuer.hab.pre!, w.registry, w.bob.hab.pre!], stray);
    rrsn.pin([w.gid, w.registry, w.issuer.hab.pre!], stray);
    yield* pass(w.alice, replicator(w.alice));
    assertEquals(markers(w.alice), [[w.gid, w.registry, w.bob.hab.pre].join("/")]);
    const raw = new TextDecoder().decode(
      rrsn.db.getVal(rrsn.sdb, new TextEncoder().encode([w.gid, w.registry, w.bob.hab.pre].join(".")))!,
    );
    const record = JSON.parse(raw);
    assertEquals(Object.keys(record).sort(), ["dt", "key"]);
    assertEquals(record.key, w.alice.root.contributor(w.gid, w.bob.hab.pre!));
    assert(!raw.includes(w.root.qb64) && !raw.includes(w.root.qb64.slice(1)), "no root in the marker");
  });
});

Deno.test("root replicating: typed results keep the error and map to the legacy root_copy lines", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    const { root, runtime, group } = w.alice, args = [root, runtime.postman, runtime.clock, group!] as const;
    const delivering = yield* spawn(() => runtime.postman.deliverDo());
    try {
      for (const reachability of [false, true]) {
        if (reachability) reachable(w.alice, w.bob);
        const [typed] = yield* replicateRootCopies(...args, [w.registry], { timeoutMs: 30_000 });
        const [legacy] = yield* replicateRegistryRoots(...args, [w.registry], { timeoutMs: 30_000 });
        assertEquals(typed.kin, reachability ? "sent" : "failed");
        assertEquals(typed.error instanceof Error, !reachability);
        // The CLI line is today's line: same fields in the same order, apart from the per-send exchange.
        const { exchange: _typed, ...line } = rootCopyLine(typed), { exchange: _legacy, ...old } = legacy;
        assertEquals(JSON.stringify(line), JSON.stringify(old));
        assertEquals(line.recovery, reachability ? undefined : "tufa vc registry root send");
      }
    } finally {
      yield* delivering.halt();
    }
  });
});
