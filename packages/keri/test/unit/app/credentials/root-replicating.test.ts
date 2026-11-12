/** Registry root copies are delivered in order with one outcome each; a failure does not stop later copies. */
import { run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertStrictEquals, assertStringIncludes } from "jsr:@std/assert";
import { deliverRegistryRoots } from "../../../../src/app/credentials/root-replicating.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";
import { said, world } from "../../../support/registry-root-world.ts";

Deno.test("root replicating: a failed middle copy is reported while later copies are still sent", async () => {
  await run(function*() {
    const posted: string[] = [];
    const w = yield* world({
      http: httpClient(async (url, init) => {
        posted.push(said(await readCesrRequestBytes(new Request(url, init))));
        return new Response(null, { status: 204 });
      }),
    });
    const { issuer, alice, bob } = w;
    // Only Alice has a reachable endpoint; Bob has no end role.
    issuer.hby.db.locs.pin([alice.hab.pre!, "https"], { url: "https://alice.test/" });
    issuer.hby.db.ends.pin([alice.hab.pre!, Roles.controller, alice.hab.pre!], { allowed: true });
    const copies = [alice, bob, alice].map(side => ({
      recipient: side.hab.pre!,
      wire: issuer.root.prepare(issuer.hab, side.hab.pre!, w.gid, w.registry, { td: w.acdc }),
    }));
    const delivering = yield* spawn(() => issuer.runtime.postman.deliverDo());
    try {
      const outcomes = yield* deliverRegistryRoots(issuer.runtime.postman, issuer.hab.pre!, copies);
      assertEquals(outcomes.map(outcome => outcome.kin), ["sent", "failed", "sent"]);
      outcomes.forEach((outcome, index) => assertStrictEquals(outcome.copy, copies[index]));
      const failed = outcomes[1];
      if (failed.kin !== "failed") throw new Error("expected a failed copy");
      assertInstanceOf(failed.error, ValidationError);
      assertStringIncludes(failed.error.message, `No end roles for ${bob.hab.pre}`);
      assertEquals(posted, [said(copies[0].wire), said(copies[2].wire)]);
    } finally {
      yield* delivering.halt();
    }
  });
});
