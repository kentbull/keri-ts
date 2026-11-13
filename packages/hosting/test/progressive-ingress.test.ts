import { createHabery } from "keri-ts/db/lmdb";
import { systemClock } from "../../keri/src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../keri/src/app/transport/http-client.ts";
import { httpClient } from "../../keri/test/support/http-client.ts";
// @file-test-lane app-fast-parallel
import {
  b,
  collectPayload,
  concatBytes,
  Counter,
  CtrDexV1,
  CtrDexV2,
  Diger,
  MtrDex,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealEvent,
  SerderKERI,
  type Siger,
  Signer,
  Texter,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run, sleep, spawn, suspend } from "effection";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import {
  type AgentRuntime,
  createAgentRuntime,
  cueDo,
  envelopeFromFrame,
  exchange,
  type Hab,
  type Habery,
  query,
  queryEnvelopeFromDispatch,
  readCesrRequestBytes,
} from "keri-ts/runtime";
import { completeEvent } from "../../keri/src/app/identity/event-completion.ts";
import { acceptedEventReplayMessage } from "../../keri/src/app/identity/habbing.ts";
import { KelPublisher } from "../../keri/src/app/mailbox/kel-publisher.ts";
import { collectKelSubmission } from "../../keri/src/app/mailbox/kel-submission.ts";
import type { ProtocolProcessor } from "../../keri/src/app/protocol/protocol-processing.ts";
import { abortable } from "../../keri/src/app/runtime/abortable.ts";
import { TransIdxSigGroup } from "../../keri/src/core/dispatch.ts";
import { exchange as stampedExchange, incept as inceptKel } from "../../keri/src/core/protocol-eventing.ts";
import { messagize, serializeMessage } from "../../keri/src/core/protocol-serialization.ts";
import { incept as inceptRegistry, issue } from "../../keri/src/core/protocol-vdr-eventing.ts";
import type { Reger } from "../../keri/src/db/reger.ts";
import { makeNowIso8601 } from "../../keri/src/time/mod.ts";
import { Tevery } from "../../keri/src/vdr/eventing.ts";
import { createProtocolHandler } from "../src/http/protocol-handler.ts";
import { buildProtocolRequestContext } from "../src/http/protocol/context.ts";

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
function enclose(code: string, bytes: Uint8Array, version: Versionage = { major: 1, minor: 0 }): Uint8Array {
  return concatBytes(new Counter({ code, count: bytes.length / 4, version }).qb64b, bytes);
}

/** Qualify a real v2 JSON inception body so its surrounding v2 counted groups remain quadlet-aligned. */
function child(hby: Habery, hab: Hab): Uint8Array {
  const { serder, message } = acceptedEventReplayMessage(hby, hab.pre, 0);
  const body = enclose(CtrDexV2.NonNativeBodyGroup, new Texter({ raw: serder.raw, code: "4B" }).qb64b, Vrsn_2_0);
  return enclose(
    CtrDexV2.BodyWithAttachmentGroup,
    concatBytes(body, message.subarray(serder.raw.length)),
    Vrsn_2_0,
  );
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
Deno.test("HTTP ingress waits for the complete enclosing group before accepting children", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: `http-source-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const target = yield* createHabery({ name: `http-target-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(target, new FetchHttpClient(), systemClock);
    // The real listener and client are owned until the gated upload completes or fails.
    const client = Deno.createHttpClient({});
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, createProtocolHandler(runtime));
    try {
      const alice = source.makeHab("alice");
      const bob = source.makeHab("bob");
      const first = child(source, alice);
      const second = child(source, bob);
      // Local habitats author v2 KEL events, so the enclosing stream selects the v2 genus.
      const wire = concatBytes(
        Counter.makeGVC(Vrsn_2_0),
        enclose(CtrDexV2.GenericGroup, concatBytes(first, second), Vrsn_2_0),
      );
      let release!: () => void;
      const waiting = Promise.withResolvers<void>();
      const tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reads = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (reads++ === 0) controller.enqueue(wire.slice(0, -second.length));
          else {
            // The upload is blocked after the first child, inside an incomplete enclosure.
            waiting.resolve();
            await tail;
            controller.enqueue(second);
            controller.close();
          }
        },
        cancel() {
          release();
        },
      }, { highWaterMark: 0 });
      // Release the response inside the fetch leaf; its signal aborts the response once the leaf returns.
      const upload = yield* spawn(() =>
        abortable(async (signal) => {
          const response = await fetch(`http://127.0.0.1:${server.addr.port}/`, {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body,
            client,
            signal,
          });
          await response.body?.cancel();
          return response.status;
        })
      );
      try {
        yield* call(() => promptly(waiting.promise));
        assertEquals(target.db.kevers.has(alice.pre), false);
        assertEquals(target.db.kevers.has(bob.pre), false);
      } finally {
        release();
      }
      assertEquals(yield* upload, 204);
      assertEquals(target.db.kevers.has(alice.pre), true);
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
    const hby = yield* createHabery({
      name: `http-cancel-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      for (
        const fault of [
          new Error("foreign source failure"),
        ]
      ) {
        const body = new ReadableStream<Uint8Array>({
          pull() {
            throw fault;
          },
        }, { highWaterMark: 0 });
        const failed = createProtocolHandler(runtime)(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body,
          }),
        );
        assertStrictEquals(yield* call(() => assertRejects(() => failed)), fault);
        assertEquals(body.locked, false);
      }
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
      for (const fault of [new Error("request cleanup I/O"), new DOMException("foreign abort", "AbortError")]) {
        let begin!: () => void;
        const ready = new Promise<void>((resolve) => begin = resolve);
        const source = new ReadableStream<Uint8Array>({
          pull() {
            begin();
          },
          cancel() {
            throw fault;
          },
        }, { highWaterMark: 0 });
        const abort = new AbortController();
        const pending = createProtocolHandler(runtime)(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: source,
            signal: abort.signal,
          }),
        );
        yield* call(() => promptly(ready));
        abort.abort();
        assertStrictEquals(yield* call(() => assertRejects(() => pending)), fault);
        assertEquals(source.locked, false);
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("concurrent HTTP queries acknowledge intake and publish replay through the ordinary mailbox owner", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-replies-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
    try {
      const alice = hby.makeHab("alice");
      const bob = hby.makeHab("bob");
      yield* runtime.reactor.processBytes(alice.makeEndRole(alice.pre, "mailbox", true));
      const background: string[] = [];
      const enqueue = runtime.respondant.enqueueCue.bind(runtime.respondant);
      runtime.respondant.enqueueCue = (hab, source, hint) => {
        const cue = source.peekHead();
        if (cue?.kin === "replay") background.push(cue.querySaid ?? "unreserved");
        return enqueue(hab, source, hint);
      };
      const worker = yield* spawn(() => cueDo(runtime, { hab: alice }));
      const handler = createProtocolHandler(runtime, { serviceHab: alice });
      // Replies use the ordinary responder even when requests and cue draining overlap.
      const requests = [alice, bob].map((hab) =>
        handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: alice.query(hab.pre, alice.pre, { route: "logs", q: {} }) as Uint8Array<ArrayBuffer>,
          }),
        )
      );
      const replies = yield* call(() => promptly(Promise.all(requests)));
      assertEquals(replies.map(reply => reply.status), [204, 204]);
      assertEquals(background.length, 2);
      yield* runtime.postman.process();
      const stored = [...runtime.mailboxer!.getTopicMsgs(`${alice.pre}/replay`)];
      const prefixes: (string | null)[] = [];
      for (const bytes of stored) {
        prefixes.push(...(yield* call(() => parseBytes(bytes))).map(frame => (frame.body as SerderKERI).pre));
      }
      assertEquals(prefixes.sort(), [alice.pre, bob.pre].sort());
      const open = runtime.mailboxDirector.streamQueryResponse.bind(runtime.mailboxDirector);
      for (const fault of [undefined, new DOMException("foreign late abort", "AbortError")]) {
        const abort = new AbortController();
        let cancelling!: () => void, finish!: () => void;
        const closing = new Promise<void>((resolve) => cancelling = resolve),
          gate = new Promise<void>((resolve) => finish = resolve);
        runtime.mailboxDirector.streamQueryResponse = said => {
          const response = open(said);
          const original = response.cancel.bind(response);
          response.cancel = async (reason) => {
            cancelling();
            await gate;
            await original(reason);
            if (fault) throw fault;
          };
          queueMicrotask(() => abort.abort());
          return response;
        };
        const pending = handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: alice.query(alice.pre, alice.pre, { route: "mbx", q: { topics: { "/replay": 0 } } }) as Uint8Array<
              ArrayBuffer
            >,
            signal: abort.signal,
          }),
        );
        void pending.catch(() => {});
        let settled = false;
        void pending.finally(() => settled = true).catch(() => {});
        try {
          yield* call(() => promptly(closing));
          assertEquals(settled, false, "Late abort joins the published response cleanup");
        } finally {
          finish();
        }
        if (fault) assertStrictEquals(yield* call(() => assertRejects(() => pending)), fault);
        else assertEquals((yield* call(() => promptly(pending))).status, 408);
      }
      runtime.mailboxDirector.streamQueryResponse = open;
      yield* worker.halt();
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("multi-frame ordinary HTTP queries publish every accepted replay without running outgoing workers", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-final-query-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      enableMailboxStore: true,
    });
    try {
      const alice = hby.makeHab("alice");
      const bob = hby.makeHab("bob");
      // Ordinary replies have a real local mailbox destination, so earlier query delivery is observable.
      yield* runtime.reactor.processBytes(alice.makeEndRole(alice.pre, "mailbox", true));
      const handler = createProtocolHandler(runtime, { serviceHab: alice });
      const requests = [
        concatBytes(
          alice.query(alice.pre, alice.pre, { route: "logs", q: {} }),
          acceptedEventReplayMessage(hby, bob.pre, 0).message,
        ),
        concatBytes(
          alice.query(bob.pre, alice.pre, { route: "logs", q: {} }),
          alice.query(alice.pre, alice.pre, { route: "logs", q: {} }),
        ),
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
      assertEquals(replies.map((reply) => reply.status), [204, 204]);
      /** Read the admitted event identities from both HTTP and mailbox delivery evidence. */
      const prefixes = async (bytes: Uint8Array) =>
        (await parseBytes(bytes)).map(({ body }) => (body as SerderKERI).pre);
      assertEquals(runtime.postman.hasPending, true, "HTTP publishes ordinary delivery without running Poster");
      assertEquals([...runtime.mailboxer!.getTopicMsgs(`${alice.pre}/replay`)], []);
      for (let pass = 0; pass < 8 && runtime.postman.hasPending; pass++) yield* runtime.postman.process();
      assertEquals(runtime.postman.hasPending, false);
      const ordinary: (string | null)[] = [];
      for (const bytes of runtime.mailboxer!.getTopicMsgs(`${alice.pre}/replay`)) {
        ordinary.push(...(yield* call(() => prefixes(bytes))));
      }
      assertEquals(ordinary.includes(alice.pre), true);
      assertEquals(ordinary.includes(bob.pre), true);
      const deniedBody = query("logs", { i: bob.pre, src: alice.pre }, { pre: alice.pre, pvrsn: Vrsn_2_0 });
      runtime.protocol.kvy.denyList.add(alice.pre);
      const before = [...runtime.mailboxer!.getTopicMsgs(`${alice.pre}/replay`)];
      const denied = yield* call(() =>
        handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: concatBytes(
              messagize(deniedBody, { sigers: alice.sign(deniedBody.raw, true), gvrsn: Vrsn_2_0 }),
              acceptedEventReplayMessage(hby, bob.pre, 0).message,
            ) as Uint8Array<ArrayBuffer>,
          }),
        )
      );
      assertEquals(denied.status, 204, "the independent trailing event still controls its own result");
      for (let pass = 0; pass < 8 && runtime.postman.hasPending; pass++) yield* runtime.postman.process();
      assertEquals(runtime.postman.hasPending, false);
      assertEquals([...runtime.mailboxer!.getTopicMsgs(`${alice.pre}/replay`)], before);
      runtime.protocol.kvy.denyList.clear();
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("HTTP truncated enclosure accepts neither ESSR sibling", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-essr-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
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
      assertEquals(yield* call(() => hby.db.getEssrs(first.serder.said!)), null);
      assertEquals(yield* call(() => hby.db.getEssrs(second.serder.said!)), null);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("HTTP cancellation closes an incomplete ESSR request before returning", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `http-essr-cancel-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const frame = essrChild(hby.makeHab("sender"), "unfinished-payload");
      const wire = concatBytes(Counter.makeGVC({ major: 1, minor: 0 }), frame.wire);
      const ready = Promise.withResolvers<void>();
      let reads = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(wire.slice(0, -3));
          else {
            ready.resolve(); // The reader is waiting for the declared enclosure tail.
          }
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
      } finally {
        controller.abort();
      }
      assertEquals((yield* call(() => promptly(response))).status, 408);
      assertEquals(yield* call(() => hby.db.getEssrs(frame.serder.said!)), null);
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
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
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
      runtime.protocol.kvy.denyList.add(sender.pre);
      const refused = yield* call(post);
      assertEquals(refused.status, 403);
      assertEquals(yield* call(() => refused.text()), "Query requester is not authorized");
      runtime.protocol.kvy.denyList.clear();
      const readmitted = yield* call(post);
      assertEquals(readmitted.status, 200);
      yield* call(() => readmitted.body?.cancel());
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("a mailbox host that holds only the inception refuses a rotated requester until the rotation is posted", async () => {
  await run(function*() {
    const client = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const host = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const service = host.makeHab("mailbox");
    const runtime = yield* createAgentRuntime(host, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
    try {
      const wallet = client.makeHab("wallet", undefined, { transferable: true, toad: 0 });
      yield* runtime.reactor.processBytes(collectKelSubmission(client, wallet.pre).replay);
      wallet.rotate({});
      const handler = createProtocolHandler(runtime, { serviceHab: service });
      const post = (body: Uint8Array) =>
        handler(
          new Request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: new Uint8Array(body),
          }),
        );
      const poll = wallet.query(wallet.pre, service.pre, { route: "mbx", q: { topics: { "/reply": 0 } } });
      const refused = yield* call(() => post(poll));
      assertEquals(refused.status, 403);
      assertEquals(yield* call(() => refused.text()), "Query requester is not authorized");
      const posted = yield* call(() => post(collectKelSubmission(client, wallet.pre).replay));
      assertEquals(posted.status, 204);
      const served = yield* call(() => post(poll));
      assertEquals(served.status, 200);
      assertEquals(served.headers.get("content-type")?.startsWith("text/event-stream"), true);
      yield* call(() => served.body?.cancel());
    } finally {
      yield* runtime.close();
      yield* host.close(true);
      yield* client.close(true);
    }
  });
});

/** A wallet with two mailbox hosts that hold only its inception; `down` makes one of them unreachable. */
function* rotatedWalletWithMailboxes(down: number | null) {
  const client = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const wallet = client.makeHab("wallet", undefined, { transferable: true, toad: 0 });
  const hosts: {
    host: Habery;
    service: Hab;
    runtime: AgentRuntime;
    url: string;
    handler: ReturnType<typeof createProtocolHandler>;
  }[] = [];
  for (const index of [0, 1]) {
    const host = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const service = host.makeHab("mailbox");
    const runtime = yield* createAgentRuntime(host, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
    yield* runtime.reactor.processBytes(collectKelSubmission(client, wallet.pre).replay);
    const url = `http://mailbox-${index}.test/`;
    client.db.locs.pin([service.pre, "http"], { url });
    client.db.ends.pin([wallet.pre, "mailbox", service.pre], { allowed: true });
    hosts.push({ host, service, runtime, url, handler: createProtocolHandler(runtime, { serviceHab: service }) });
  }
  const http = httpClient((url, init) => {
    const reached = hosts.findIndex((candidate) => url.startsWith(candidate.url));
    if (reached === down) throw new Error("connection refused");
    return hosts[reached].handler(new Request(url, init));
  });
  return { client, wallet, hosts, http };
}

/** Complete the wallet's rotation with a publisher announced to, then run one publisher pass. */
function* rotateAndPublish(
  { client, wallet, http }: { client: Habery; wallet: Hab; http: ReturnType<typeof httpClient> },
) {
  wallet.rotate({});
  const publisher = new KelPublisher({ hby: client, http, clock: systemClock });
  const completion = yield* completeEvent(
    {
      hby: client,
      protocol: {} as ProtocolProcessor,
      http,
      clock: systemClock,
      rotated: publisher.rotated,
      withDelegation() {
        throw new Error("not delegated");
      },
    },
    wallet,
    wallet.kever!.sn,
  );
  return { completion, publisher, results: yield* publisher.processOnce() };
}

Deno.test("completing a rotation prompts the publisher to tell every mailbox, whose next poll is then accepted", async () => {
  await run(function*() {
    const fixture = yield* rotatedWalletWithMailboxes(null);
    const { client, wallet, hosts } = fixture;
    try {
      const { completion, results, publisher } = yield* rotateAndPublish(fixture);
      assertEquals(completion.outcome, "settled");
      assertEquals(
        results.map((result) => result.mailbox).sort(),
        hosts.map(({ service }) => service.pre).sort(),
      );
      assertEquals(new Set(results.map((result) => result.outcome)), new Set(["told"]));
      assertEquals(publisher.status().entries.map((entry) => entry.state), ["published", "published"]);
      for (const { service, handler } of hosts) {
        const poll = wallet.query(wallet.pre, service.pre, { route: "mbx", q: { topics: { "/reply": 0 } } });
        const served = yield* call(() =>
          handler(
            new Request("http://localhost/", {
              method: "POST",
              headers: { "content-type": "application/cesr" },
              body: new Uint8Array(poll),
            }),
          )
        );
        assertEquals(served.status, 200);
        yield* call(() => served.body?.cancel());
      }
    } finally {
      for (const { runtime, host } of hosts) {
        yield* runtime.close();
        yield* host.close(true);
      }
      yield* client.close(true);
    }
  });
});

Deno.test("a mailbox that cannot be reached is reported by the publisher and does not fail the rotation", async () => {
  await run(function*() {
    const fixture = yield* rotatedWalletWithMailboxes(1);
    const { client, hosts } = fixture;
    try {
      const { completion, results, publisher } = yield* rotateAndPublish(fixture);
      assertEquals(completion.outcome, "settled");
      assertEquals(completion.status, { state: "complete" });
      const down = hosts[1].service.pre;
      assertEquals(
        results.map((result) => [result.mailbox === down, result.outcome]).sort(),
        [[false, "told"], [true, "failed"]],
      );
      const failed = publisher.status().entries.find((entry) => entry.mailbox === down)!;
      assertEquals([failed.state, failed.lastFailure], ["pending", "connection refused"]);
    } finally {
      for (const { runtime, host } of hosts) {
        yield* runtime.close();
        yield* host.close(true);
      }
      yield* client.close(true);
    }
  });
});

Deno.test("several local identifiers behind one ingress URL are routed by CESR-DESTINATION, and per-identifier paths still work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
    try {
      const [alice, bob, carol] = ["alice", "bob", "carol"].map((name) => hby.makeHab(name));
      // alice and bob share one URL (a custodial host); carol has a path of her own.
      for (const hab of [alice, bob]) hby.db.locs.pin([hab.pre, "http"], { url: "http://custody.test/" });
      hby.db.locs.pin([carol.pre, "http"], { url: "http://custody.test/carol" });
      const handler = createProtocolHandler(runtime);
      const wire = alice.query(alice.pre, alice.pre, { route: "logs", q: {} });
      const post = (path: string, destination?: string) =>
        new Request(`http://custody.test${path}`, {
          method: "POST",
          headers: { "content-type": "application/cesr", ...(destination ? { "CESR-DESTINATION": destination } : {}) },
          body: new Uint8Array(wire),
        });
      const routedTo = (request: Request) => {
        const route = buildProtocolRequestContext(request, runtime).genericIngress;
        return route?.kind === "one" ? route.endpoint?.eid : route?.kind;
      };
      // A message for each identifier is accepted and routed to that identifier.
      for (const hab of [alice, bob]) {
        assertEquals(routedTo(post("/", hab.pre)), hab.pre);
        const accepted = yield* call(() => handler(post("/", hab.pre)));
        assertEquals(accepted.status, 204);
        yield* call(() => accepted.body?.cancel());
      }
      // Neither the path nor a destination identifies one of them: still a conflict, and 409 says so.
      const unaddressed = yield* call(() => handler(post("/")));
      assertEquals(unaddressed.status, 409);
      assertEquals(yield* call(() => unaddressed.text()), "Ambiguous hosted endpoint path");
      // A destination that is not one of the identifiers behind the URL does not pick one either.
      assertEquals(routedTo(post("/", carol.pre)), "ambiguous");
      // The identifier with her own path is found by the path, whatever the destination says.
      assertEquals(routedTo(post("/carol")), carol.pre);
      assertEquals(routedTo(post("/carol", alice.pre)), carol.pre);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("a mailbox host serves a group's mailbox to a non-transferable member and refuses a stranger", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
    try {
      const keyless = (alias: string) => {
        const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
        const serder = inceptKel([signer.verfer.qb64], {
          version: Vrsn_2_0,
          code: signer.verfer.code,
          nsith: "0",
          toad: 0,
        });
        const hab = hby.makeSignedHab(alias, undefined, {
          serder,
          sigers: [signer.sign(serder.raw, { index: 0 }) as Siger],
        });
        hby.mgr.hold([signer]);
        return hab;
      };
      const member = keyless("member"), stranger = keyless("stranger");
      const peer = hby.makeHab("peer");
      const service = hby.makeHab("mailbox");
      const group = hby.makeGroupHab("team", member, [member.pre, peer.pre], [peer.pre], undefined, {
        isith: ["1", "1"],
        nsith: "1",
        toad: 0,
      }).hab;
      const handler = createProtocolHandler(runtime, { serviceHab: service });
      const poll = (signer: Hab) => (handler(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/cesr" },
          body: new Uint8Array(signer.query(group.pre, service.pre, { route: "mbx", q: { topics: { "/reply": 0 } } })),
        }),
      ));
      const served = yield* call(() => poll(member));
      assertEquals(served.status, 200, "the non-transferable member reads its group's mailbox");
      yield* call(() => served.body?.cancel());
      const refused = yield* call(() => poll(stranger));
      assertEquals(refused.status, 403);
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
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (url, init) => {
        outgoing.push(await readCesrRequestBytes(new Request(url, init)));
        return new Response(null, { status: 204 });
      }),
      systemClock,
      {
        enableMailboxStore: true,
        messagePolicy: { denyList: new Set([sender.pre]) },
        kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
      },
    );
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
      runtime.protocol.kvy.denyList.clear();
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
      {
        runtime.reactor.kvy.processQuery(queryEnvelopeFromDispatch(envelopeFromFrame(valid)));
        const source = SealEvent.fromTuple([
          new Prefixer({ qb64: sender.pre }),
          NumberPrimitive.fromNum(99n),
          new Diger({ qb64: sender.kever!.said }),
        ]);
        const missing = yield* call(() => post(0, [source]));
        assertEquals(missing.status, 403, "an older authorized cue cannot override missing source state");
        yield* call(() => missing.text());
        const pending = runtime.querying.pending.peekHead();
        assert(pending?.route === "logs");
        assertEquals(
          pending.q.s,
          "63",
          "HTTP preserves the exact missing-state query",
        );
        yield* runtime.reactor.processBytes(sender.makeEndRole(sender.pre, "controller", true));
        yield* runtime.reactor.processBytes(sender.makeLocScheme("http://example.test/", sender.pre, "http"));
        runtime.querying.configure({ hab: sender });
        yield* runtime.querying.deliverOnce();
        assertEquals(
          outgoing.length,
          5,
          "normal transport sends its KEL/location/role introduction before the recovery query",
        );
        const queryFrames = yield* call(() => parseBytes(outgoing.at(-1)!));
        {
          assertEquals((queryFrames.at(-1)!.body.ked?.q as Record<string, unknown>).s, "63");
        }
        assertEquals(runtime.querying.hasPendingWork(), false);
        const accepted = runtime.reactor.kvy.kramer!.intake(envelopeFromFrame(valid));
        assertEquals(accepted.kind, "ready");
        const duplicate = yield* call(() => post(0));
        assertEquals(duplicate.status, 403, "synchronous intake completes acceptance before later HTTP work");
        yield* call(() => duplicate.text());
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("HTTP TSN queries publish both independently verifiable replies through ordinary mailbox delivery", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer"),
      runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const requester = receiver.makeHab("requester"),
      target = yield* createAgentRuntime(receiver, new FetchHttpClient(), systemClock);
    try {
      const tvy = runtime.vdr!.tvy as Tevery,
        reger = runtime.vdr!.reger! as Reger,
        received = target.vdr!.reger! as Reger;
      const vcp = inceptRegistry(issuer.pre, { cnfg: ["NB"] });
      const credential = new Diger({ code: "E", raw: Diger.digest(b("HTTP credential"), "E") }).qb64;
      const iss = issue(credential, vcp.pre!);
      for (const event of [vcp, iss]) {
        issuer.interact({ data: [{ i: event.pre, s: event.snh, d: event.said }] });
        assertEquals(
          tvy.processEvent({
            serder: event,
            seqner: issuer.kever!.serder.sner!,
            saider: new Diger({ qb64: issuer.kever!.serder.said! }),
          }).kind,
          "accept",
        );
      }
      for (const wire of hby.db.clonePreIter(issuer.pre)) yield* target.reactor.processBytes(wire);
      for (const event of [vcp, iss]) yield* target.reactor.processBytes(reger.cloneTvt(event.pre!, event.said!));
      for (const wire of receiver.db.clonePreIter(requester.pre)) yield* runtime.reactor.processBytes(wire);
      yield* runtime.reactor.processBytes(requester.makeEndRole(issuer.pre, "mailbox", true));
      const handler = createProtocolHandler(runtime, { serviceHab: issuer });
      for (const id of [credential, requester.pre]) {
        const before = [...runtime.mailboxer!.getTopicMsgs(`${requester.pre}/reply`)].length;
        const response = yield* call(() =>
          promptly(handler(
            new Request("http://localhost/", {
              method: "POST",
              headers: { "content-type": "application/cesr" },
              body: requester.query(issuer.pre, issuer.pre, { route: "tsn", q: { ri: vcp.pre!, i: id } }) as Uint8Array<
                ArrayBuffer
              >,
            }),
          ))
        );
        assertEquals(response.status, 204);
        yield* runtime.postman.process();
        const bytes = concatBytes(...[...runtime.mailboxer!.getTopicMsgs(`${requester.pre}/reply`)].slice(before));

        const frames = yield* call(() => parseBytes(bytes));
        {
          assertEquals(
            frames.filter((frame) => (frame.body as SerderKERI).ilk === "rpy").map((frame) =>
              (frame.body as SerderKERI).route
            ),
            id === credential
              ? [`/tsn/registry/${issuer.pre}`, `/tsn/credential/${issuer.pre}`]
              : [`/tsn/registry/${issuer.pre}`],
          );
        }
        if (id === credential) {
          assertEquals(
            received.txnsb.current([credential, issuer.pre]),
            null,
            "HTTP status does not authenticate either reply",
          );
          yield* target.reactor.processBytes(bytes);
          assertExists(received.txnsb.current([vcp.pre!, issuer.pre]));
          assertExists(received.txnsb.current([credential, issuer.pre]));
        }
      }
    } finally {
      yield* target.close();
      yield* receiver.close(true);
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

/** Ingress harness: one KRAM-enabled runtime with an ordinary single-key sender and a POST helper. */
function* kramIngress(
  then: (h: {
    sender: Hab;
    post: (...wires: Uint8Array[]) => Promise<Response>;
    exn: (stamp: string, signed: boolean) => Uint8Array;
  }) => Operation<void>,
): Operation<void> {
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const sender = hby.makeHab("sender");
  const runtime = yield* createAgentRuntime(
    hby,
    httpClient(() => Promise.resolve(new Response(null, { status: 204 }))),
    systemClock,
    { kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } },
  );
  try {
    const handler = createProtocolHandler(runtime, { serviceHab: sender });
    const post = (...wires: Uint8Array[]) =>
      handler(
        new Request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/cesr" },
          body: new Uint8Array(concatBytes(...wires)),
        }),
      );
    // Unique routes keep each message's SAID distinct; the stamp alone decides timeliness.
    const exn = (stamp: string, signed: boolean) => {
      const body = stampedExchange(`/ingress/${crypto.randomUUID()}`, { sender: sender.pre, stamp });
      return signed ? messagize(body, { sigers: sender.sign(body.raw, true), gvrsn: Vrsn_2_0 }) : body.raw;
    };
    yield* then({ sender, post, exn });
  } finally {
    yield* runtime.close();
    yield* hby.close(true);
  }
}

/** Stamp far outside the one-second drift and five-second lag window of the test policy. */
const lateStamp = () => makeNowIso8601(new Date(Date.now() - 3_600_000));

Deno.test("ingress answers 422 to a KRAM-late authenticated message", async () => {
  await run(function*() {
    yield* kramIngress(function*({ post, exn }) {
      const response = yield* call(() => post(exn(lateStamp(), true)));
      assertEquals(response.status, 422);
      assertEquals(response.headers.get("content-type"), "text/plain");
      assertEquals(yield* call(() => response.text()), "KRAM refused message: timeliness");
    });
  });
});

Deno.test("ingress answers 204 to a replayed or unauthenticated message", async () => {
  await run(function*() {
    yield* kramIngress(function*({ post, exn }) {
      const fresh = exn(makeNowIso8601(), true);
      assertEquals((yield* call(() => post(fresh))).status, 204, "accepted");
      assertEquals((yield* call(() => post(fresh))).status, 204, "replayed");
      const unsigned = yield* call(() => post(exn(lateStamp(), false)));
      assertEquals(unsigned.status, 204, "an unauthenticated late message is not distinguishable from any other");
    });
  });
});

Deno.test("ingress status follows the final frame", async () => {
  await run(function*() {
    yield* kramIngress(function*({ post, exn }) {
      const late = exn(lateStamp(), true), fresh = exn(makeNowIso8601(), true);
      assertEquals((yield* call(() => post(late, fresh))).status, 204, "a later accepted frame wins");
      const last = yield* call(() => post(exn(makeNowIso8601(), true), exn(lateStamp(), true)));
      assertEquals(last.status, 422, "a later refused frame wins");
      yield* call(() => last.text());
    });
  });
});
