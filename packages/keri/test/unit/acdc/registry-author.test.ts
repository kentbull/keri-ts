/** RegistryAuthor stages, anchors and advances v2 registry state with no credential inventory. */
import { bytesEqual } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { RegistryAuthor } from "../../../src/acdc/authoring.ts";
import { RegistryCustody } from "../../../src/acdc/custody.ts";
import { createRegery } from "../../../src/acdc/registraring.ts";
import type { Habery } from "../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import type { Receiptor } from "../../../src/app/witness/receipting.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { openLmdbRegistry } from "../../../src/db/lmdb-stores.ts";

/** An unwitnessed habitat has no receipts to collect; the real Receiptor needs a live protocol owner. */
function noWitnesses(hby: Habery): Receiptor {
  return { hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
}

Deno.test("RegistryAuthor incepts, retries a pending public update, anchors it and advances state", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const rgy = yield* createRegery({ hby, baser }), hab = hby.makeHab("issuer");
      const author = new RegistryAuthor(rgy, noWitnesses(hby));
      assertThrows(() => author.registry("missing", hab.pre), ValidationError, "Unknown registry");

      const rip = yield* author.incept("reg", hab.pre);
      const reg = author.registry("reg", hab.pre);
      assertEquals(rip.said, reg.regk);
      assertThrows(() => author.registry("reg", "Edifferent"), ValidationError, "different controller");
      assert(bytesEqual((yield* author.incept("reg", hab.pre)).raw, rip.raw)); // Idempotent.

      const acdc = author.create(reg, { issuee: hab.pre, attribute: { role: "holder" } });
      assertThrows(() => author.stage(reg, acdc, "issued"), ValidationError, "provisioned registry custody");
      const staged = author.stage(reg, acdc, "issued", { public: true });
      assertEquals(staged.event.ilk, "bup");
      assertEquals(reg.store.seqEvent(reg.regk!, 1), null); // Staged is not accepted.
      assertEquals(author.stage(reg, acdc, "issued", { public: true }).event.said, staged.event.said);

      yield* author.anchor(reg, staged.event);
      assert(bytesEqual(reg.store.seqEvent(reg.regk!, 1)!.raw, staged.event.raw));

      const revoked = yield* author.update(reg, acdc, "revoked", { public: true });
      assertEquals(revoked.sad!.n, "2");
      assert(bytesEqual(reg.store.seqEvent(reg.regk!, 2)!.raw, revoked.raw));
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("RegistryAuthor refuses receipt owners and custody that are not its registry environment's", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const other = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    const foreign = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const rgy = yield* createRegery({ hby, baser }), hab = hby.makeHab("issuer");
      assertThrows(() => new RegistryAuthor(rgy, noWitnesses(other)), ValidationError, "receipt owner");
      const store = new Map();
      const custody = new RegistryCustody({
        hby,
        hab,
        registry: (yield* createRegery({ hby, baser: foreign })).store,
        store: { get: (event) => store.get(event) ?? null, pin: (event, value) => void store.set(event, value) },
      });
      assertThrows(() => new RegistryAuthor(rgy, noWitnesses(hby), custody), ValidationError, "actual owners");
    } finally {
      yield* foreign.close(true);
      yield* baser.close(true);
      yield* other.close(true);
      yield* hby.close(true);
    }
  });
});
