/** `posterDelivery` hands the Poster whole wires, such as proof support plus a Grant, through a mailbox relay. */
import { concatBytes, parseBytes, SerderKERI } from "cesr-ts";
import { run, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { Poster } from "../../../../src/app/delivery/forwarding.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { posterDelivery } from "../../../../src/app/ipex/issuance.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { EndpointRoles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";

Deno.test("a multi-frame wire is delivered to a mailbox-forwarded destination as one ordered stream", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient"), relay = hby.makeHab("relay");
    hby.db.ends.pin([recipient.pre, EndpointRoles.mailbox, relay.pre], { allowed: true });
    hby.db.locs.pin([relay.pre, "http"], { url: "http://relay.test/" });
    const forwarded: unknown[] = [];
    const postman = new Poster(
      hby,
      null,
      null,
      httpClient(async (url, init) => {
        for (const frame of parseBytes(await readCesrRequestBytes(new Request(url, init)))) {
          const outer = frame.body;
          if (outer instanceof SerderKERI && outer.route === "/fwd") {
            forwarded.push((frame.nests?.[0]?.body as SerderKERI).ked?.q);
          }
        }
        return new Response(null, { status: 204 });
      }),
      systemClock,
    );
    try {
      // Two complete messages in one wire, as the issuer's proof support and Grant are.
      const wire = concatBytes(
        ...["0", "1"].map((s) => sender.query(sender.pre, sender.pre, { route: "logs", q: { s } })),
      );
      const task = yield* spawn(() =>
        posterDelivery(postman).deliver({ src: sender.pre, dest: recipient.pre, msg: wire })
      );
      yield* postman.process();
      assertEquals(yield* task, ["http://relay.test/"]);
      assertEquals(forwarded.map((q) => (q as { s: string }).s), ["0", "1"]);
      assert(forwarded.length === 2);
    } finally {
      yield* postman.close();
      yield* hby.close(true);
    }
  });
});
