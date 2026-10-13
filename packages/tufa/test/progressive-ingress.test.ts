// @file-test-lane app-fast-parallel

import {
  b,
  collectPayload,
  concatBytes,
  Counter,
  CtrDexV1,
  Diger,
  discardFrame,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealEvent,
  SerderKERI,
  Texter,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, sleep, spawn, suspend } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import {
  createAgentRuntime,
  createHabery,
  cueDo,
  envelopeFromFrame,
  exchange,
  type Hab,
  type Habery,
  processRuntimeTurn,
  query,
  queryEnvelopeFromDispatch,
  readCesrRequestBytes,
} from "keri-ts/runtime";
import { abortable } from "../../keri/src/app/abortable.ts";
import { acceptedEventReplayMessage } from "../../keri/src/app/habbing.ts";
import { queryTransportSink } from "../../keri/src/app/query-transport.ts";
import { TransIdxSigGroup } from "../../keri/src/core/dispatch.ts";
import { messagize, serializeMessage } from "../../keri/src/core/protocol-serialization.ts";
import { createProtocolHandler } from "../src/http/protocol-handler.ts";

/** Bound a protocol-progress assertion so an atomic-parser regression fails instead of hanging. */
async function promptly<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Ingress stalled")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Count text quadlets explicitly after the JSON body has been wrapped as qualified text. */
function enclose(code: string, bytes: Uint8Array): Uint8Array {
  return concatBytes(new Counter({ code, count: bytes.length / 4, version: { major: 1, minor: 0 } }).qb64b, bytes);
}

/** Qualify a real JSON inception body so its surrounding counted groups remain quadlet-aligned. */
function child(hby: Habery, hab: Hab): Uint8Array {
  const { serder, message } = acceptedEventReplayMessage(hby, hab.pre, 0);
  const body = enclose(CtrDexV1.NonNativeBodyGroup, new Texter({ raw: serder.raw, code: "4B" }).qb64b);
  return enclose(CtrDexV1.BodyWithAttachmentGroup, concatBytes(body, message.subarray(serder.raw.length)));
}

/** Commit each logical value, then fragment its ESSR wire without changing that commitment. */
function essrChild(sender: Hab, text: string): { serder: SerderKERI; wire: Uint8Array } {
  const raw = b(text);
  const serder = exchange("/essr/http", {}, {
    sender: sender.pre,
    diger: new Diger({ raw: Diger.digest(raw, "E"), code: "E" }),
  })[0];
  // The outer BodyWithAttachmentGroup supplies the frame boundary after signatures and ESSR.
  const signed = sender.endorse(serder, { pipelined: false });
  const payload = concatBytes(
    new Counter({ code: CtrDexV1.ESSRPayloadGroup, count: 2, version: { major: 1, minor: 0 } }).qb64b,
    new Texter({ raw: raw.slice(0, 3), code: "4B" }).qb64b,
    new Texter({ raw: raw.slice(3), code: "4B" }).qb64b,
  );
  const body = enclose(CtrDexV1.NonNativeBodyGroup, new Texter({ raw: serder.raw, code: "4B" }).qb64b);
  return {
    serder,
    wire: enclose(CtrDexV1.BodyWithAttachmentGroup, concatBytes(body, signed.subarray(serder.size), payload)),
  };
}

Deno.test("HTTP ingress accepts the first nested child while its sibling remains unavailable", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: `http-source-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const target = yield* createHabery({ name: `http-target-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(target);
    // The real listener and client are owned until the gated upload completes or fails.
    const client = Deno.createHttpClient({});
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, createProtocolHandler(runtime));
    try {
      const alice = source.makeHab("alice");
      const bob = source.makeHab("bob");
      const first = child(source, alice);
      const second = child(source, bob);
      const wire = concatBytes(
        Counter.makeGVC({ major: 1, minor: 0 }),
        enclose(CtrDexV1.GenericGroup, concatBytes(first, second)),
      );
      let release!: () => void;
      const tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reads = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (reads++ === 0) controller.enqueue(wire.slice(0, -second.length));
          else {
            // Fetch may prefetch this pull, but the second child remains unavailable until acceptance is observed.
            await tail;
            controller.enqueue(second);
            controller.close();
          }
        },
        cancel() {
          release();
        },
      }, { highWaterMark: 0 });
      const upload = yield* spawn(function*() {
        const response = yield* abortable((signal) =>
          fetch(`http://127.0.0.1:${server.addr.port}/`, {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body,
            client,
            signal,
          })
        );
        yield* call(() => response.body?.cancel());
        return response.status;
      });
      try {
        // Bound the assertion wait; observing accepted KEL state is stronger than observing parser delivery.
        for (let attempt = 0; attempt < 200 && !target.db.kevers.has(alice.pre); attempt++) yield* sleep(10);
        assertEquals(target.db.kevers.has(alice.pre), true);
        assertEquals(target.db.kevers.has(bob.pre), false);
      } finally {
        release();
      }
      assertEquals(yield* upload, 204);
      assertEquals(target.db.kevers.has(bob.pre), true);
    } finally {
      yield* call(() => server.shutdown());
      client.close();
      yield* runtime.close();
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("HTTP cancellation closes a blocked body and joins its parser task", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-cancel-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby);
    try {
      let reading!: () => void;
      const ready = new Promise<void>((resolve) => {
        reading = resolve;
      });
      let cancelled = false;
      let cancelling!: () => void;
      let release!: () => void;
      const cancelStarted = new Promise<void>((resolve) => {
        cancelling = resolve;
      });
      const cleanup = new Promise<void>((resolve) => {
        release = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        pull() {
          reading();
        },
        async cancel() {
          cancelled = true;
          cancelling();
          await cleanup;
        },
      }, { highWaterMark: 0 });
      const controller = new AbortController();
      const request = new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/cesr" },
        body,
        signal: controller.signal,
      });
      const response = createProtocolHandler(runtime)(request);
      yield* call(() => promptly(ready));
      let responded = false;
      response.then(() => {
        responded = true;
      });
      controller.abort();
      try {
        yield* call(() => promptly(cancelStarted));
        // The request must join transport cancellation instead of merely releasing its parser await.
        yield* call(() => Promise.resolve());
        assertEquals(responded, false);
      } finally {
        release();
      }
      assertEquals((yield* call(() => promptly(response))).status, 408);
      assertEquals(cancelled, true);
      assertEquals(body.locked, false);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("concurrent HTTP queries keep their own replay while background cues drain", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-replies-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const alice = hby.makeHab("alice");
      const bob = hby.makeHab("bob");
      const background: string[] = [];
      const worker = yield* spawn(() =>
        cueDo(runtime, {
          hab: alice,
          sink: {
            *send(emission) {
              if (emission.cue.kin === "replay") background.push(emission.cue.querySaid ?? "unreserved");
            },
          },
        })
      );
      const handler = createProtocolHandler(runtime, { serviceHab: alice, directQueryResponses: true });
      // Both requests share protocol state and the cue worker, but each reserves its query SAID before dispatch.
      const requests = [alice, bob].map((hab) =>
        handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: alice.query(hab.pre, alice.pre, {}, "logs") as Uint8Array<ArrayBuffer>,
          }),
        )
      );
      const replies = yield* call(() => promptly(Promise.all(requests)));
      for (let index = 0; index < replies.length; index++) {
        assertEquals(replies[index].status, 200);
        const bytes = yield* call(async () => new Uint8Array(await replies[index].arrayBuffer()));
        const prefixes = (yield* call(() => parseBytes(bytes))).map((frame) => {
          assertInstanceOf(frame.body, SerderKERI);
          return frame.body.pre;
        });
        assertEquals(prefixes, [[alice.pre], [bob.pre]][index]);
      }
      assertEquals(background, []);
      yield* worker.halt();
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("only the final query controls a multi-frame HTTP response", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-final-query-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
    try {
      const alice = hby.makeHab("alice");
      const bob = hby.makeHab("bob");
      // Ordinary replies have a real local mailbox destination, so earlier query delivery is observable.
      yield* runtime.reactor.processBytes(alice.makeEndRole(alice.pre, "mailbox", true));
      const handler = createProtocolHandler(runtime, { serviceHab: alice, directQueryResponses: true });
      const requests = [
        concatBytes(alice.query(alice.pre, alice.pre, {}, "logs"), acceptedEventReplayMessage(hby, bob.pre, 0).message),
        concatBytes(alice.query(bob.pre, alice.pre, {}, "logs"), alice.query(alice.pre, alice.pre, {}, "logs")),
      ];
      const replies: Response[] = [];
      for (const body of requests) {
        replies.push(
          yield* call(() =>
            promptly(handler(
              new Request("http://localhost/", {
                method: "POST",
                headers: { "content-type": "application/cesr" },
                body: body as Uint8Array<ArrayBuffer>,
              }),
            ))
          ),
        );
      }
      assertEquals(replies.map((reply) => reply.status), [204, 200]);
      const direct = yield* call(async () => new Uint8Array(await replies[1].arrayBuffer()));
      /** Read the admitted event identities from both HTTP and mailbox delivery evidence. */
      const prefixes = async (bytes: Uint8Array) =>
        (await parseBytes(bytes)).map(({ body }) => (body as SerderKERI).pre);
      assertEquals(yield* call(() => prefixes(direct)), [alice.pre]);
      const ordinary: (string | null)[] = [];
      for (const bytes of runtime.mailboxer!.getTopicMsgs(`${alice.pre}/replay`)) {
        ordinary.push(...(yield* call(() => prefixes(bytes))));
      }
      assertEquals(ordinary.includes(alice.pre), true);
      assertEquals(ordinary.includes(bob.pre), true);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("HTTP ESSR ownership survives a later truncated sibling and leaves no partial file", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-essr-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const sender = hby.makeHab("sender");
      const first = essrChild(sender, "first-payload");
      const second = essrChild(sender, "second-payload");
      const complete = concatBytes(
        Counter.makeGVC({ major: 1, minor: 0 }),
        enclose(CtrDexV1.GenericGroup, concatBytes(first.wire, second.wire)),
      );
      // The enclosure promises both children, but the second child's final token never arrives.
      const response = yield* call(() =>
        createProtocolHandler(runtime)(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: complete.slice(0, -3),
          }),
        )
      );
      assertEquals(response.status, 400);
      const stored = yield* call(() => hby.db.getEssr(first.serder.said!));
      assertExists(stored, yield* call(() => response.text()));
      assertEquals(yield* call(() => collectPayload(stored.raw, 32)), b("first-payload"));
      assertEquals(yield* call(() => hby.db.getEssr(second.serder.said!)), null);
      assertEquals(Array.from(Deno.readDirSync(join(hby.db.path!, "payloads", "objects"))).length, 1);
      assertEquals(Array.from(Deno.readDirSync(join(hby.db.path!, "payloads", "staging"))).length, 0);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("HTTP cancellation removes an in-progress ESSR stage before returning", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-essr-cancel-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby);
    try {
      const frame = essrChild(hby.makeHab("sender"), "unfinished-payload");
      const wire = concatBytes(Counter.makeGVC({ major: 1, minor: 0 }), frame.wire);
      const ready = Promise.withResolvers<void>();
      let reads = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(wire.slice(0, -3));
          else ready.resolve(); // The file sink exists before parsing requests the missing token tail.
        },
      }, { highWaterMark: 0 });
      const controller = new AbortController();
      const response = createProtocolHandler(runtime)(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/cesr" },
          body,
          signal: controller.signal,
        }),
      );
      try {
        yield* call(() => promptly(ready.promise));
        assertEquals(Array.from(Deno.readDirSync(join(hby.db.path!, "payloads", "staging"))).length, 1);
      } finally {
        controller.abort();
      }
      assertEquals((yield* call(() => promptly(response))).status, 408);
      assertEquals(Array.from(Deno.readDirSync(join(hby.db.path!, "payloads", "staging"))).length, 0);
      assertEquals(yield* call(() => hby.db.getEssr(frame.serder.said!)), null);
      assertEquals(body.locked, false);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("v2 sender refusal cannot reopen a previously authorized HTTP mailbox query", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby, {
      enableMailboxStore: true,
      messagePolicy: { allowList: new Set([sender.pre]) },
    });
    try {
      const handler = createProtocolHandler(runtime, { serviceHab: sender });
      const body = query("mbx", { i: sender.pre, src: sender.pre, topics: { "/reply": 0 } }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const wire = messagize(body, { sigers: sender.sign(body.raw, true), gvrsn: Vrsn_2_0 });
      /** Reuse the exact signed SAID so an earlier stream cue cannot authorize denied intake. */
      const post = () =>
        handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: new Uint8Array(wire),
          }),
        );
      const accepted = yield* call(post);
      assertEquals(accepted.status, 200);
      yield* call(() => accepted.body?.cancel());
      runtime.reactor.kevery.denyList.add(sender.pre);
      const refused = yield* call(post);
      assertEquals(refused.status, 403);
      assertEquals(yield* call(() => refused.text()), "Query requester is not authorized");
      runtime.reactor.kevery.denyList.clear();
      const readmitted = yield* call(post);
      assertEquals(readmitted.status, 200);
      yield* call(() => readmitted.body?.cancel());
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM HTTP mailbox authorization uses the complete sender pool and refuses pending, denied and replayed requests", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender", undefined, { icount: 3, isith: "2", ncount: 3, nsith: "2" });
    const outgoing: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          fetch: async (url, init) => {
            outgoing.push(await readCesrRequestBytes(new Request(url, init)));
            return new Response(null, { status: 204 });
          },
        },
      },
      enableMailboxStore: true,
      messagePolicy: { denyList: new Set([sender.pre]) },
      kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    try {
      const handler = createProtocolHandler(runtime, { serviceHab: sender });
      let body = query("mbx", { i: sender.pre, src: sender.pre, topics: { "/reply": 0 } }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const post = (index: number, sourceSeals: readonly SealEvent[] = []) =>
        handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: new Uint8Array(
              serializeMessage(body, {
                tsgs: [
                  new TransIdxSigGroup(
                    new Prefixer({ qb64: sender.pre }),
                    sender.kever!.sner,
                    new Diger({ qb64: sender.kever!.said }),
                    [sender.sign(body.raw, true)[index]],
                  ),
                ],
                sourceSeals,
                gvrsn: Vrsn_2_0,
              }),
            ),
          }),
        );
      const key = [sender.pre, body.said!];
      const denied = yield* call(() => post(0));
      assertEquals(denied.status, 403);
      yield* call(() => denied.text());
      assertEquals(hby.db.msgc.get(key), null, "sender denial precedes KRAM durable effects");
      runtime.reactor.kevery.denyList.clear();
      const pending = yield* call(() => post(0));
      assertEquals(pending.status, 403);
      yield* call(() => pending.text());
      assertExists(hby.db.pmkm.get(key));
      assertEquals(hby.db.pmks.get(key).map((s) => s.index), [0]);
      const ready = yield* call(() => post(1));
      assertEquals(ready.status, 200, "the combined two-signature pool authorizes this HTTP attempt");
      yield* call(() => ready.body?.cancel());
      assertEquals(hby.db.pmkm.get(key), null);
      assertExists(hby.db.msgc.get(key));
      const replay = yield* call(() => post(1));
      assertEquals(replay.status, 403, "an old matching mailbox cue cannot override KRAM replay refusal");
      yield* call(() => replay.text());
      body = query("mbx", { i: sender.pre, src: sender.pre, topics: { "/reply": 0 }, probe: "guards" }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const [valid] = yield* call(() =>
        parseBytes(messagize(body, { sigers: sender.sign(body.raw, true), gvrsn: Vrsn_2_0 }))
      );
      try {
        runtime.reactor.kevery.processQuery(queryEnvelopeFromDispatch(envelopeFromFrame(valid)));
        const source = SealEvent.fromTuple([
          new Prefixer({ qb64: sender.pre }),
          NumberPrimitive.fromNum(99n),
          new Diger({ qb64: sender.kever!.said }),
        ]);
        const missing = yield* call(() => post(0, [source]));
        assertEquals(missing.status, 403, "an older authorized cue cannot override missing source state");
        yield* call(() => missing.text());
        assertEquals(
          runtime.querying.pending.peekHead()?.query.s,
          "63",
          "HTTP preserves the exact missing-state query",
        );
        yield* runtime.reactor.processBytes(sender.makeEndRole(sender.pre, "controller", true));
        yield* runtime.reactor.processBytes(sender.makeLocScheme("http://example.test/", sender.pre, "http"));
        yield* processRuntimeTurn(runtime, {
          hab: sender,
          pollMailbox: false,
          sink: queryTransportSink(runtime, hby, sender),
        });
        assertEquals(
          outgoing.length,
          5,
          "normal transport sends its KEL/location/role introduction before the recovery query",
        );
        const queryFrames = yield* call(() => parseBytes(outgoing.at(-1)!));
        try {
          assertEquals((queryFrames.at(-1)!.body.ked?.q as Record<string, unknown>).s, "63");
        } finally {
          yield* call(() => Promise.all(queryFrames.map(discardFrame)));
        }
        assertEquals(runtime.querying.hasPendingWork(), false);
        const started = Promise.withResolvers<void>();
        const held = yield* spawn(() =>
          runtime.reactor.kevery.kramer!.intake(envelopeFromFrame(valid), function*() {
            started.resolve();
            yield* suspend();
          })
        );
        try {
          yield* call(() => started.promise);
          const busy = yield* call(() => post(0));
          assertEquals(busy.status, 403, "an older authorized cue cannot override live intake refusal");
          yield* call(() => busy.text());
        } finally {
          yield* held.halt();
        }
      } finally {
        yield* call(() => discardFrame(valid));
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
