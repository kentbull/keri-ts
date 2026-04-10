// @file-test-lane core-fast-b

import { run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { Dater, Diger, Prefixer, SerderKERI, type Siger } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { type KeverEventEnvelope, Kevery, type QueryEnvelope } from "../../../src/core/eventing.ts";
import { query as makeQuerySerder, reply as makeReplySerder } from "../../../src/core/protocol-eventing.ts";
import { Roles } from "../../../src/core/roles.ts";
import { Revery } from "../../../src/core/routing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";
import { eventingTestApi, expectKind } from "../../private-access.ts";

function concatMessages(messages: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const msg of messages) {
    total += msg.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const msg of messages) {
    out.set(msg, offset);
    offset += msg.length;
  }
  return out;
}

function eventSeal(serder: SerderKERI) {
  assertExists(serder.pre);
  assertExists(serder.snh);
  assertExists(serder.said);
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function makeInteraction(
  pre: string,
  sn: number,
  prior: string,
  seals: ReturnType<typeof eventSeal>[] = [],
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "ixn",
      i: pre,
      s: sn.toString(16),
      p: prior,
      a: seals,
    },
    makify: true,
  });
}

function pullCueOfKin(
  kvy: Kevery,
  kin: "reply" | "replay" | "invalid" | "stream",
) {
  let cue = kvy.cues.pull();
  while (cue && cue.kin !== kin) {
    cue = kvy.cues.pull();
  }
  return cue;
}

function replySigGroup(
  hab: {
    pre: string;
    kever: { sner: TransIdxSigGroup["seqner"]; said: string };
    sign: (ser: Uint8Array, indexed: true) => Siger[];
  },
  serder: SerderKERI,
): TransIdxSigGroup {
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    hab.kever.sner,
    new Diger({ qb64: hab.kever.said }),
    hab.sign(serder.raw, true),
  );
}

function signedQueryEnvelope(
  hab: {
    pre: string;
    sign: (ser: Uint8Array, indexed: true) => Siger[];
  },
  serder: SerderKERI,
): QueryEnvelope {
  return {
    serder,
    source: new Prefixer({ qb64: hab.pre }),
    sigers: hab.sign(serder.raw, true),
    cigars: [],
  };
}

function prepareEscrowedQuery(
  kvy: Kevery,
  hab: {
    pre: string;
    sign: (ser: Uint8Array, indexed: true) => Siger[];
  },
  serder: SerderKERI,
) {
  kvy.processQuery(signedQueryEnvelope(hab, serder));
  assertEquals(kvy.db.qnfs.cnt(), 1);
  assertExists(serder.said);
  return { escrowKey: dgKey(hab.pre, serder.said), qsaid: serder.said };
}

function eventEnvelope(args: {
  serder: SerderKERI;
  sigers: KeverEventEnvelope["sigers"];
}): KeverEventEnvelope {
  return {
    serder: args.serder,
    sigers: args.sigers,
    wigers: [],
    frcs: [],
    sscs: [],
    ssts: [],
    local: false,
  };
}

Deno.test("Kevery.processQuery emits a key-state reply cue for the queried prefix", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ksn-qry-${crypto.randomUUID()}`,
      temp: true,
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

      const kvy = new Kevery(hby.db);
      const serder = makeQuerySerder("ksn", { i: hab.pre, src: hab.pre });
      kvy.processQuery(signedQueryEnvelope(hab, serder));

      const cue = kvy.cues.pull();
      assertExists(cue);
      assertEquals(cue.kin, "reply");
      if (cue.kin !== "reply") {
        throw new Error("Expected reply cue.");
      }
      assertEquals(cue.route, "/ksn");
      assertExists(cue.serder);
      assertEquals(cue.serder?.route, `/ksn/${hab.pre}`);
      assertEquals(
        (cue.serder?.ked?.a as Record<string, unknown> | undefined)?.i,
        hab.pre,
      );
      assertEquals(cue.dest, hab.pre);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processQuery drops malformed queries that omit `q.src` even when the requester is endorsed", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ksn-qry-src-${crypto.randomUUID()}`,
      temp: true,
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

      const kvy = new Kevery(hby.db);
      const serder = makeQuerySerder("ksn", { i: hab.pre });
      kvy.processQuery(signedQueryEnvelope(hab, serder));
      assertEquals(kvy.cues.pull(), undefined);
      assertEquals(hby.db.qnfs.cnt(), 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processQuery emits `invalid` only for unsupported routes without throwing", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-qry-invalid-${crypto.randomUUID()}`,
      temp: true,
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

      const kvy = new Kevery(hby.db);
      const serder = makeQuerySerder("bogus", { i: hab.pre, src: hab.pre });
      kvy.processQuery(signedQueryEnvelope(hab, serder));

      const cue = kvy.cues.pull();
      assertExists(cue);
      assertEquals(cue.kin, "invalid");
      if (cue.kin !== "invalid") {
        throw new Error("Expected invalid cue.");
      }
      assertEquals(cue.reason, "Unsupported query route bogus.");
      assertEquals(hby.db.qnfs.cnt(), 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery reply routing persists `/ksn` key-state notices through `knas.` and `ksns.`", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ksn-rpy-${crypto.randomUUID()}`,
      temp: true,
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
      const kever = hab.kever;
      assertExists(kever);

      const rvy = new Revery(hby.db);
      const kvy = new Kevery(hby.db, { rvy });
      kvy.registerReplyRoutes(rvy.rtr);

      const serder = makeReplySerder(`/ksn/${hab.pre}`, kever.state().asDict());

      rvy.processReply({
        serder,
        tsgs: [replySigGroup({
          pre: hab.pre,
          kever,
          sign: (ser) => hab.sign(ser, true),
        }, serder)],
      });

      const ksnSaid = kever.state().d ?? "";
      assertExists(hby.db.kdts.get([ksnSaid]));
      assertEquals(hby.db.ksns.get([ksnSaid])?.i, hab.pre);
      assertEquals(hby.db.knas.get([hab.pre, hab.pre])?.qb64, ksnSaid);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery reply routing accepts `/ksn` from self, backer, and configured watcher sources in non-lax mode", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ksn-trust-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const backer = hby.makeHab("backer", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const watcher = hby.makeHab("watcher", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = hby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 1,
        wits: [backer.pre],
      });
      const habord = hby.db.getHab(subject.pre);
      assertExists(habord);
      hby.db.pinHab(subject.pre, {
        ...habord,
        watchers: [watcher.pre],
      });

      const rvy = new Revery(hby.db, { lax: false });
      const kvy = new Kevery(hby.db, { rvy, lax: false });
      kvy.registerReplyRoutes(rvy.rtr);

      const selfReply = makeReplySerder(
        `/ksn/${subject.pre}`,
        subject.kever!.state().asDict(),
      );
      rvy.processReply({
        serder: selfReply,
        tsgs: [replySigGroup({
          pre: subject.pre,
          kever: subject.kever!,
          sign: (ser) => subject.sign(ser, true),
        }, selfReply)],
      });

      const backerReply = makeReplySerder(
        `/ksn/${backer.pre}`,
        subject.kever!.state().asDict(),
      );
      rvy.processReply({
        serder: backerReply,
        cigars: [backer.sign(backerReply.raw, false)[0]],
      });

      const watcherReply = makeReplySerder(
        `/ksn/${watcher.pre}`,
        subject.kever!.state().asDict(),
      );
      rvy.processReply({
        serder: watcherReply,
        tsgs: [replySigGroup({
          pre: watcher.pre,
          kever: watcher.kever!,
          sign: (ser) => watcher.sign(ser, true),
        }, watcherReply)],
      });

      assertEquals(
        hby.db.knas.get([subject.pre, subject.pre])?.qb64,
        subject.kever!.state().d,
      );
      assertEquals(
        hby.db.knas.get([subject.pre, backer.pre])?.qb64,
        subject.kever!.state().d,
      );
      assertEquals(
        hby.db.knas.get([subject.pre, watcher.pre])?.qb64,
        subject.kever!.state().d,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery reply routing rejects `/ksn` from unrelated sources in non-lax mode", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ksn-untrusted-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const stranger = hby.makeHab("stranger", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const subject = hby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const rvy = new Revery(hby.db, { lax: false });
      const kvy = new Kevery(hby.db, { rvy, lax: false });
      kvy.registerReplyRoutes(rvy.rtr);

      const serder = makeReplySerder(
        `/ksn/${stranger.pre}`,
        subject.kever!.state().asDict(),
      );

      assertThrows(
        () =>
          rvy.processReply({
            serder,
            tsgs: [replySigGroup({
              pre: stranger.pre,
              kever: stranger.kever!,
              sign: (ser) => stranger.sign(ser, true),
            }, serder)],
          }),
        ValidationError,
        `Untrusted key state source ${stranger.pre} for ${subject.pre}.`,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery reply routing rejects stale and mismatched `/ksn` replies", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ksn-stale-mismatch-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const subject = hby.makeHab("subject", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const priorState = subject.kever!.state().asDict();
      const ixn = makeInteraction(subject.pre, 1, subject.kever!.said);
      const kvy = hby.kevery;
      kvy.processEvent({
        ...eventEnvelope({
          serder: ixn,
          sigers: subject.sign(ixn.raw, true),
        }),
        local: true,
      });

      const rvy = new Revery(hby.db, { lax: false });
      const replyKvy = new Kevery(hby.db, { rvy, lax: false });
      replyKvy.registerReplyRoutes(rvy.rtr);

      const staleReply = makeReplySerder(`/ksn/${subject.pre}`, priorState);
      assertThrows(
        () =>
          rvy.processReply({
            serder: staleReply,
            tsgs: [replySigGroup({
              pre: subject.pre,
              kever: subject.kever!,
              sign: (ser) => subject.sign(ser, true),
            }, staleReply)],
          }),
        ValidationError,
        `Skipped stale key state at sn=0 for ${subject.pre}.`,
      );

      const mismatchReply = makeReplySerder(`/ksn/${subject.pre}`, {
        ...subject.kever!.state().asDict(),
        d: priorState.d,
      });
      const estEvent = hby.db.getEvtSerder(
        subject.pre,
        subject.kever!.lastEst.d,
      );
      assertExists(estEvent);
      const estSner = estEvent.sner;
      assertExists(estSner);
      assertThrows(
        () =>
          rvy.processReply({
            serder: mismatchReply,
            tsgs: [
              new TransIdxSigGroup(
                new Prefixer({ qb64: subject.pre }),
                estSner,
                new Diger({ qb64: subject.kever!.lastEst.d }),
                subject.sign(mismatchReply.raw, true),
              ),
            ],
          }),
        ValidationError,
        `Mismatch key state at sn=1 with accepted event log for ${subject.pre}.`,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery reply routing persists `/watcher/{aid}` replies into `wwas.` and `obvs.` and queues watcher OOBIs idempotently", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-watcher-rpy-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const controller = hby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const watcher = hby.makeHab("watcher", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const observed = hby.makeHab("observed", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const rvy = new Revery(hby.db);
      const kvy = new Kevery(hby.db, { rvy });
      kvy.registerReplyRoutes(rvy.rtr);

      const oobi = `http://127.0.0.1:7723/oobi/${observed.pre}/controller`;
      const addReply = makeReplySerder(`/watcher/${watcher.pre}/add`, {
        cid: controller.pre,
        oid: observed.pre,
        oobi,
      });

      const tsg = replySigGroup({
        pre: controller.pre,
        kever: controller.kever!,
        sign: (ser) => controller.sign(ser, true),
      }, addReply);
      rvy.processReply({ serder: addReply, tsgs: [tsg] });
      rvy.processReply({ serder: addReply, tsgs: [tsg] });

      assertEquals(
        hby.db.wwas.get([controller.pre, watcher.pre, observed.pre])?.qb64,
        addReply.said,
      );
      assertEquals(
        hby.db.obvs.get([controller.pre, watcher.pre, observed.pre])?.enabled,
        true,
      );
      assertEquals(hby.db.oobis.get(oobi)?.state, "queued");

      const cutReply = makeReplySerder(`/watcher/${watcher.pre}/cut`, {
        cid: controller.pre,
        oid: observed.pre,
      });
      rvy.processReply({
        serder: cutReply,
        tsgs: [replySigGroup({
          pre: controller.pre,
          kever: controller.kever!,
          sign: (ser) => controller.sign(ser, true),
        }, cutReply)],
      });

      assertEquals(
        hby.db.wwas.get([controller.pre, watcher.pre, observed.pre])?.qb64,
        cutReply.said,
      );
      assertEquals(
        hby.db.obvs.get([controller.pre, watcher.pre, observed.pre])?.enabled,
        false,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery query-not-found escrows retry once the requested key state arrives", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const querySerder = makeQuerySerder("ksn", {
        i: alice.pre,
        src: bob.pre,
      });
      const queryEnvelope = signedQueryEnvelope(bob, querySerder);

      const kvy = new Kevery(remote.db);
      kvy.processQuery(queryEnvelope);
      assertEquals(remote.db.qnfs.cnt(), 1);
      assertExists(querySerder.said);
      const escrowKey = dgKey(bob.pre, querySerder.said);
      assertExists(remote.db.evts.get(escrowKey));
      assertEquals(remote.db.sigs.get(escrowKey).length, 1);

      const aliceEvent = source.db.getEvtSerder(
        alice.pre,
        alice.kever?.said ?? "",
      );
      if (!aliceEvent) {
        throw new Error("Expected accepted alice event.");
      }
      kvy.processEvent(eventEnvelope({
        serder: aliceEvent,
        sigers: alice.sign(aliceEvent.raw, true),
      }));
      kvy.processQueryNotFound();

      let cue = kvy.cues.pull();
      while (cue && cue.kin !== "reply") {
        cue = kvy.cues.pull();
      }
      assertExists(cue);
      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(cue.kin, "reply");
      if (cue.kin !== "reply") {
        throw new Error("Expected reply cue.");
      }
      assertEquals(cue.route, "/ksn");
      assertEquals(cue.serder?.route, `/ksn/${bob.pre}`);
      assertEquals(cue.dest, bob.pre);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processQueryNotFound keeps escrowed queries on repeated missing-state decisions and uses typed replay decisions", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-keep-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-keep-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const querySerder = makeQuerySerder("ksn", {
        i: alice.pre,
        src: bob.pre,
      });

      const kvy = new Kevery(remote.db);
      const api = eventingTestApi(kvy);
      const { qsaid } = prepareEscrowedQuery(kvy, bob, querySerder);

      const decision = api.reprocessEscrowedQuery(bob.pre, qsaid);
      assertEquals(expectKind(decision, "keep").reason, "queryNotFound");

      kvy.processQueryNotFound();
      assertEquals(remote.db.qnfs.cnt(), 1);
      assertEquals(pullCueOfKin(kvy, "reply"), undefined);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processQueryNotFound drops malformed escrow artifacts and clears persisted query material", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-drop-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-drop-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const querySerder = makeQuerySerder("ksn", {
        i: alice.pre,
        src: bob.pre,
      });
      const kvy = new Kevery(remote.db);
      const { escrowKey } = prepareEscrowedQuery(kvy, bob, querySerder);
      remote.db.evts.rem(escrowKey);

      kvy.processQueryNotFound();

      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(remote.db.evts.get(escrowKey), null);
      assertEquals(remote.db.sigs.get(escrowKey).length, 0);
      assertEquals(remote.db.rcts.get(escrowKey).length, 0);
      assertEquals(remote.db.dtss.get(escrowKey), null);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processQueryNotFound drops stale query-not-found rows after the KERIpy timeout window", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-stale-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-stale-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const querySerder = makeQuerySerder("ksn", {
        i: "EStaleQueryNotFoundTarget000000000000000000000000",
        src: bob.pre,
      });
      const kvy = new Kevery(remote.db);
      const { escrowKey } = prepareEscrowedQuery(kvy, bob, querySerder);
      const staleDate = new Date(Date.now() - 301_000);
      const staleIso = staleDate.toISOString()
        .replace("Z", "+00:00")
        .replace(
          /\.(\d{3})\+00:00$/,
          (_match, millis) => `.${millis}000+00:00`,
        );
      remote.db.dtss.pin(
        escrowKey,
        new Dater({
          qb64: encodeDateTimeToDater(staleIso),
        }),
      );

      kvy.processQueryNotFound();

      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(remote.db.dtss.get(escrowKey), null);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Reactor query ingress preserves transferable requester signatures through QNF replay", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-reactor-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-reactor-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const query = bob.query(alice.pre, bob.pre, {}, "ksn");
      const reactor = new Reactor(remote);

      reactor.ingest(query);
      reactor.processOnce();

      assertEquals(remote.db.qnfs.cnt(), 1);

      const aliceEvent = source.db.getEvtSerder(
        alice.pre,
        alice.kever?.said ?? "",
      );
      assertExists(aliceEvent);
      reactor.kevery.processEvent(eventEnvelope({
        serder: aliceEvent,
        sigers: alice.sign(aliceEvent.raw, true),
      }));
      reactor.kevery.processQueryNotFound();

      let cue = reactor.kevery.cues.pull();
      while (cue && cue.kin !== "reply") {
        cue = reactor.kevery.cues.pull();
      }
      assertExists(cue);
      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(cue.kin, "reply");
      if (cue.kin !== "reply") {
        throw new Error("Expected reply cue.");
      }
      assertEquals(cue.dest, bob.pre);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery query replay distinguishes missing escrowed query events and endorsements", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-artifacts-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-artifacts-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const querySerder = makeQuerySerder("ksn", {
        i: alice.pre,
        src: bob.pre,
      });
      const kvy = new Kevery(remote.db);
      const api = eventingTestApi(kvy);
      const { escrowKey, qsaid } = prepareEscrowedQuery(kvy, bob, querySerder);
      remote.db.evts.rem(escrowKey);

      const missingEvent = api.reprocessEscrowedQuery(bob.pre, qsaid);
      assertEquals(
        expectKind(missingEvent, "drop").reason,
        "missingEscrowedEvent",
      );

      remote.db.evts.pin(escrowKey, querySerder);
      remote.db.sigs.rem(escrowKey);
      const missingEndorsements = api.reprocessEscrowedQuery(bob.pre, qsaid);
      assertEquals(
        expectKind(missingEndorsements, "drop").reason,
        "missingEscrowedEndorsements",
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery query replay keeps live query drop reasons in escrow drop context", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-qnf-live-reason-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-qnf-live-reason-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const malformed = makeQuerySerder("logs", {
        i: bob.pre,
        src: bob.pre,
        fn: "not-hex",
      });
      const kvy = new Kevery(remote.db);
      assertExists(malformed.said);
      const escrowKey = dgKey(bob.pre, malformed.said);
      remote.db.evts.pin(escrowKey, malformed);
      remote.db.dtss.pin(
        escrowKey,
        new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
      );
      remote.db.sigs.pin(escrowKey, bob.sign(malformed.raw, true));

      const decision = eventingTestApi(kvy).reprocessEscrowedQuery(
        bob.pre,
        malformed.said,
      );

      const drop = expectKind(decision, "drop");
      assertEquals(drop.reason, "malformedEscrowedQuery");
      assertEquals(drop.context?.liveReason, "invalidLogsGate");
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processQuery replays logs from fn=0 when q.fn is omitted", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-logs-qry-${crypto.randomUUID()}`,
      temp: true,
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
      const kvy = new Kevery(hby.db, { local: true });
      const kever = hab.kever;
      assertExists(kever);

      const ixn1 = makeInteraction(hab.pre, 1, kever.said);
      kvy.processEvent({
        serder: ixn1,
        sigers: hab.sign(ixn1.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      const ixn2 = makeInteraction(hab.pre, 2, ixn1.said!);
      kvy.processEvent({
        serder: ixn2,
        sigers: hab.sign(ixn2.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      const serder = makeQuerySerder("logs", { i: hab.pre, src: hab.pre });
      kvy.processQuery(signedQueryEnvelope(hab, serder));

      const cue = pullCueOfKin(kvy, "replay");
      assertExists(cue);
      assertEquals(cue.kin, "replay");
      if (cue.kin !== "replay") {
        throw new Error("Expected replay cue.");
      }
      assertEquals(
        cue.msgs,
        concatMessages([...hby.db.clonePreIter(hab.pre, 0)]),
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processQuery replays logs from the requested first-seen ordinal", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-logs-fn-${crypto.randomUUID()}`,
      temp: true,
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
      const kvy = new Kevery(hby.db, { local: true });
      const kever = hab.kever;
      assertExists(kever);

      const ixn1 = makeInteraction(hab.pre, 1, kever.said);
      kvy.processEvent({
        serder: ixn1,
        sigers: hab.sign(ixn1.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });
      const ixn2 = makeInteraction(hab.pre, 2, ixn1.said!);
      kvy.processEvent({
        serder: ixn2,
        sigers: hab.sign(ixn2.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      const serder = makeQuerySerder("logs", {
        i: hab.pre,
        src: hab.pre,
        fn: "1",
      });
      kvy.processQuery(signedQueryEnvelope(hab, serder));

      const cue = pullCueOfKin(kvy, "replay");
      assertExists(cue);
      assertEquals(cue.kin, "replay");
      if (cue.kin !== "replay") {
        throw new Error("Expected replay cue.");
      }
      assertEquals(
        cue.msgs,
        concatMessages([...hby.db.clonePreIter(hab.pre, 1)]),
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processQuery treats empty logs replay slices as a successful no-op", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-logs-empty-${crypto.randomUUID()}`,
      temp: true,
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

      const kvy = new Kevery(hby.db, { local: true });
      const serder = makeQuerySerder("logs", {
        i: hab.pre,
        src: hab.pre,
        fn: "ff",
      });
      kvy.processQuery(signedQueryEnvelope(hab, serder));

      assertEquals(pullCueOfKin(kvy, "replay"), undefined);
      assertEquals(hby.db.qnfs.cnt(), 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery logs query escrows on q.s and preserves fn plus dest on replay", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-logs-s-source-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-logs-s-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const aliceKever = alice.kever;
      assertExists(aliceKever);

      const ixn1 = makeInteraction(alice.pre, 1, aliceKever.said);
      source.kevery.processEvent(eventEnvelope({
        serder: ixn1,
        sigers: alice.sign(ixn1.raw, true),
      }));
      const ixn2 = makeInteraction(alice.pre, 2, ixn1.said!);
      source.kevery.processEvent(eventEnvelope({
        serder: ixn2,
        sigers: alice.sign(ixn2.raw, true),
      }));

      const kvy = new Kevery(remote.db);
      const aliceIcp = source.db.getEvtSerder(alice.pre, aliceKever.said);
      assertExists(aliceIcp);
      kvy.processEvent(eventEnvelope({
        serder: aliceIcp,
        sigers: source.db.sigs.get([alice.pre, aliceKever.said]),
      }));

      const querySerder = makeQuerySerder("logs", {
        i: alice.pre,
        src: bob.pre,
        s: "2",
        fn: "1",
      });
      kvy.processQuery(signedQueryEnvelope(bob, querySerder));
      assertEquals(remote.db.qnfs.cnt(), 1);

      kvy.processEvent(eventEnvelope({
        serder: ixn1,
        sigers: alice.sign(ixn1.raw, true),
      }));
      kvy.processEvent(eventEnvelope({
        serder: ixn2,
        sigers: alice.sign(ixn2.raw, true),
      }));
      kvy.processQueryNotFound();

      const cue = pullCueOfKin(kvy, "replay");
      assertExists(cue);
      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(cue.kin, "replay");
      if (cue.kin !== "replay") {
        throw new Error("Expected replay cue.");
      }
      assertEquals(cue.dest, bob.pre);
      assertEquals(
        cue.msgs,
        concatMessages([...remote.db.clonePreIter(alice.pre, 1)]),
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery logs query escrows on q.a until the anchoring event is available", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-logs-a-source-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-logs-a-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const delegator = source.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const bob = source.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegatorKever = delegator.kever;
      const bobKever = bob.kever;
      assertExists(delegatorKever);
      assertExists(bobKever);

      const bobIcp = source.db.getEvtSerder(bob.pre, bobKever.said);
      assertExists(bobIcp);
      const seal = eventSeal(bobIcp);
      const anchor = makeInteraction(
        delegator.pre,
        1,
        delegatorKever.said,
        [seal],
      );

      const kvy = new Kevery(remote.db);
      const delegatorIcp = source.db.getEvtSerder(
        delegator.pre,
        delegatorKever.said,
      );
      assertExists(delegatorIcp);
      kvy.processEvent(eventEnvelope({
        serder: delegatorIcp,
        sigers: source.db.sigs.get([delegator.pre, delegatorKever.said]),
      }));

      const querySerder = makeQuerySerder("logs", {
        i: delegator.pre,
        src: bob.pre,
        a: seal,
      });
      kvy.processQuery(signedQueryEnvelope(bob, querySerder));
      assertEquals(remote.db.qnfs.cnt(), 1);

      kvy.processEvent(eventEnvelope({
        serder: anchor,
        sigers: delegator.sign(anchor.raw, true),
      }));
      kvy.processQueryNotFound();

      const cue = pullCueOfKin(kvy, "replay");
      assertExists(cue);
      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(cue.kin, "replay");
      if (cue.kin !== "replay") {
        throw new Error("Expected replay cue.");
      }
      assertEquals(cue.dest, bob.pre);
      assertEquals(
        cue.msgs,
        concatMessages([...remote.db.clonePreIter(delegator.pre, 0)]),
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery logs replay for delegated identifiers includes the delegator chain", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-logs-del-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = hby.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = hby.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });
      const delegateKever = delegate.kever;
      assertExists(delegateKever);

      const kvy = new Kevery(hby.db);
      const serder = makeQuerySerder("logs", {
        i: delegate.pre,
        src: delegate.pre,
      });
      kvy.processQuery(signedQueryEnvelope(delegate, serder));

      const cue = pullCueOfKin(kvy, "replay");
      assertExists(cue);
      assertEquals(cue.kin, "replay");
      if (cue.kin !== "replay") {
        throw new Error("Expected replay cue.");
      }
      assertEquals(
        cue.msgs,
        concatMessages([
          ...hby.db.clonePreIter(delegate.pre, 0),
          ...hby.db.cloneDelegation(delegateKever),
        ]),
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processQuery escrows `ksn` until the authoritative event is fully witnessed", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-ksn-witness-source-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-ksn-witness-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
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
        wits: [witness.pre],
        toad: 1,
      });
      const requester = source.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const controllerEvent = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(controllerEvent);

      const kvy = new Kevery(remote.db);
      kvy.processEvent(eventEnvelope({
        serder: controllerEvent,
        sigers: source.db.sigs.get([
          controller.pre,
          controller.kever?.said ?? "",
        ]),
      }));

      const querySerder = makeQuerySerder("ksn", {
        i: controller.pre,
        src: requester.pre,
      });
      kvy.processQuery(signedQueryEnvelope(requester, querySerder));
      assertEquals(remote.db.qnfs.cnt(), 1);
      assertEquals(pullCueOfKin(kvy, "reply"), undefined);

      const reactor = new Reactor(remote);
      reactor.ingest(witness.witness(controllerEvent));
      reactor.processOnce();
      kvy.processEscrows();

      kvy.processQueryNotFound();

      const cue = pullCueOfKin(kvy, "reply");
      assertExists(cue);
      assertEquals(remote.db.qnfs.cnt(), 0);
      assertEquals(cue.kin, "reply");
      if (cue.kin !== "reply") {
        throw new Error("Expected reply cue.");
      }
      assertEquals(cue.route, "/ksn");
      assertEquals(cue.serder?.route, `/ksn/${requester.pre}`);
      assertEquals(cue.dest, requester.pre);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processQuery escrows `mbx` until local mailbox authority exists", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-mbx-source-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-mbx-remote-${crypto.randomUUID()}`,
      temp: true,
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
      const requester = source.makeHab("requester", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kvy = new Kevery(remote.db);

      const querySerder = makeQuerySerder("mbx", {
        i: controller.pre,
        src: requester.pre,
        topics: ["/reply"],
      });
      kvy.processQuery(signedQueryEnvelope(requester, querySerder));
      assertEquals(remote.db.qnfs.cnt(), 1);
      assertEquals(pullCueOfKin(kvy, "invalid"), undefined);

      const controllerEvent = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(controllerEvent);
      kvy.processEvent(eventEnvelope({
        serder: controllerEvent,
        sigers: source.db.sigs.get([
          controller.pre,
          controller.kever?.said ?? "",
        ]),
      }));
      kvy.processQueryNotFound();

      assertEquals(remote.db.qnfs.cnt(), 0);
      const streamCue = pullCueOfKin(kvy, "stream");
      assertExists(streamCue);
      assertEquals(streamCue.kin, "stream");
      if (streamCue.kin !== "stream") {
        throw new Error("Expected stream cue.");
      }
      assertEquals(streamCue.topics, { "/reply": 0 });
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});
