import { SerderKERI } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { sendExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";

import { Roles } from "../../../src/core/roles.ts";

Deno.test("standalone exchange sender waits for its queued attempt and reports HTTP refusal", async () => {
  const arrived = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let refuse = false;
  const received: SerderKERI[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
    received.push(new SerderKERI({ raw: new Uint8Array(await req.arrayBuffer()) }));
    arrived.resolve();
    await release.promise;
    return new Response(null, { status: refuse ? 503 : 204 });
  });
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
        const url = `http://127.0.0.1:${server.addr.port}/`;
        hby.db.ends.pin([recipient.pre, Roles.controller, recipient.pre], { allowed: true });
        hby.db.locs.pin([recipient.pre, "http"], { url });
        let returned = false;
        const sending = yield* spawn(function*() {
          const result = yield* sendExchangeMessage(
            hby,
            sender,
            new FetchHttpClient(),
            systemClock,
            {
              dest: recipient.pre,
              route: "/test/queued",
              payload: { purpose: "completion" },
            },
          );
          returned = true;
          return result;
        });
        yield* call(() => arrived.promise);
        assertEquals(returned, false, "enqueueing does not finish the standalone command");
        release.resolve();
        const sent = yield* sending;
        assertEquals(sent.deliveries, [url]);
        assertEquals(received[0].said, sent.serder.said);
        refuse = true;
        const error = yield* call(() =>
          assertRejects(() =>
            run(() =>
              sendExchangeMessage(hby, sender, new FetchHttpClient(), systemClock, {
                dest: recipient.pre,
                route: "/test/refused",
                payload: {},
              })
            )
          )
        );
        assertInstanceOf(error, CesrHttpRefusal);
        assertEquals(error.status, 503);
        assertEquals(received.length, 2, "standalone sends make one attempt without automatic retries");
      } finally {
        release.resolve();
        yield* hby.close(true);
      }
    });
  } finally {
    release.resolve();
    await server.shutdown();
  }
});
