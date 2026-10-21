import { call, run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { SerderKERI, Vrsn_1_0, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { processCuesOnce } from "../../../../src/app/runtime/cue-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { CesrHttpRefusal } from "../../../../src/app/transport/cesr-egress.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { UnsupportedTelReplayError } from "../../../../src/db/replay/tel-replay.ts";
import { httpClient } from "../../../support/http-client.ts";

Deno.test("Respondant finishes local replay construction before publishing or removing its source", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const first = hab.query(hab.pre, hab.pre, { route: "logs", q: {} });
    const second = hab.query(hab.pre, hab.pre, { route: "logs", q: { s: "1" } });
    const failure = new UnsupportedTelReplayError(hab.pre, hab.pre, Vrsn_1_0, Vrsn_2_0);
    const cloning = new Error("second message copy failed");
    const broken = second.slice();
    broken.slice = () => {
      throw cloning;
    };
    let fail = true, failCopy = false, closed = 0;
    const msgs = {
      *[Symbol.iterator]() {
        try {
          yield first;
          if (fail) throw failure;
          yield failCopy ? broken : second;
        } finally {
          closed++;
        }
      },
    };
    const cue: AgentCue = { kin: "replay", msgs, src: hab.pre, dest: hab.pre };
    const cues = new Deck([cue]);
    try {
      assertStrictEquals(assertThrows(() => runtime.respondant.enqueueCue(hab, cues)), failure);
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals([runtime.postman.evts.length, closed], [0, 1], "a partial replay cannot escape");
      fail = false;
      failCopy = true;
      assertStrictEquals(assertThrows(() => runtime.respondant.enqueueCue(hab, cues)), cloning);
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals([runtime.postman.evts.length, closed], [0, 2], "batch copying also completes before publication");
      failCopy = false;
      assertEquals(runtime.respondant.enqueueCue(hab, cues), true);
      assertEquals([cues.empty, runtime.postman.evts.length, closed], [true, 2, 3]);
      assertEquals([...runtime.postman.evts].map((evt) => evt.msg), [first, second]);
      assertEquals([...runtime.postman.evts].map(({ src, dest, topic }) => ({ src, dest, topic })), [
        { src: hab.pre, dest: hab.pre, topic: "/replay" },
        { src: hab.pre, dest: hab.pre, topic: "/replay" },
      ]);
      yield* runtime.postman.close();
      assertEquals(closed, 3, "delivery owns bytes, not a live replay iterator");
      cues.push(cue);
      assertThrows(() => runtime.respondant.enqueueCue(hab, cues), Error, "closed");
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals(closed, 3, "a closed owner must not reopen source production");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("Poster copies complete source messages and reports exceptions without automatic retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const failure = new Error("transport unavailable");
    let attempts = 0, closed = 0;
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(() => {
        attempts++;
        throw failure;
      }),
      systemClock,
    );
    const wire = hab.query(hab.pre, hab.pre, { route: "logs", q: {} });
    const source = wire.slice();
    const msgs = {
      *[Symbol.iterator]() {
        try {
          yield source;
        } finally {
          closed++;
        }
      },
    };
    hby.db.ends.pin([hab.pre, Roles.controller, hab.pre], { allowed: true });
    hby.db.locs.pin([hab.pre, "https"], { url: "https://peer.test/" });
    const reports: unknown[][] = [], report = console.error;
    console.error = (...args: unknown[]) => reports.push(args);
    try {
      runtime.cues.push({ kin: "replay", msgs, src: hab.pre, dest: hab.pre });
      yield* processCuesOnce(runtime, { hab });
      const evt = runtime.postman.evts.peekHead()!;
      source.fill(0);
      assertEquals([closed, evt.msg], [1, wire], "admission owns a copy after eager production finishes");
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.postman.process()))), failure);
      assertEquals(runtime.postman.hasPending, false);
      assertEquals(reports.length, 1);
      assertEquals(reports[0][1], { src: evt.src, dest: evt.dest, topic: evt.topic, deliveries: [] });
      assertStrictEquals(reports[0][2], failure);
      yield* runtime.postman.process();
      assertEquals(attempts, 1, "a failed attempt is reported without automatic retry");
    } finally {
      console.error = report;
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("complete replay batches precede receipt delivery while refusals preserve partial outcomes", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), second = hby.makeHab("second"), third = hby.makeHab("third");
    let refuse = true, queries = 0, secondSaid = "";
    const attempts: { target: string; said: string }[] = [];
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (url, init) => {
        const target = new URL(url).hostname.split(".")[0];
        const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
        const serder = new SerderKERI({ raw: body });
        if (target === "query" && serder.ilk === "qry") queries++;
        attempts.push({ target, said: serder.said! });
        const rejected = refuse && serder.ilk === "qry"
          && (target === "first" || target === "third" && serder.said === secondSaid);
        return new Response(null, { status: rejected ? 503 : 204 });
      }),
      systemClock,
    );
    const msgs = [
      sender.query(sender.pre, sender.pre, { route: "logs", q: {} }),
      sender.query(sender.pre, sender.pre, { route: "logs", q: { s: "1" } }),
    ];
    const saids = msgs.map((msg) => new SerderKERI({ raw: msg }).said!);
    secondSaid = saids[1];
    const targets = [sender, second, third].map((hab, index) => ({
      eid: hab.pre,
      target: ["first", "second", "third"][index],
    })).sort((a, b) => a.eid < b.eid ? -1 : 1);
    for (const { eid, target } of targets) {
      hby.db.ends.pin([second.pre, Roles.controller, eid], { allowed: true });
      hby.db.locs.pin([eid, "https"], { url: `https://${target}.test/` });
    }
    const reports: unknown[][] = [], report = console.error;
    console.error = (...args: unknown[]) => reports.push(args);
    try {
      runtime.cues.push({ kin: "replay", msgs, src: sender.pre, dest: second.pre });
      runtime.cues.push({ kin: "receipt", serder: second.kever!.serder });
      yield* processCuesOnce(runtime, { hab: sender });
      const evts = [...runtime.postman.evts];
      const produced = evts.map(({ msg }) => new SerderKERI({ raw: msg }));
      assertEquals(produced.map((msg) => msg.ilk), ["qry", "qry", "rct"]);
      yield* runtime.postman.process();
      assertEquals(
        attempts,
        produced.flatMap((msg) => targets.map(({ target }) => ({ target, said: msg.said! }))),
        "each complete replay message reaches all targets before the following receipt",
      );
      assertEquals(
        reports.map(([, context]) => context),
        evts.slice(0, 2).map((evt, index) => ({
          src: evt.src,
          dest: evt.dest,
          topic: evt.topic,
          deliveries: targets.filter(({ target }) => index === 0 ? target !== "first" : target === "second")
            .map(({ target }) => `https://${target}.test/`),
        })),
      );
      const [one, multiple] = reports.map((report) => report[2]);
      assertInstanceOf(one, CesrHttpRefusal);
      assertEquals(one.status, 503);
      assertInstanceOf(multiple, AggregateError);
      assertEquals(multiple.errors.length, 2);
      for (const error of multiple.errors) {
        assertInstanceOf(error, CesrHttpRefusal);
        assertEquals(error.status, 503);
      }
      assertEquals(runtime.postman.hasPending, false);
      yield* runtime.postman.process();
      assertEquals(attempts.length, 9, "the successful receipt is complete and reported failures are not retried");

      hby.db.locs.pin([sender.pre, "https"], { url: "https://query.test/" });
      for (let index = 0; index < 9; index++) {
        runtime.querying.enqueue({
          pre: sender.pre,
          signer: sender.pre,
          src: sender.pre,
          route: "logs",
          q: {},
          wits: [sender.pre],
        });
      }

      yield* runtime.querying.deliverOnce();
      assertEquals(runtime.querying.hasPendingDelivery, false);
      assertEquals(queries, 9);
    } finally {
      console.error = report;
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("cue delivery allows application progress while retaining actual HTTP cleanup", async () => {
  let reading!: () => void, cleaning!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => reading = resolve);
  const cleanup = new Promise<void>((resolve) => cleaning = resolve);
  const gate = new Promise<void>((resolve) => release = resolve);
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (_url, init) => {
        await new Response(init!.body).arrayBuffer();
        return new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              reading();
            },
            async cancel() {
              cleaning();
              await gate;
            },
          }, { highWaterMark: 0 }),
        );
      }),
      systemClock,
    );
    runtime.cues.push({
      kin: "replay",
      msgs: [hab.query(hab.pre, hab.pre, { route: "logs", q: {} })],
      src: hab.pre,
      dest: hab.pre,
    });
    hby.db.ends.pin([hab.pre, Roles.controller, hab.pre], { allowed: true });
    hby.db.locs.pin([hab.pre, "https"], { url: "https://peer.test/" });
    runtime.respondant.enqueueCue(hab, runtime.cues);
    const delivery = yield* spawn(function*() {
      try {
        yield* runtime.postman.process();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      }
    });
    try {
      yield* call(() => started);
      let closed = false;
      const closing = yield* spawn(function*() {
        yield* runtime.postman.close();
        closed = true;
      });
      yield* call(() => cleanup);
      assertEquals([closed, runtime.postman.hasPending], [false, true]);
      release();
      yield* closing;
      yield* delivery;
      assertEquals([closed, runtime.postman.hasPending], [true, false]);
    } finally {
      release();
      yield* delivery.halt();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
