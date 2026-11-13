import { call, run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { MtrDex, SerderKERI, type Siger, Signer, Vrsn_1_0, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { Signaler } from "../../../../src/app/notifications/signaling.ts";
import { createAgentRuntime, settleRuntimeIngress } from "../../../../src/app/runtime/agent-runtime.ts";
import { processCuesOnce } from "../../../../src/app/runtime/cue-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import {
  type ChangeSink,
  MemoryChangeSink,
  signalerChangeSink,
} from "../../../../src/app/runtime/workflow-contract.ts";
import { CesrHttpRefusal } from "../../../../src/app/transport/cesr-egress.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { AgentCue, KramRefusedCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { incept, reply } from "../../../../src/core/protocol-eventing.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { UnsupportedTelReplayError } from "../../../../src/db/replay/tel-replay.ts";
import { httpClient } from "../../../support/http-client.ts";
import { FakeRuntimeHttpClient } from "../../../support/runtime-fakes.ts";

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
      assertEquals(runtime.respondant.enqueueCue(hab, cues), "taken");
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

/** A refusal as KRAM publishes it; `said` varies so a test can tell messages apart. */
function refusal(said: string): KramRefusedCue {
  return {
    kin: "kramRefused",
    said,
    sender: "ESender",
    ilk: "exn",
    route: "/ipex/grant",
    reason: "timeliness",
    stamp: "2026-10-13T11:00:00.000000+00:00",
    deadline: "2026-10-13T11:00:06.000000+00:00",
  };
}

Deno.test("processCuesOnce publishes kramRefused to the runtime change sink and removes it", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const changes = new MemoryChangeSink();
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      operationStores: { changes },
    });
    try {
      assertStrictEquals(runtime.changes, changes, "the injected operation sink is the runtime's sink");
      const cue = refusal("ESaid");
      runtime.cues.push(cue);
      yield* processCuesOnce(runtime);
      assertEquals(changes.changes, [{ kind: "kramRefused", id: "ESaid", refusal: cue }]);
      assertEquals(runtime.cues.length, 0);

      // A faulty sink must not wedge the head of the Deck.
      const failure = new Error("sink failed");
      const broken: ChangeSink = {
        push: () => {
          throw failure;
        },
      };
      const faulty = { ...runtime, changes: broken };
      runtime.cues.push(refusal("EOther"));
      let caught: unknown;
      try {
        yield* processCuesOnce(faulty);
      } catch (error) {
        caught = error;
      }
      assertStrictEquals(caught, failure);
      assertEquals(runtime.cues.length, 0, "the cue was pulled before the sink saw it");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("processCuesOnce drops kramRefused when the runtime has no sink", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const bare = { ...runtime, changes: null };
      runtime.cues.push(refusal("ESaid"));
      yield* processCuesOnce(bare);
      assertEquals(runtime.cues.length, 0);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("signalerChangeSink carries the refusal and collapses a resent message", () => {
  const signaler = new Signaler();
  try {
    const sink = signalerChangeSink(signaler);
    const cue = refusal("ESaid");
    sink.push({ kind: "kramRefused", id: "ESaid", refusal: cue });
    sink.push({ kind: "kramRefused", id: "ESaid", refusal: cue });
    sink.push({ kind: "kramRefused", id: "EOther", refusal: refusal("EOther") });
    assertEquals(
      signaler.list().map((signal) => [signal.topic, signal.attrs, signal.ckey]),
      [
        ["/workflow/kramRefused", { id: "ESaid", ...cue }, "kramRefused:ESaid"],
        ["/workflow/kramRefused", { id: "EOther", ...refusal("EOther") }, "kramRefused:EOther"],
      ],
    );
  } finally {
    signaler.close();
  }
});

Deno.test("cue pass keeps an unsignable reply cue and routes the cues behind it", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const peer = hby.makeHab("peer");
    // A keyless habitat opened without its signer, as a custodial host has before it calls `hold`.
    const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
    const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
    const keyless = hby.makeSignedHab("keyless", undefined, {
      serder,
      sigers: [signer.sign(serder.raw, { index: 0 }) as Siger],
    });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const body = reply("/ksn", { i: keyless.pre }, { pre: keyless.pre, pvrsn: Vrsn_2_0 });
    const signed: AgentCue = { kin: "reply", serder: body, src: keyless.pre, dest: peer.pre };
    const replay: AgentCue = {
      kin: "replay",
      msgs: [peer.query(peer.pre, peer.pre, { route: "logs", q: {} })],
      src: keyless.pre,
      dest: peer.pre,
    };
    try {
      runtime.cues.append(signed);
      runtime.cues.append(replay);
      yield* processCuesOnce(runtime, { hab: keyless });
      assertEquals([...runtime.cues], [signed], "the reply that needs a signature waits");
      assertEquals([...runtime.postman.evts].map((evt) => evt.topic), ["/replay"], "the replay behind it went");

      hby.mgr.hold([signer]);
      yield* processCuesOnce(runtime, { hab: keyless });
      assertEquals(runtime.cues.empty, true);
      assertEquals([...runtime.postman.evts].map((evt) => evt.topic), ["/replay", "/reply"]);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("an accepted end-role reply reaches its consumer as a cue", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const http = new FakeRuntimeHttpClient();
    const runtime = yield* createAgentRuntime(hby, http, systemClock);
    try {
      const hab = hby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const mailbox = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false }).verfer.qb64;
      const url = "http://new.mailbox.test/";
      hby.db.locs.pin([mailbox, "http"], { url });
      http.registerOrigin(url, () => new Response(null, { status: 204 }));
      yield* settleRuntimeIngress(runtime, [hab.makeEndRole(mailbox, Roles.mailbox, true)]);
      assertEquals(runtime.cues.toArray(), [
        { kin: "endRoleSaved", cid: hab.pre, role: Roles.mailbox, eid: mailbox, allowed: true },
      ]);
      assertEquals(yield* runtime.kelPublisher.processDue(), [], "the publisher has not been told yet");
      yield* processCuesOnce(runtime);
      assertEquals(runtime.cues.empty, true);
      // The cue pass prompted the publisher: its next tock posts the KEL to the new mailbox without a sweep.
      const posted = yield* runtime.kelPublisher.processDue();
      assertEquals(posted.map((result) => result.outcome), ["told"]);
      assertEquals(http.requests.length, 1);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
