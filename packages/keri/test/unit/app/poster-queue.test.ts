import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { Roles } from "../../../src/core/roles.ts";

Deno.test("Poster completion belongs to a concrete admission and does not determine idle", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), first = hby.makeHab("first"), second = hby.makeHab("second");
    const posted: string[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(url, init) {
            await readCesrRequestBytes(new Request(url, init));
            posted.push(String(url));
            return new Response(null, { status: 204 });
          },
        },
      },
    });
    const postman = runtime.postman;
    try {
      for (const hab of [first, second]) {
        hby.db.locs.pin([hab.pre, "http"], { url: `https://${hab.name}.test/` });
        hby.db.ends.pin([hab.pre, Roles.controller, hab.pre], { allowed: true });
      }
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const args = { src: sender.pre, dest: first.pre, topic: "/reply", msg };
      const one = postman.send(args, { notify: true });
      const two = postman.send({ ...args, dest: second.pre }, { notify: true });
      const again = postman.send(args, { notify: true });
      assertEquals(posted, [], "admission is not transmission");
      assertEquals(postman.hasPending, true);
      yield* postman.process();
      assertEquals(postman.hasPending, false);
      assertEquals(postman.cues.length, 3);
      const later = yield* postman.wait(again);
      assertStrictEquals(later.evt, again);
      assertEquals(later.deliveries, ["https://first.test/"]);
      assertEquals(postman.cues.length, 2, "the earlier same-SAID outcome remains independent");
      const other = yield* postman.wait(two);
      assertStrictEquals(other.evt, two);
      assertEquals(other.deliveries, ["https://second.test/"]);
      assertStrictEquals((yield* postman.wait(one)).evt, one);
      assertEquals([postman.cues.length, postman.hasPending], [0, false]);
      assertEquals(posted, ["https://first.test/", "https://second.test/", "https://first.test/"]);

      const cancelled = postman.send(args, { notify: true });
      const waiter = yield* spawn(() => postman.wait(cancelled));
      yield* waiter.halt();
      postman.send(args);
      yield* postman.process();
      assertEquals(postman.cues.empty, true, "cancelled and fire-and-forget sends leave no completion history");
      assertEquals(postman.hasPending, false);

      const construction = new ValidationError("invalid constructed protocol message");
      postman.prepareBytesTarget = function*() {
        throw construction;
      };
      const broken = postman.send(args, { notify: true });
      const thrown = yield* call(() => assertRejects(() => run(() => postman.process())));
      assertStrictEquals(thrown, construction, "programming failures must escape the worker");
      const observed = yield* postman.wait(broken);
      assertEquals(observed.kin, "failed");
      if (observed.kin === "failed") assertStrictEquals(observed.error, construction);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
