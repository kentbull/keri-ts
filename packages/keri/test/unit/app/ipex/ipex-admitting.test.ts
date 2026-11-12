/** IpexAdmitter refuses unconsented, unaccepted and misaddressed Admit preparation with no wallet. */
import { type Operation, run } from "effection";
import { assert } from "jsr:@std/assert";
import { RegistryStore } from "../../../../src/acdc/registering.ts";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { IpexAdmitter } from "../../../../src/app/ipex/ipex-admitting.ts";
import { IpexDiscloser } from "../../../../src/app/ipex/ipex-discloser.ts";
import type { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

Deno.test("IpexAdmitter refuses to prepare an Admit without consent or an accepted Grant", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const hab = hby.makeHab("holder"), admitter = new IpexAdmitter(hby, new RegistryStore(baser), new Exchanger(hby));
      const refusal = function*(attempt: () => Operation<unknown>, message: string) {
        let error: unknown;
        try {
          yield* attempt();
        } catch (caught) {
          error = caught;
        }
        assert(error instanceof ValidationError, message);
        assert(error.message.includes(message), `${error.message} / ${message}`);
      };
      yield* refusal(() => admitter.prepareAdmitBody("Egrant", hab.pre), "Explicit consent is required.");
      yield* refusal(() => admitter.prepareAdmit("Egrant", hab.pre), "Explicit consent is required.");
      yield* refusal(
        () => admitter.prepareAdmitBody("Egrant", hab.pre, { consent: true, gvrsn: { major: 1, minor: 0 } }),
        "attachment genus 2",
      );
      yield* refusal(
        () => admitter.prepareAdmitBody("Egrant", hab.pre, { consent: true }),
        "Accepted ACDC v2 exchange at the exact route is required.",
      );
      yield* refusal(
        () => admitter.prepareAdmit("Egrant", "Eunknown", { consent: true }),
        "intended local holder",
      );
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("IpexDiscloser inspects only one exact unanchored v2 Grant file", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    try {
      const receiptor = { hby } as unknown as Receiptor;
      const discloser = new IpexDiscloser(hby, new RegistryStore(baser), new Exchanger(hby), receiptor);
      let error: unknown;
      try {
        discloser.inspectGrantFile(new Uint8Array());
      } catch (caught) {
        error = caught;
      }
      assert(error instanceof ValidationError && error.message.includes("one exact unanchored v2 Grant"));
    } finally {
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
