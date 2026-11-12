/** IpexDiscloser prepares exchange wires, proof support and fresh-issuance refusals with no wallet inventory. */
import { parseBytes, type SerderACDC } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { acdcmap, regcept } from "../../../../src/acdc/messaging.ts";
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

      const exn = ipexExnBody(hab.pre, "/ipex/apply", [], { message: "", recipient: hab.pre, plan: [] });
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
        yield* discloser.prepareIssuanceGrantBody(
          "Eunknown",
          acdcmap(hab.pre, { regid: regcept(hab.pre).said!, attribute: { d: "", i: hab.pre } }),
          {
            message: "",
            recipient: hab.pre,
            plan: [],
          },
        );
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
          ipexExnBody(hab.pre, "/ipex/apply", [], { message: "", recipient: hab.pre, plan: [] }),
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

/** Expose the protected graph and view helpers a subclass composes into its own selection. */
class Probe extends IpexDiscloser {
  reduce(credential: SerderACDC, paths?: readonly string[]) {
    return this.partial(credential, paths);
  }
  require(origin: string, raw: Uint8Array) {
    this.requireGraph(origin, raw);
  }
}

Deno.test("IpexDiscloser prepares Apply, keeps the whole view without paths and refuses incomplete evidence", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = hby.makeHab("sender"), registry = new RegistryStore(baser);
      const discloser = new Probe(hby, registry, new Exchanger(hby), receiptorFor(hby));

      const apply = yield* discloser.prepareApply(hab.pre, { message: "", recipient: hab.pre, plan: [] });
      assertEquals(apply.exn.route, "/ipex/apply");
      assertEquals(parseBytes(apply.wire)[0].body.said, apply.exn.said);
      let unknown: unknown;
      try {
        yield* discloser.prepareApply("Eunknown", { message: "", recipient: hab.pre, plan: [] });
      } catch (error) {
        unknown = error;
      }
      assert(unknown instanceof ValidationError);

      const credential = acdcmap(hab.pre, {
        regid: regcept(hab.pre).said!,
        attribute: { d: "", i: hab.pre, name: "Alice", role: "holder" },
      });
      assertEquals(discloser.reduce(credential), credential);
      assertThrows(
        () => discloser.registryProof(credential, "Eunknown"),
        ValidationError,
        "registry history is required",
      );
      assertThrows(
        () => discloser.unblind({ u: { nonce: "" } } as never, credential.said!, []),
        ValidationError,
        "possessed disclosure UUID",
      );
      assertThrows(() => discloser.require(credential.said!, new Uint8Array()), Error);
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
