import { call, run, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { consumeMailboxSse, type MailboxSseMessage, readMailboxSseBody } from "../../../src/app/mailbox-sse.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { httpResponse } from "../../support/http-client.ts";

/** Encode wire fixtures with the same UTF-8 boundary as HTTP. */
const encoder = new TextEncoder();

Deno.test("mailbox SSE awaits each event consumer and preserves fragmented UTF-8 and CRLF", async () => {
  const first = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pulls = 0;
  let cancelled = false;
  const chunks = [
    "id: 0\r\nevent: /reply\r\ndata: café\r\n\r\n",
    "id: 1\nevent: /reply\ndata:  leading\ndata: second\n\n",
  ];
  const wire = encoder.encode(chunks.join(""));
  const received: MailboxSseMessage[] = [];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      // Single-byte chunks split both CRLF and the multibyte é; no decoder may drop either.
      if (pulls < wire.length) controller.enqueue(wire.slice(pulls, ++pulls));
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const task = run(function*() {
    yield* consumeMailboxSse(httpResponse(new Response(body)), new AbortController(), function*(event) {
      received.push(event);
      if (received.length === 1) {
        first.resolve();
        yield* call(() => release.promise);
      }
      return received.length < 2;
    }, systemClock);
  });
  await first.promise;
  assertEquals(pulls, encoder.encode(chunks[0]).length); // No second-event read while the consumer processes the first event.
  release.resolve();
  await task;
  assertEquals(received.map(({ msg }) => new TextDecoder().decode(msg)), ["café", " leading\nsecond"]);
  assertEquals(cancelled, true);
});

Deno.test("mailbox SSE waits for a slow fragmented first event and discards a truncated tail", async () => {
  const received: number[] = [];
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // The first fragment pauses longer than the post-event idle budget.
      if (sent++ === 0) controller.enqueue(encoder.encode("id: 7\nevent: /reply\ndata: par"));
      else if (sent === 2) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.enqueue(encoder.encode("tial\n\nid: 8\nevent: /reply\ndata: lost"));
      } else controller.close();
    },
  }, { highWaterMark: 0 });
  await run(function*() {
    yield* consumeMailboxSse(
      httpResponse(new Response(body)),
      new AbortController(),
      function*(event) {
        received.push(event.idx);
      },
      systemClock,
      { idleTimeoutMs: 5, maxDurationMs: 1000 },
    );
  });
  assertEquals(received, [7]); // An unterminated event must not advance mailbox acknowledgment.
});

Deno.test("mailbox SSE timeout cancels and joins its sole pending read", async () => {
  for (const nativeAbort of [false, true]) {
    const controller = new AbortController();
    let pulls = 0;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      start(bodyController) {
        if (nativeAbort) {
          controller.signal.addEventListener("abort", () => bodyController.error(controller.signal.reason));
        }
      },
      pull() {
        pulls++;
      },
      cancel() {
        cancelled++;
      },
    }, { highWaterMark: 0 });
    await run(function*() {
      yield* consumeMailboxSse(httpResponse(new Response(body)), controller, function*() {}, systemClock, {
        idleTimeoutMs: 2,
        maxDurationMs: 25,
      });
    });
    assertEquals(pulls, 1); // Timeout cannot abandon one read and begin another.
    assertEquals(cancelled, nativeAbort ? 0 : 1);
    assertEquals(body.locked, false);
  }
});

Deno.test("mailbox SSE propagates cleanup failure and unlocks after a consumer stops", async () => {
  for (const primary of [undefined, new Error("SSE consumer failed")]) {
    const fault = new Error("SSE cancellation failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("id: 0\nevent: /reply\ndata: hello\n\n"));
      },
      cancel() {
        throw fault;
      },
    });
    const failure = await assertRejects(() =>
      run(() =>
        consumeMailboxSse(httpResponse(new Response(body)), new AbortController(), function*() {
          if (primary) throw primary;
          return false;
        }, systemClock)
      )
    );
    if (primary) assertEquals((failure as AggregateError).errors, [primary, fault]);
    else assertStrictEquals(failure, fault);
    assertEquals(body.locked, false);
  }
});

Deno.test("mailbox SSE scope cancellation stops a blocked consumer and releases its reader", async () => {
  const delivered = Promise.withResolvers<void>();
  let continued = false;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("id: 0\nevent: /reply\ndata: hello\n\n"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const task = run(function*() {
    yield* consumeMailboxSse(httpResponse(new Response(body)), new AbortController(), function*() {
      delivered.resolve();
      yield* suspend();
    }, systemClock);
    continued = true;
  });
  await delivered.promise;
  await task.halt();
  assertEquals([continued, cancelled, body.locked], [false, true, false]);
});

Deno.test("mailbox SSE halt joins asynchronous cancellation of its pending read", async () => {
  const reading = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let continued = false;
  let halted = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      reading.resolve();
    },
    async cancel() {
      closing.resolve();
      await release.promise;
    },
  }, { highWaterMark: 0 });
  const task = run(function*() {
    yield* consumeMailboxSse(httpResponse(new Response(body)), new AbortController(), function*() {}, systemClock);
    continued = true;
  });
  await reading.promise;
  const halting = task.halt().then(() => {
    halted = true;
  });
  await closing.promise;
  assertEquals(halted, false); // A second cancel call must not bypass the original source cleanup.
  release.resolve();
  await halting;
  assertEquals([continued, halted, body.locked], [false, true, false]);
});

Deno.test("mailbox SSE halt joins a late cleanup failure before unlocking", async () => {
  const reading = Promise.withResolvers<void>(), closing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fault = new DOMException("Foreign cancellation failure", "AbortError");
  let continued = false, cancelled = 0, halted = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      reading.resolve();
    },
    async cancel() {
      cancelled++;
      closing.resolve();
      await release.promise;
      throw fault;
    },
  }, { highWaterMark: 0 });
  const task = run(function*() {
    yield* consumeMailboxSse(httpResponse(new Response(body)), new AbortController(), function*() {}, systemClock);
    continued = true;
  });
  await reading.promise;
  const halting = task.halt();
  const failure = assertRejects(() => halting).then((error) => {
    halted = true;
    return error;
  });
  await closing.promise;
  assertEquals([halted, body.locked], [false, true]);
  release.resolve();
  assertStrictEquals(await failure, fault);
  assertEquals([continued, cancelled, body.locked], [false, 1, false]);
});

Deno.test("finite mailbox SSE reports wait through retry headers for the first complete message", async () => {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.enqueue(encoder.encode("id: 0\nevent: /reply\ndata: complete\n\n"));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const text = await run(() =>
    readMailboxSseBody(httpResponse(new Response(body)), new AbortController(), systemClock, {
      idleTimeoutMs: 5,
      maxDurationMs: 1000,
    })
  );
  assertEquals(text, "retry: 5000\n\nid: 0\nevent: /reply\ndata: complete\n\n");
});

Deno.test("mailbox SSE rejects an already-aborted source before starting its first read", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      reads++;
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const controller = new AbortController();
  controller.abort();
  // abortable rejects before invoking the read leaf; the earlier owner still closes and unlocks the body.
  await assertRejects(
    () => run(() => consumeMailboxSse(httpResponse(new Response(body)), controller, function*() {}, systemClock)),
    DOMException,
  );
  assertEquals([reads, cancelled, body.locked], [0, true, false]);
});
