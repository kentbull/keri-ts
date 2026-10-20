import { type CesrFrame, parseBytes, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { envelopeFromFrame } from "../../../src/app/parsering.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { TransportError } from "../../../src/app/transport-error.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { Roles } from "../../../src/core/roles.ts";
import { httpClient } from "../../support/http-client.ts";

Deno.test("Poster completion belongs to a concrete admission and does not determine idle", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), first = hby.makeHab("first"), second = hby.makeHab("second");
    const posted: string[] = [];
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (url, init) => {
        await readCesrRequestBytes(new Request(url, init));
        posted.push(String(url));
        return new Response(null, { status: 204 });
      }),
      systemClock,
    );
    const postman = runtime.postman;
    try {
      for (const hab of [first, second]) {
        hby.db.locs.pin([hab.pre, "http"], { url: `https://${hab.name}.test/` });
        hby.db.ends.pin([hab.pre, Roles.controller, hab.pre], { allowed: true });
      }
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const args = { src: sender.pre, dest: first.pre, topic: "/reply", msg };
      const one = postman.send(args, { notify: true });
      const two = postman.send({ ...args, dest: second.pre }, { notify: true });
      const again = postman.send(args, { notify: true });
      assertEquals(posted, [], "admission is not transmission");
      assertEquals(postman.hasPending, true);
      yield* postman.process();
      assertEquals(postman.hasPending, false);
      assertEquals(postman.cues.length, 3);
      const later = yield* postman.wait(again);
      assertStrictEquals(later.evt, again);
      assertEquals(later.deliveries, ["https://first.test/"]);
      assertEquals(postman.cues.length, 2, "the earlier same-SAID outcome remains independent");
      const other = yield* postman.wait(two);
      assertStrictEquals(other.evt, two);
      assertEquals(other.deliveries, ["https://second.test/"]);
      assertStrictEquals((yield* postman.wait(one)).evt, one);
      assertEquals([postman.cues.length, postman.hasPending], [0, false]);
      assertEquals(posted, ["https://first.test/", "https://second.test/", "https://first.test/"]);

      const cancelled = postman.send(args, { notify: true });
      const waiter = yield* spawn(() => postman.wait(cancelled));
      yield* waiter.halt();
      postman.send(args);
      yield* postman.process();
      assertEquals(postman.cues.empty, true, "cancelled and fire-and-forget sends leave no completion history");
      assertEquals(postman.hasPending, false);

      for (
        const construction of [
          new ValidationError("invalid constructed protocol message"),
          new TransportError("a typed preparation failure is not a network outcome"),
        ]
      ) {
        postman.prepareBytesTarget = function*() {
          throw construction;
        };
        const broken = postman.send(args, { notify: true });
        const thrown = yield* call(() => assertRejects(() => run(() => postman.process())));
        assertStrictEquals(thrown, construction, "preparation failures must escape the worker regardless of type");
        const observed = yield* postman.wait(broken);
        assertEquals(observed.kin, "failed");
        if (observed.kin === "failed") assertStrictEquals(observed.error, construction);
      }
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("Poster contains native connection and response-body failures while later deliveries complete", async () => {
  const sockets = new Set<Socket>(), requests: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.once("end", () => {
      requests.push(req.url!);
      res.setHeader("Connection", "close");
      if (req.url === "/truncated") {
        res.writeHead(200, { "Content-Length": 2 });
        res.end("x");
      } else {
        res.writeHead(204);
        res.end();
      }
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const unavailable = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const refusedUrl = `http://127.0.0.1:${(unavailable.addr as Deno.NetAddr).port}/`;
  unavailable.close();
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient"), later = hby.makeHab("later");
        const postman = runtime.postman;
        postman.findBytesRoute = (_hab, args) => ({
          sender: sender.pre,
          recipient: args.recipient,
          topic: "/reply",
          kind: "direct",
          bodyMode: "header",
          targets: (args.recipient === later.pre ? [`${url}/later`] : [refusedUrl, `${url}/truncated`, `${url}/good`])
            .map((url) => ({ eid: args.recipient, url })),
        });
        const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
        const failed = postman.send({ src: sender.pre, dest: recipient.pre, topic: "/reply", msg }, { notify: true });
        const next = postman.send({ src: sender.pre, dest: later.pre, topic: "/reply", msg }, { notify: true });
        const worker = yield* spawn(() => postman.deliverDo());
        try {
          const outcome = yield* postman.wait(failed);
          assertEquals(outcome.kin, "failed");
          if (outcome.kin !== "failed") throw new Error("Expected failed delivery");
          assertEquals(outcome.deliveries, [`${url}/good`]);
          assertInstanceOf(outcome.error, AggregateError);
          assertEquals(outcome.error.errors.map((error: Error) => error.message), [
            `HTTP request failed for ${refusedUrl}`,
            `HTTP response body failed for ${url}/truncated`,
          ]);
          for (const error of outcome.error.errors) {
            assertInstanceOf(error, TransportError);
            assertInstanceOf(error.cause, Error, "native failures retain their original causes");
          }
          assertStrictEquals(postman.failures[0].evt, failed);
          assertStrictEquals(
            postman.failures[0].error,
            outcome.error,
            "observation preserves the retained failure object",
          );
          const sent = yield* postman.wait(next);
          assertEquals(sent.kin, "sent");
          assertEquals(sent.deliveries, [`${url}/later`]);
          assertEquals(requests, ["/truncated", "/good", "/later"]);
          assertEquals(postman.hasPending, false);
        } finally {
          yield* worker.halt();
        }
      } finally {
        yield* runtime.close();
        yield* hby.close(true);
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("Poster retains prior refusal and success when later target preparation throws", async () => {
  const requested: string[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
    await readCesrRequestBytes(request);
    const path = new URL(request.url).pathname;
    requested.push(path);
    return new Response(null, { status: path === "/refused" ? 503 : 204 });
  });
  const url = `http://127.0.0.1:${server.addr.port}`;
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
        const postman = runtime.postman;
        postman.findBytesRoute = () => ({
          sender: sender.pre,
          recipient: recipient.pre,
          topic: "/reply",
          kind: "direct",
          bodyMode: "header",
          targets: ["/refused", "/good", "/broken"].map((path) => ({ eid: recipient.pre, url: url + path })),
        });
        const preparation = new Error("later forwarding construction failed");
        const prepare = postman.prepareBytesTarget;
        postman.prepareBytesTarget = function*(hab, route, endpoint, msg) {
          if (endpoint.url.endsWith("/broken")) throw preparation;
          return yield* prepare.call(this, hab, route, endpoint, msg);
        };
        const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
        const evt = postman.send({ src: sender.pre, dest: recipient.pre, topic: "/reply", msg }, { notify: true });
        const failure = yield* call(() => assertRejects(() => run(() => postman.process()), AggregateError));
        assertEquals(failure.errors.length, 2);
        assertInstanceOf(failure.errors[0], CesrHttpRefusal);
        assertEquals(failure.errors[0].status, 503);
        assertEquals(failure.errors[0].message.includes(`${url}/refused`), true);
        assertStrictEquals(failure.errors[1], preparation);
        assertStrictEquals(failure.cause, preparation);
        const outcome = yield* postman.wait(evt);
        assertEquals(outcome.kin, "failed");
        if (outcome.kin !== "failed") throw new Error("Expected failed delivery");
        assertStrictEquals(outcome.error, failure);
        assertStrictEquals(postman.failures[0], outcome);
        assertStrictEquals(outcome.evt, evt);
        assertEquals(outcome.evt.msg, msg);
        assertEquals(outcome.deliveries, [`${url}/good`]);
        assertEquals(postman.hasPending, false);
        assertEquals(requested, ["/refused", "/good"]);
      } finally {
        yield* runtime.close();
        yield* hby.close(true);
      }
    });
  } finally {
    await server.shutdown();
  }
});
