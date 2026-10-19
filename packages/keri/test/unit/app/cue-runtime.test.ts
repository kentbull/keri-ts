import { call, run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { SerderKERI } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";

Deno.test("Respondant finishes local replay construction before publishing or removing its source", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby);
    const first = hab.query(hab.pre, hab.pre, { route: "logs", q: {} });
    const second = hab.query(hab.pre, hab.pre, { route: "logs", q: { s: "1" } });
    const failure = new Error("second replay message could not be constructed");
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
    runtime.postman.findBytesRoute = () => {
      throw new Error("delivery routing does not belong to message production");
    };
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

Deno.test("Poster retains the complete source message on exceptions and requires explicit retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const failure = new Error("transport unavailable");
    let fail = true, attempts = 0, closed = 0, url = "https://peer.test/";
    const destinations: string[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          fetch: (url) => {
            attempts++;
            destinations.push(String(url));
            if (fail) throw failure;
            return Promise.resolve(new Response(null, { status: 204 }));
          },
        },
      },
    });
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
    runtime.postman.findBytesRoute = () => ({
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct",
      bodyMode: "header",
      targets: [{ eid: hab.pre, url }],
    });
    try {
      runtime.cues.push({ kin: "replay", msgs, src: hab.pre, dest: hab.pre });
      yield* processCuesOnce(runtime, { hab });
      const evt = runtime.postman.evts.peekHead()!;
      source.fill(0);
      assertEquals([closed, evt.msg], [1, wire], "admission owns a copy after eager production finishes");
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.postman.process()))), failure);
      assertEquals(runtime.postman.hasPending, false);
      assertStrictEquals(runtime.postman.failures[0].evt, evt);
      assertStrictEquals(runtime.postman.failures[0].error, failure);
      yield* runtime.postman.process();
      assertEquals(attempts, 1, "a failed event is retained without automatic retry");
      hab.rotate();
      url = "https://retry.test/";
      fail = false;
      const retried = runtime.postman.retry(evt, { notify: true });
      assertEquals(retried === evt, false, "each attempt has a fresh completion identity");
      assertEquals(retried.msg, wire, "retry keeps the originally signed source message");
      assertEquals(runtime.postman.failures.length, 0);
      yield* runtime.postman.process();
      assertEquals((yield* runtime.postman.wait(retried)).kin, "sent");
      assertEquals([attempts, closed], [2, 1], "retry neither reopens replay nor signs its source again");
      assertEquals(
        destinations,
        ["https://peer.test/", "https://retry.test/"],
        "explicit retry resolves current routing",
      );
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("complete replay batches precede receipt delivery while refused events remain explicitly retryable", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), second = hby.makeHab("second"), third = hby.makeHab("third");
    let refuse = true, queries = 0, secondSaid = "";
    const attempts: { target: string; said: string }[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(url, init) {
            const target = new URL(url).hostname.split(".")[0];
            const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
            const serder = new SerderKERI({ raw: body });
            if (target === "query" && serder.ilk === "qry") queries++;
            attempts.push({ target, said: serder.said! });
            const rejected = refuse && serder.ilk === "qry"
              && (target === "first" || target === "third" && serder.said === secondSaid);
            return new Response(null, { status: rejected ? 503 : 204 });
          },
        },
      },
    });
    const msgs = [
      sender.query(sender.pre, sender.pre, { route: "logs", q: {} }),
      sender.query(sender.pre, sender.pre, { route: "logs", q: { s: "1" } }),
    ];
    const saids = msgs.map((msg) => new SerderKERI({ raw: msg }).said!);
    secondSaid = saids[1];
    runtime.postman.findBytesRoute = () => ({
      sender: sender.pre,
      recipient: second.pre,
      topic: "/replay",
      kind: "direct",
      bodyMode: "header",
      targets: [sender, second, third].map((hab, index) => ({
        eid: hab.pre,
        url: `https://${["first", "second", "third"][index]}.test/`,
      })),
    });
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
        produced.flatMap((msg) => ["first", "second", "third"].map((target) => ({ target, said: msg.said! }))),
        "each complete replay message reaches all targets before the following receipt",
      );
      assertEquals(
        runtime.postman.failures.map(({ evt, deliveries }) => ({ evt, deliveries })),
        evts.slice(0, 2).map((evt, index) => ({
          evt,
          deliveries: index === 0 ? ["https://second.test/", "https://third.test/"] : ["https://second.test/"],
        })),
      );
      const [one, multiple] = runtime.postman.failures;
      assertInstanceOf(one.error, CesrHttpRefusal);
      assertEquals(one.error.status, 503);
      assertInstanceOf(multiple.error, AggregateError);
      assertEquals(multiple.error.errors.length, 2);
      for (const error of multiple.error.errors) {
        assertInstanceOf(error, CesrHttpRefusal);
        assertEquals(error.status, 503);
      }
      assertEquals(runtime.postman.hasPending, false);
      yield* runtime.postman.process();
      assertEquals(attempts.length, 9, "the successful receipt is complete and retained failures are not retried");

      hby.db.locs.pin([sender.pre, "http"], { url: "https://query.test/" });
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
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals(runtime.querying.hasPendingDelivery, false);
      assertEquals(queries, 9);
      refuse = false;
      runtime.postman.retry(evts[0]);
      yield* runtime.postman.process();
      assertEquals(attempts.slice(-3), ["first", "second", "third"].map((target) => ({ target, said: saids[0] })));
      assertEquals(
        runtime.postman.failures.map(({ evt }) => evt),
        [evts[1]],
        "retry may repeat previously successful targets",
      );
      assertEquals(runtime.postman.discard(evts[1]), true);
      assertEquals(runtime.postman.discard(evts[1]), false);
      assertEquals(runtime.postman.failures.length, 0);
    } finally {
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
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(_url, init) {
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
          },
        },
      },
    });
    runtime.cues.push({
      kin: "replay",
      msgs: [hab.query(hab.pre, hab.pre, { route: "logs", q: {} })],
      src: hab.pre,
      dest: hab.pre,
    });
    runtime.postman.findBytesRoute = () => ({
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct",
      bodyMode: "header",
      targets: [{ eid: hab.pre, url: "https://peer.test/" }],
    });
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
