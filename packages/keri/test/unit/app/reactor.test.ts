import { run } from "effection";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

Deno.test("app/reactor - reply parsing normalizes transferable groups into dispatch value objects", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const reactor = new Reactor(hby);
      let seenTsg: TransIdxSigGroup | null = null;

      reactor.revery.processReply = ((args) => {
        seenTsg = args.tsgs?.[0] ?? null;
      }) as typeof reactor.revery.processReply;

      reactor.ingest(hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true));
      reactor.processOnce();

      assertInstanceOf(seenTsg, TransIdxSigGroup);
      if (!seenTsg) {
        throw new Error("Expected normalized transferable signature group.");
      }
      const captured = seenTsg as TransIdxSigGroup;
      assertEquals(captured.pre, hab.pre);
      assertEquals(captured.sigers.length, 1);
    } finally {
      yield* hby.close();
    }
  });
});
