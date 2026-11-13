/** Registry custody derives blinds from the Keeper root and retains only coordinates in its port. */
import { MtrDex, Signer } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { type DerivedUpdate, type DerivedUpdateStore, RegistryCustody } from "../../../src/acdc/custody.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { vetBlind } from "../../../src/acdc/regeventing.ts";
import { RegistryStore } from "../../../src/acdc/registering.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { openLmdbRegistry } from "../../../src/db/lmdb-stores.ts";

/** In-memory port: the embedder owns durability, the core owns derivation. */
class MemoryUpdates implements DerivedUpdateStore {
  readonly rows = new Map<string, DerivedUpdate>();
  get(event: string): DerivedUpdate | null {
    return this.rows.get(event) ?? null;
  }
  pin(event: string, value: DerivedUpdate): void {
    this.rows.set(event, value);
  }
}

Deno.test("RegistryCustody reproduces an accepted BUP opening from the Keeper root and port coordinates", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const registry = new RegistryStore(baser), hab = hby.makeHab("issuer"), store = new MemoryUpdates();
      const custody = new RegistryCustody({ hby, hab, registry, store });
      assertThrows(() => custody.createCustody("unprovisioned"), ValidationError, "encrypted Keeper");
      const key = new Signer({
        code: MtrDex.Ed25519_Seed,
        raw: crypto.getRandomValues(new Uint8Array(32)),
        transferable: false,
      });
      hby.mgr.updateAeid(key.verfer.qb64, key.qb64);

      const observer = new RegistryObserver(hby.db, registry), rip = regcept(hab.pre);
      hab.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
      assertEquals(observer.processEvent(rip).kind, "accept");
      assertThrows(() => custody.derive(rip.said!, 1, "", ""), ValidationError, "not provisioned");
      assertEquals(custody.createCustody(rip.said!), { registry: rip.said });
      assertThrows(() => custody.derive(rip.said!, 0, "", ""), ValidationError, "positive integer");

      const credential = acdcmap(hab.pre, { regid: rip.said!, attribute: { d: "", i: hab.pre } });
      const proof = custody.derive(rip.said!, 1, credential.said!, "issued");
      const update = blindate(rip.said!, rip.said!, proof.d.nonce);
      assertThrows(() => custody.derivedOpening(update), ValidationError, "accepted registry event is required");

      assertEquals(custody.retainDerivedUpdate(update, proof), {
        credential: credential.said!,
        state: "issued",
        bound: null,
      });
      assertEquals(store.rows.size, 1);
      custody.retainDerivedUpdate(update, proof); // Identical coordinates are an idempotent retry.

      hab.interact({ data: [{ i: rip.said!, s: "1", d: update.said! }] });
      assertEquals(observer.processEvent(update).kind, "accept");
      assert(vetBlind(custody.derivedOpening(update), proof.d.nonce));

      const other = custody.derive(rip.said!, 1, credential.said!, "revoked");
      assertThrows(() => custody.retainDerivedUpdate(update, other), ValidationError, "authenticated BUP opening");
      store.rows.set(update.said!, { credential: "Edifferent", state: "issued", bound: null });
      assertThrows(() => custody.retainDerivedUpdate(update, proof), ValidationError, "Different derivation");
      store.rows.clear();
      assertThrows(() => custody.derivedOpening(update), ValidationError, "coordinates are unavailable");
      // A member that consented to the update retained nothing: it derives the issuance opening from the credential.
      assertThrows(
        () =>
          custody.issuedOpening(
            update,
            acdcmap(hab.pre, { regid: rip.said!, attribute: { d: "", i: hab.pre, n: "2" } }).said!,
          ),
        ValidationError,
        "not this credential's issuance",
      );
      assert(vetBlind(custody.issuedOpening(update, credential.said!), proof.d.nonce));
      assertEquals(store.rows.get(update.said!), { credential: credential.said!, state: "issued", bound: null });
      assert(
        vetBlind(custody.issuedOpening(update, credential.said!), proof.d.nonce),
        "then it reads the retained row",
      );
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("RegistryCustody refuses a habitat that is not the Habery's actual local owner", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const other = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = other.makeHab("foreign");
      assertThrows(
        () => new RegistryCustody({ hby, hab, registry: new RegistryStore(baser), store: new MemoryUpdates() }),
        ValidationError,
        "actual local habitat",
      );
    } finally {
      yield* baser.close(true);
      yield* other.close(true);
      yield* hby.close(true);
    }
  });
});
