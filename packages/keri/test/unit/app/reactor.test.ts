import { run } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { Cigar } from "../../../../cesr/mod.ts";
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

Deno.test("app/reactor - reply parsing normalizes non-transferable receipt couples into runtime cigars with verfer", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-nontrans-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const reactor = new Reactor(hby);
      let seenCigar: unknown = null;

      reactor.revery.processReply = ((args) => {
        seenCigar = args.cigars?.[0] ?? null;
      }) as typeof reactor.revery.processReply;

      reactor.ingest(
        hab.makeLocScheme("http://127.0.0.1:9723/", hab.pre, "http"),
      );
      reactor.processOnce();

      assertInstanceOf(seenCigar, Cigar);
      const captured = seenCigar as Cigar;
      assertEquals(captured.verfer?.qb64, hab.pre);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("app/reactor - reloaded reply cigars are rehydrated with verifier context before runtime dispatch", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-reload-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const ingestingReactor = new Reactor(hby);
      ingestingReactor.ingest(
        hab.makeLocScheme("http://127.0.0.1:9724/", hab.pre, "http"),
      );
      ingestingReactor.processOnce();

      const replay = hab.loadLocScheme(hab.pre, "http");
      assertExists(replay);
      assertEquals(replay.length > 0, true);

      const replayReactor = new Reactor(hby);
      let seenCigar: unknown = null;
      replayReactor.revery.processReply = ((args) => {
        seenCigar = args.cigars?.[0] ?? null;
      }) as typeof replayReactor.revery.processReply;

      replayReactor.ingest(replay);
      replayReactor.processOnce();

      assertInstanceOf(seenCigar, Cigar);
      const captured = seenCigar as Cigar;
      assertEquals(captured.verfer?.qb64, hab.pre);
    } finally {
      yield* hby.close();
    }
  });
});
