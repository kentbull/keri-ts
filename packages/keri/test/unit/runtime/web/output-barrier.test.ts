import { assert, assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import { type Operation, run, sleep, spawn } from "npm:effection@^3.6.0";
import { barrierHttpClient, OutputBarrierError } from "../../../../runtime-web.ts";
import type { HttpClient, HttpResponse, HttpStreamResponse } from "../../../../src/app/transport/http-client.ts";
import { PersistenceQueue } from "../../../../src/db/core/webdber.ts";

const response: HttpResponse = { status: 200, ok: true, headers: new Headers(), body: new Uint8Array() };
const stream: HttpStreamResponse = { status: 200, ok: true, headers: new Headers(), body: async function*() {} };

/** An inner client that records the order of events it observes. */
function recording(log: string[]): HttpClient {
  return {
    *request(url): Operation<HttpResponse> {
      log.push(`request ${url}`);
      return response;
    },
    *open(url): Operation<HttpStreamResponse> {
      log.push(`open ${url}`);
      return stream;
    },
  };
}

/** A flush that resolves when `release` is called. */
function gate(log: string[]) {
  let release!: () => void;
  const open = new Promise<void>((resolve) => release = resolve);
  return {
    flushed: async () => {
      await open;
      log.push("flushed");
    },
    release,
  };
}

Deno.test("barrier sends nothing until the flush resolves, for request and open", async () => {
  const log: string[] = [];
  const { flushed, release } = gate(log);
  const client = barrierHttpClient(recording(log), flushed);
  await run(function*() {
    const a = yield* spawn(() => client.request("a"));
    const b = yield* spawn(() => client.open("b"));
    yield* sleep(10);
    assertEquals(log, []);
    release();
    assertEquals((yield* a).status, 200);
    assertEquals((yield* b).status, 200);
  });
  assertEquals(log, ["flushed", "flushed", "request a", "open b"]);
});

Deno.test("barrier does not send and fails with a typed error when the flush rejects", async () => {
  const log: string[] = [];
  const cause = new Error("disk full");
  const client = barrierHttpClient(recording(log), () => Promise.reject(cause));
  const calls: Array<() => Operation<unknown>> = [() => client.request("a"), () => client.open("b")];
  for (const call of calls) {
    const error = await assertRejects(() => run(call), OutputBarrierError);
    assertEquals(error.cause, cause);
  }
  assertEquals(log, []);
});

Deno.test("barrier accepts an Operation flush and re-evaluates it per request", async () => {
  const log: string[] = [];
  const queue = new PersistenceQueue();
  let release!: () => void;
  queue.enqueue(() => new Promise<void>((resolve) => release = resolve));
  const client = barrierHttpClient(recording(log), () => queue.flushed());
  await run(function*() {
    const first = yield* spawn(() => client.request("first"));
    yield* sleep(10);
    assertEquals(log, []);
    release();
    yield* first;
    queue.enqueue(() => Promise.reject(new Error("write failed")));
    const error = yield* spawn(function*() {
      try {
        yield* client.request("second");
      } catch (e) {
        return e;
      }
    });
    assertInstanceOf(yield* error, OutputBarrierError);
  });
  assertEquals(log, ["request first"]);
});

Deno.test("barrier exposes no tcp dialer around itself", () => {
  const inner = { ...recording([]), tcp: {} as never };
  assert(barrierHttpClient(inner, () => Promise.resolve()).tcp === undefined);
});
