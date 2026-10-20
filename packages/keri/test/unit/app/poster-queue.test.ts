import { call, run, spawn } from "effection";
import { assertEquals, assertInstanceOf, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { TransportError } from "../../../src/app/transport-error.ts";
import { ValidationError } from "../../../src/core/errors.ts";
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

      // A real indirect target invokes signing before any network attempt.
      const provider = "E" + "A".repeat(43);
      hby.db.ends.rem([first.pre, Roles.controller, first.pre]);
      hby.db.ends.pin([first.pre, Roles.mailbox, provider], { allowed: true });
      hby.db.locs.pin([provider, "http"], { url: "https://first.test/" });
      for (
        const construction of [
          new ValidationError("invalid constructed protocol message"),
          new TransportError("a typed preparation failure is not a network outcome"),
        ]
      ) {
        const endorse = sender.endorse;
        sender.endorse = () => {
          throw construction;
        };
        const broken = postman.send(args, { notify: true });
        const thrown = yield* call(() => assertRejects(() => run(() => postman.process())));
        assertStrictEquals(thrown, construction, "preparation failures must escape the worker regardless of type");
        const observed = yield* postman.wait(broken);
        assertEquals(observed.kin, "failed");
        if (observed.kin === "failed") assertStrictEquals(observed.error, construction);
        sender.endorse = endorse;
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
        for (const [index, target] of [refusedUrl, `${url}/truncated`, `${url}/good`].entries()) {
          const eid = `endpoint-${index}`;
          hby.db.ends.pin([recipient.pre, Roles.controller, eid], { allowed: true });
          hby.db.locs.pin([eid, "http"], { url: target });
        }
        hby.db.ends.pin([later.pre, Roles.controller, later.pre], { allowed: true });
        hby.db.locs.pin([later.pre, "http"], { url: `${url}/later` });
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
        for (const [index, target] of [`${url}/refused`, `${url}/good`, "invalid endpoint URL"].entries()) {
          const eid = `endpoint-${index}`;
          hby.db.ends.pin([recipient.pre, Roles.controller, eid], { allowed: true });
          hby.db.locs.pin([eid, "http"], { url: target });
        }
        const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
        const evt = postman.send({ src: sender.pre, dest: recipient.pre, topic: "/reply", msg }, { notify: true });
        const failure = yield* call(() => assertRejects(() => run(() => postman.process()), AggregateError));
        assertEquals(failure.errors.length, 2);
        assertInstanceOf(failure.errors[0], CesrHttpRefusal);
        assertEquals(failure.errors[0].status, 503);
        assertEquals(failure.errors[0].message.includes(`${url}/refused`), true);
        assertInstanceOf(failure.errors[1], TypeError);
        assertStrictEquals(failure.cause, failure.errors[1]);
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
