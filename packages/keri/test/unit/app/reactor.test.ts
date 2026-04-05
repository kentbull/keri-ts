import { run } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { Cigar, Diger } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { TransIdxSigGroup, TransReceiptQuadruple } from "../../../src/core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../../../src/core/eventing.ts";
import { makeQuerySerder } from "../../../src/core/messages.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("app/reactor - query parsing normalizes transferable last-establishment endorsements into source plus sigers", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-qry-ssg-${crypto.randomUUID()}`,
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
      let seen: QueryEnvelope | null = null;

      reactor.kevery.processQuery = ((envelope) => {
        seen = envelope;
      }) as typeof reactor.kevery.processQuery;

      reactor.ingest(hab.query(hab.pre, hab.pre, {}, "ksn"));
      reactor.processOnce();

      if (!seen) {
        throw new Error("Expected normalized query envelope.");
      }
      const captured = seen as QueryEnvelope;
      assertEquals(captured.source?.qb64, hab.pre);
      assertEquals(captured.sigers?.length, 1);
      assertEquals(captured.cigars?.length ?? 0, 0);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("app/reactor - cloned events replay attached non-transferable receipt couples into Kevery", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `reactor-clone-couples-src-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const remote = yield* createHabery({
      name: `reactor-clone-couples-remote-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const receiptor = source.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      const recordingKvy = new Kevery(source.db, { local: true, lax: true });
      recordingKvy.processAttachedReceiptCouples({
        serder: event,
        cigars: receiptor.sign(event.raw, false),
        firner: controller.kever?.fner,
        local: true,
      });
      assertEquals(source.db.rcts.get(dgKey(controller.pre, event.said)).length, 1);

      const reactor = new Reactor(remote);
      for (const msg of source.db.clonePreIter(controller.pre, 0)) {
        reactor.ingest(msg);
      }
      reactor.processOnce();

      assertEquals(remote.db.rcts.get(dgKey(controller.pre, event.said)).length, 1);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("app/reactor - cloned events replay attached transferable receipt quadruples into Kevery", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `reactor-clone-trqs-src-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const remote = yield* createHabery({
      name: `reactor-clone-trqs-remote-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const validator = source.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      const recordingKvy = new Kevery(source.db, { local: true, lax: true });
      recordingKvy.processAttachedReceiptQuadruples({
        serder: event,
        trqs: [
          TransReceiptQuadruple.fromTuple([
            validator.kever!.prefixer,
            validator.kever!.sner,
            new Diger({ qb64: validator.kever!.said }),
            validator.sign(event.raw, true)[0]!,
          ]),
        ],
        firner: controller.kever?.fner,
        local: true,
      });
      assertEquals(source.db.vrcs.get(dgKey(controller.pre, event.said)).length, 1);

      const reactor = new Reactor(remote);
      for (const msg of source.db.clonePreIter(validator.pre, 0)) {
        reactor.ingest(msg);
      }
      for (const msg of source.db.clonePreIter(controller.pre, 0)) {
        reactor.ingest(msg);
      }
      reactor.processOnce();

      assertEquals(remote.db.vrcs.get(dgKey(controller.pre, event.said)).length, 1);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("app/reactor - query parsing keeps non-transferable endorsements as runtime cigars", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-qry-cigar-${crypto.randomUUID()}`,
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
      let seen: QueryEnvelope | null = null;

      reactor.kevery.processQuery = ((envelope) => {
        seen = envelope;
      }) as typeof reactor.kevery.processQuery;

      reactor.ingest(hab.query(hab.pre, hab.pre, {}, "ksn"));
      reactor.processOnce();

      if (!seen) {
        throw new Error("Expected normalized query envelope.");
      }
      const captured = seen as QueryEnvelope;
      assertEquals(captured.source, undefined);
      assertEquals(captured.sigers?.length ?? 0, 0);
      assertEquals(captured.cigars?.[0]?.verfer?.qb64, hab.pre);
    } finally {
      yield* hby.close();
    }
  });
});

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

Deno.test("app/reactor - receipt parsing dispatches `rct` envelopes to Kevery", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-rct-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const witness = hby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event) {
        throw new Error("Expected accepted controller event.");
      }

      const reactor = new Reactor(hby);
      let seen = 0;
      reactor.kevery.processReceipt = ((envelope) => {
        seen += 1;
        assertEquals(envelope.serder.ilk, "rct");
        assertEquals(envelope.cigars.length, 0);
        assertEquals(envelope.wigers.length, 1);
        assertEquals(envelope.wigers[0]?.index, 0);
      }) as typeof reactor.kevery.processReceipt;

      reactor.ingest(witness.witness(event));
      reactor.processOnce();

      assertEquals(seen, 1);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("app/reactor - malformed and unsupported queries do not throw, and unsupported routes emit invalid cues", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `reactor-qry-invalid-${crypto.randomUUID()}`,
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

      reactor.ingest(
        hab.endorse(makeQuerySerder("ksn", { i: hab.pre })),
      );
      reactor.processOnce();
      assertEquals(reactor.kevery.cues.pull(), undefined);

      reactor.ingest(hab.query(hab.pre, hab.pre, {}, "bogus"));
      reactor.processOnce();

      const cue = reactor.kevery.cues.pull();
      assertExists(cue);
      assertEquals(cue.kin, "invalid");
      if (cue.kin !== "invalid") {
        throw new Error("Expected invalid cue.");
      }
      assertEquals(cue.reason, "Unsupported query route bogus.");
    } finally {
      yield* hby.close();
    }
  });
});
