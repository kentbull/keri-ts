/**
 * Registry root copies carry a per-registry verification hint the sender has checked.
 *
 * Ports the KERIpy kentbull/keripy root-replication tests in tests/acdc/test_registry_root.py
 * (33287d3f per-registry hints and self-check, 66e0800c nested Grant hints) over the shared
 * real-object world. Grants are stored as the Exchanger stores them (`exns` plus `enst` rows),
 * the only evidence the hint search reads.
 */
import { makeBlindUuid } from "cesr-ts";
import { call, ensure, run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { registryRoot } from "../../../../tufa/src/cli/commands/registry-root.ts";
import { RootUnverified } from "../../../src/acdc/salting.ts";
import { ValidationError } from "../../../src/core/errors.ts";
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
