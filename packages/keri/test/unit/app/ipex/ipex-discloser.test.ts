/** IpexDiscloser prepares exchange wires, proof support and fresh-issuance refusals with no wallet inventory. */
import { parseBytes } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { RegistryStore } from "../../../../src/acdc/registering.ts";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import type { Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import { anchorExchange, exchangeWire, IpexDiscloser } from "../../../../src/app/ipex/ipex-discloser.ts";
import type { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

/** The preparations under test never reach witnesses; the real Receiptor needs a live protocol owner. */
function receiptorFor(hby: Habery): Receiptor {
  return { hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
}

Deno.test("IpexDiscloser frames public KEL support and a signed exchange wire from borrowed owners", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = hby.makeHab("sender"), registry = new RegistryStore(baser);
      const discloser = new IpexDiscloser(hby, registry, new Exchanger(hby), receiptorFor(hby));

      const kel = parseBytes(discloser.kel(hab));
      assertEquals(kel.map((frame) => frame.body.said), [hab.kever!.serder.said]);
      assertEquals(parseBytes(discloser.proofSupport(new Uint8Array(), hab)).map((frame) => frame.body.said), [
        hab.kever!.serder.said,
      ]);

      const exn = ipexExnBody(hab.pre, "/ipex/apply", [], { message: "", recipient: hab.pre });
      const [frame] = parseBytes(exchangeWire(hab, exn));
      assertEquals(frame.body.said, exn.said);
      assert(frame.attachments.length > 0);
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("IpexDiscloser refuses foreign owners and unselectable fresh issuance", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const other = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = hby.makeHab("sender"), registry = new RegistryStore(baser), exc = new Exchanger(hby);
      assertThrows(
        () => new IpexDiscloser(hby, registry, exc, receiptorFor(other)),
        ValidationError,
        "receipt owner",
      );
      const discloser = new IpexDiscloser(hby, registry, exc, receiptorFor(hby));
      let refusal: unknown;
      try {
        yield* discloser.prepareIssuanceGrantBody("Eunknown", {} as never, { message: "", recipient: hab.pre });
      } catch (error) {
        refusal = error;
      }
      assert(refusal instanceof ValidationError);
      assertEquals(refusal.message.startsWith("Fresh issuance requires an exact v2 credential"), true);

      let foreign: unknown;
      try {
        yield* anchorExchange(
          hby,
          receiptorFor(other),
          hab,
          ipexExnBody(hab.pre, "/ipex/apply", [], { message: "", recipient: hab.pre }),
        );
      } catch (error) {
        foreign = error;
      }
      assert(foreign instanceof ValidationError);
    } finally {
      yield* baser.close(true);
      yield* other.close(true);
      yield* hby.close(true);
    }
  });
});
