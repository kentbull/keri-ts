/**
 * Registry root copies carry a per-registry verification hint the sender has checked.
 *
 * Ports the KERIpy kentbull/keripy root-replication tests in tests/acdc/test_registry_root.py
 * (33287d3f per-registry hints and self-check, ccf157fc issuance-completion sends, 66e0800c
 * nested Grant hints) over the shared real-object world. Copies are posted through each side's
 * real Poster to a capturing HTTP client and delivered from there. Grants are stored as the Exchanger stores them (`exns` plus `enst` rows),
 * the only evidence the hint search reads.
 */
import { makeBlindUuid } from "cesr-ts";
import { call, ensure, type Operation, run, spawn } from "effection";
import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { registryRoot } from "../../../../tufa/src/cli/commands/registry-root.ts";
import { RootUnverified } from "../../../src/acdc/salting.ts";
import {
  replicateRegistryRoots,
  RootCopyRecovery,
  type RootCopyReport,
} from "../../../src/app/credentials/root-replicating.ts";
import { readCesrRequestBytes } from "../../../src/app/transport/cesr-http.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { Roles } from "../../../src/core/roles.ts";
import { httpClient } from "../../support/http-client.ts";
import {
  copy,
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
} from "../../support/registry-root-world.ts";

/** A world whose every posted copy is captured, in order, instead of reaching a network. */
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

/** Run `side`'s automatic replication for its group while its Poster delivers. */
function* replicate(
  side: Side,
  registries: readonly string[],
  options: { recipients?: readonly string[]; timeoutMs?: number } = {},
): Operation<RootCopyReport[]> {
  const delivering = yield* spawn(() => side.runtime.postman.deliverDo());
  try {
    return yield* replicateRegistryRoots(side.root, side.runtime.postman, side.runtime.clock, side.group!, registries, {
      timeoutMs: 30_000,
      ...options,
    });
  } finally {
    yield* delivering.halt();
  }
}

/** The uuid `side`'s retained root derives for the registry's head BUP. */
function uuid(side: Side, gid: string, registry: string): string {
  const root = side.hby.mgr.getRegistryRoot(gid, registry)!;
  return makeBlindUuid({ salt: root.qb64, sn: 1 }).qb64;
}

/** Give Alice a second individual-issuer registry root: two roots, each with its own ACDC. */
function* twoRegistries(w: World) {
  yield* seed(w);
  const second = yield* issueRegistry(w, "public-test-rot2");
  yield* receive(
    w.alice,
    w.issuer.root.prepare(w.issuer.hab, w.alice.hab.pre!, w.gid, second.registry, { td: second.acdc.said! }),
  );
  assertEquals(held(w, w.alice, w.gid)?.qb64, w.root.qb64);
  assertEquals(w.alice.hby.mgr.getRegistryRoot(w.gid, second.registry)?.qb64, second.root.qb64);
  return { [w.registry]: w.credential, [second.registry]: second.acdc };
}

Deno.test("registry root replication: multi-registry copies derive their own hint and verify on arrival", async () => {
  await run(function*() {
    const w = yield* world();
    const acdcs = yield* twoRegistries(w);
    const regks = Object.keys(acdcs).sort();
    // Alice holds no opening; her stored Grant disclosing both ACDCs is her only evidence.
    yield* storeGrant(w.alice, Object.values(acdcs));
    for (const regk of regks) {
      const bup = w.alice.rgy.store.headEvent(regk)!;
      assertEquals(w.alice.root.hint(w.gid, regk, uuid(w.alice, w.gid, regk), bup), acdcs[regk].said);
      // One hint for every registry, the old newcomers behavior, fails the self-check.
      const wrong = regks.find(other => other !== regk)!;
      assertThrows(
        () => w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, regk, { td: acdcs[wrong].said! }),
        ValidationError,
        "does not reproduce",
      );
      yield* receive(w.bob, w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, regk, { hinted: true }));
    }
    // Each copy verified by its own derived hint: retained on arrival, nothing pending.
    assertEquals(stored(w.bob), []);
    assertEquals(w.bob.root.held(w.gid), regks);
  });
});

Deno.test("registry root replication: an automatic copy without local hint evidence is not sent", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    // Alice holds the root but no opening and no Grant for this registry.
    assertThrows(
      () => w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry, { hinted: true }),
      RootUnverified,
      "no held opening or stored Grant",
    );
    // A manual send without a hint still seals an unverifiable copy, as before.
    const pending = w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry);
    yield* receive(w.bob, pending);
    assertEquals(stored(w.bob), [said(pending)]);
    // An override that does not reproduce the commitment is never sealed.
    assertThrows(
      () => w.alice.root.prepare(w.alice.hab, w.bob.hab.pre!, w.gid, w.registry, { td: w.registry }),
      ValidationError,
      "does not reproduce",
    );
  });
});

Deno.test("registry root replication: a held opening, else a Grant nested in a stored proposal, is the hint", async () => {
  await run(function*() {
    const w = yield* world();
    yield* seed(w);
    yield* copy(w, w.alice, w.bob);
    const bup = w.alice.rgy.store.headEvent(w.registry)!;
    // A held opening is the first hint source.
    w.alice.rgy.store.retainOpening(w.event, w.opening);
    assertEquals(w.alice.root.hint(w.gid, w.registry, uuid(w.alice, w.gid, w.registry), bup), w.acdc);
    // Bob holds only a received copy; the Grant nested in the /multisig/exn proposal he signed is his evidence.
    assertEquals(w.bob.root.hint(w.gid, w.registry, uuid(w.bob, w.gid, w.registry), bup), null);
    yield* storeGrant(w.bob, [w.credential], { wrapped: true });
    assertEquals(w.bob.root.hint(w.gid, w.registry, uuid(w.bob, w.gid, w.registry), bup), w.acdc);
    w.bob.root.prepare(w.bob.hab, w.alice.hab.pre!, w.gid, w.registry, { hinted: true });
  });
});

Deno.test("registry root replication: Tufa newcomers seals each registry with its own derived hint", async () => {
  await run(function*() {
    const w = yield* world({ newcomer: true });
    const acdcs = yield* twoRegistries(w);
    yield* storeGrant(w.alice, Object.values(acdcs));
    const current = [w.alice, w.bob, w.outsider];
    const rotation = yield* rotate(w, current, current, "2");
    const directory = yield* call(() => Deno.makeTempDir({ prefix: "tufa-registry-root-" }));
    yield* ensure(() => call(() => Deno.remove(directory, { recursive: true })));
    const out = `${directory}/newcomers.cesr`;
    yield* registryRoot(w.alice.runtime, w.alice.group!, {
      verb: "newcomers",
      rotation,
      registries: [],
      recipients: [],
      listen: false,
      messages: [],
      timeoutMs: 30_000,
      out,
    });
    yield* receive(w.outsider, yield* call(() => Deno.readFile(out)));
    assertEquals(stored(w.outsider), []);
    assertEquals(w.outsider.root.held(w.gid), Object.keys(acdcs).sort());
  });
});

Deno.test("registry root replication: issuance completion sends every root to every other member", async () => {
  await run(function*() {
    // Holder group: Alice retains both registries' roots and the Grant disclosing them.
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    const acdcs = yield* twoRegistries(w);
    const regks = Object.keys(acdcs).sort();
    yield* storeGrant(w.alice, Object.values(acdcs));
    reachable(w.alice, w.bob);
    const reports = yield* replicate(w.alice, regks);
    assertEquals(
      reports.map(report => [report.registry, report.sender, report.recipient, report.transmitted]),
      regks.map(regk => [regk, w.alice.hab.pre, w.bob.hab.pre, true]),
    );
    assertEquals(posted.map(said), reports.map(report => report.exchange));
    // Duplicate copies, as several senders may produce, are harmless.
    for (const wire of [...posted, ...posted]) yield* receive(w.bob, wire);
    assertEquals(stored(w.bob), []);
    assertEquals(w.bob.root.held(w.gid), regks);
  });
  await run(function*() {
    // Issuer group: the group issued the registry and Alice, its custodian, retains the root.
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    const issued = yield* issueRegistry(w, "group-issued-rt1", { group: true });
    yield* storeGrant(w.alice, [issued.acdc]);
    reachable(w.alice, w.bob);
    const reports = yield* replicate(w.alice, [issued.registry]);
    assertEquals(reports.map(report => [report.recipient, report.transmitted]), [[w.bob.hab.pre, true]]);
    for (const wire of posted) yield* receive(w.bob, wire);
    assertEquals(w.bob.hby.mgr.getRegistryRoot(w.gid, issued.registry)?.qb64, issued.root.qb64);
    assertEquals(stored(w.bob), []);
  });
});

Deno.test("registry root replication: a copy that cannot be sent is reported and never raises", async () => {
  await run(function*() {
    const posted: Uint8Array[] = [];
    const w = yield* posting(posted);
    yield* seed(w);
    yield* storeGrant(w.alice, [w.credential]);
    // Bob has no end role at Alice, so the Poster attempt fails.
    const [failed] = yield* replicate(w.alice, [w.registry]);
    assertEquals([failed.recipient, failed.transmitted, failed.recovery], [w.bob.hab.pre, false, RootCopyRecovery]);
    assertStringIncludes(failed.error!, "No end roles");
    assertEquals(posted, []);
    // A registry with no accepted BUP is reported, not sent, and does not stop the others.
    reachable(w.alice, w.bob);
    const reports = yield* replicate(w.alice, [w.registry, w.event.said!]);
    assertEquals(reports.map(report => [report.registry, report.transmitted]), [
      [w.registry, true],
      [w.event.said!, false],
    ]);
    assertEquals(posted.length, 1);
    // An exhausted budget reports every copy unsent.
    const late = yield* replicate(w.alice, [w.registry], { timeoutMs: 0 });
    assertEquals(late.map(report => report.transmitted), [false]);
    assertStringIncludes(late[0].error!, "budget");
    assertEquals(posted.length, 1);
  });
});
