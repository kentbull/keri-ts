// @file-test-lane app-fast-parallel

import { call, run } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { Cigar, concatBytes, Diger, parseBytes } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopesFromFrames } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { KeriDispatchEnvelope, TransIdxSigGroup, TransReceiptQuadruple } from "../../../src/core/dispatch.ts";
import { Kevery, type QueryEnvelope } from "../../../src/core/eventing.ts";
import { query as makeQuerySerder } from "../../../src/core/protocol-eventing.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
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

      const query = hab.endorse(makeQuerySerder("ksn", { i: hab.pre, src: hab.pre }), { pipelined: false });
      yield* reactor.processChunk(query.slice(0, -1));
      assertEquals(seen, null);
      yield* reactor.processChunk(query.slice(-1));
      assertEquals(seen, null, "Chunk exhaustion must not dispatch an open attachment set");
      yield* reactor.processChunk(query);
      assertExists(seen, "The following body closes the previous query");
      seen = null;
      // Queued complete records finish independently of the open stream.
      reactor.ingest(hab.query(hab.pre, hab.pre, {}, "ksn"));
      yield* reactor.processOnce();

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
      assertEquals(
        source.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );

      const reactor = new Reactor(remote);
      for (const msg of source.db.clonePreIter(controller.pre, 0)) {
        reactor.ingest(msg);
      }
      yield* reactor.processOnce();

      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("app/reactor - cloned events replay stored transferable receipts into Kevery", async () => {
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
      assertEquals(
        source.db.vrcs.get(dgKey(controller.pre, event.said)).length,
        1,
      );

      const reactor = new Reactor(remote);
      for (const msg of source.db.clonePreIter(validator.pre, 0)) {
        reactor.ingest(msg);
      }
      for (const msg of source.db.clonePreIter(controller.pre, 0)) {
        reactor.ingest(msg);
      }
      yield* reactor.processOnce();

      assertEquals(
        remote.db.vrcs.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

// Exercise both already-known receipts and deferred validator establishment state.
for (const known of [true, false]) {
  Deno.test(`app/reactor - grouped receipt replay preserves evidence and OOBI replies (validator known=${known})`, async () => {
    const headDirPath = await Deno.makeTempDir({ prefix: "receipt-replay-" });
    try {
      await run(function*() {
        const source = yield* createHabery({ name: "source", headDirPath, skipConfig: true });
        const remote = yield* createHabery({ name: "remote", headDirPath, skipConfig: true });
        try {
          const controller = source.makeHab("controller");
          const validator = source.makeHab("validator", undefined, {
            icount: 3,
            isith: "2",
            ncount: 3,
            nsith: "2",
            toad: 0,
          });
          const event = source.db.getEvtSerder(controller.pre, controller.kever!.said)!;
          const key = dgKey(controller.pre, event.said!);
          const recording = new Kevery(source.db, { local: true, lax: true });
          // Two signatures share the inception seal; one after rotation is below its
          // controller threshold, but remains a valid independent receipt.
          const first = new TransIdxSigGroup(
            validator.kever!.prefixer,
            validator.kever!.sner,
            new Diger({ qb64: validator.kever!.said }),
            validator.sign(event.raw, true).slice(0, 2),
          );
          validator.rotate({ ncount: 3, nsith: "2" });
          const second = new TransIdxSigGroup(
            validator.kever!.prefixer,
            validator.kever!.sner,
            new Diger({ qb64: validator.kever!.said }),
            validator.sign(event.raw, true).slice(0, 1),
          );
          recording.processAttachedReceiptGroups({ serder: event, tsgs: [first, second], local: true });
          assertEquals(source.db.vrcs.get(key).length, 3);

          const url = "http://127.0.0.1:9724/";
          const provider = new Reactor(source);
          yield* provider.processCompleteChunk(concatBytes(
            controller.makeLocScheme(url, controller.pre, "http"),
            controller.makeEndRole(controller.pre, EndpointRoles.controller, true),
          ));
          // Reopen only the durable event DB so replay cannot depend on live receipt arrays.
          yield* source.db.close();
          yield* source.db.reopen({ reuse: true });
          const bundle = controller.replyToOobi(controller.pre, EndpointRoles.controller);
          const [envelope] = envelopesFromFrames(parseBytes(bundle));
          assertEquals(envelope.trqs.length, 0);
          assertEquals(envelope.tsgs.map((group) => group.sigers.length), [2, 1]);
          assertEquals(envelope.tsgs.map((group) => group.diger.qb64), [first.diger.qb64, second.diger.qb64]);

          const reactor = new Reactor(remote);
          if (known) {
            for (const message of source.db.clonePreIter(validator.pre)) reactor.ingest(message);
            yield* reactor.processOnce();
          }
          yield* reactor.processCompleteChunk(bundle);
          // A receipt with unavailable validator state must not hide the following replies.
          assertEquals(remote.db.locs.get([controller.pre, "http"])?.url, url);
          assertEquals(remote.db.ends.get([controller.pre, EndpointRoles.controller, controller.pre])?.allowed, true);
          if (!known) {
            assertEquals(remote.db.vrcs.get(key).length, 0);
            assertEquals(remote.db.vres.cnt(), 2); // The missing first group is escrowed as two signatures.
            for (const message of source.db.clonePreIter(validator.pre)) reactor.ingest(message);
            yield* reactor.processOnce();
            reactor.kevery.processEscrowUnverTrans();
            assertEquals(remote.db.vrcs.get(key).length, 2);
            assertEquals(remote.db.vres.cnt(), 0);
            // A duplicate replay then admits the second establishment group, without duplicates.
            yield* reactor.processCompleteChunk(bundle);
          }
          assertEquals(
            remote.db.vrcs.get(key).map((receipt) => receipt[3].qb64),
            [...first.sigers, ...second.sigers].map((siger) => siger.qb64),
          );
          assertEquals(remote.db.vrcs.get(key).length, 3);
        } finally {
          yield* remote.close(true);
          yield* source.close(true);
        }
      });
    } finally {
      await Deno.remove(headDirPath, { recursive: true });
    }
  });
}

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
      yield* reactor.processOnce();

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
      yield* reactor.processOnce();

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
      yield* reactor.processOnce();

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
      yield* ingestingReactor.processOnce();

      const replay = hab.loadLocScheme(hab.pre, "http");
      assertExists(replay);
      assertEquals(replay.length > 0, true);

      const replayReactor = new Reactor(hby);
      let seenCigar: unknown = null;
      replayReactor.revery.processReply = ((args) => {
        seenCigar = args.cigars?.[0] ?? null;
      }) as typeof replayReactor.revery.processReply;

      replayReactor.ingest(replay);
      yield* replayReactor.processOnce();

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
      yield* reactor.processOnce();

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
      yield* reactor.processOnce();
      assertEquals(reactor.kevery.cues.pull(), undefined);

      reactor.ingest(hab.query(hab.pre, hab.pre, {}, "bogus"));
      yield* reactor.processOnce();

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

Deno.test("app/reactor - unverified `/ksn` replies stay recoverable through escrow instead of aborting ingress", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `reactor-ksn-source-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const remote = yield* createHabery({
      name: `reactor-ksn-remote-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const alice = source.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const icp = [...source.db.clonePreIter(alice.pre, 0)][0];
      assertExists(icp);

      alice.rotate();
      const rotatedReply = alice.reply(
        `/ksn/${alice.pre}`,
        alice.kever!.state().asDict(),
      );

      const reactor = new Reactor(remote);
      reactor.ingest(icp);
      yield* reactor.processOnce();
      while (!reactor.cues.empty) {
        reactor.cues.pull();
      }

      reactor.ingest(rotatedReply);
      yield* reactor.processOnce();

      assertEquals(remote.db.rpes.cnt(), 1);
      const cue = reactor.cues.pull();
      assertExists(cue);
      assertEquals(cue.kin, "query");
      if (cue.kin !== "query") {
        throw new Error(
          "Expected reply escrow to enqueue a follow-on query cue.",
        );
      }
      assertEquals(cue.pre, alice.pre);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("runtime dispatch waits for an exchange and keeps its mailbox identity explicit", async () => {
  const [serder] = exchange("/test", {}, { sender: "EA2X8Lfrl9lZbCGz8cfKIvM_cqLyTYVLSFLhnttezlzQ" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed = false;
  let mailbox: string | null | undefined;
  const work = run(function*() {
    yield* dispatchEnvelope(
      new KeriDispatchEnvelope({ serder, attachmentGroups: [], local: false }),
      {} as never,
      {} as never,
      {
        /** Hold dispatch at the real Operation boundary until simulated storage finishes. */
        *processEvent(args) {
          mailbox = args.mailboxAid;
          yield* call(() => gate);
        },
      },
      {},
      "mailbox-a",
    );
    completed = true;
  });

  // The pending handler models a payload sink; returning early would let ingress outrun storage.
  await Promise.resolve();
  assertEquals(completed, false);
  assertEquals(mailbox, "mailbox-a");
  release();
  await work;
  assertEquals(completed, true);
});
