import { call, run, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { closeResponseBody, requestWithHeaderTimeout } from "../../../src/app/httping.ts";
import { defaultRuntimeServices, type RuntimeServices } from "../../../src/app/runtime-services.ts";
import { httpResponse } from "../../support/http-client.ts";
import { httpClient, type TestHttpResponder } from "../../support/http-client.ts";

/** Keep the production clock while controlling the exact response ownership handoff. */
function services(fetch: TestHttpResponder): RuntimeServices {
  return { ...defaultRuntimeServices, http: httpClient(fetch) };
}

Deno.test("HTTP response scope owns an unread body after headers have been delivered", async () => {
  const delivered = Promise.withResolvers<void>();
  let cancelled = false;
  let continued = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const task = run(function*() {
    yield* (services(() => Promise.resolve(new Response(body)))).http.open("https://peer.test/", {});
    delivered.resolve();
    yield* suspend(); // Hold precisely between receiving headers and acquiring a body reader.
    continued = true;
  });
  await delivered.promise;
  assertEquals(cancelled, false);
  await task.halt();
  assertEquals(cancelled, true);
  assertEquals(continued, false);
});

Deno.test("HTTP cancellation joins a late fetch response and closes its otherwise unclaimed body", async () => {
  const started = Promise.withResolvers<void>();
  let cancelled = false;
  let continued = false;
  const task = run(function*() {
    yield* (services((_url, init) =>
      new Promise<Response>((resolve) => {
        // The transport finishes concurrently with abort; cancellation must still own its returned body.
        init!.signal!.addEventListener("abort", () =>
          resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                cancel() {
                  cancelled = true;
                },
              }),
            ),
          ), { once: true });
        started.resolve();
      })
    )).http.open("https://peer.test/", {});
    continued = true;
  });
  await started.promise;
  await task.halt();
  assertEquals(cancelled, true);
  assertEquals(continued, false);
});

Deno.test("finite HTTP call scopes release each response before the worker's next request", async () => {
  let closed = 0;
  await run(function*() {
    for (let index = 0; index < 3; index++) {
      yield* call(function*() {
        yield* (services(() =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                cancel() {
                  closed++;
                },
              }),
            ),
          )
        )).http.open("https://peer.test/", {});
        assertEquals(closed, index); // The current response remains usable within this request scope.
      });
      assertEquals(closed, index + 1);
    }
  });
});

Deno.test("HTTP open timeout retains the mailbox null outcome and joins the aborted fetch", async () => {
  let aborted = false;
  const result = await run(function*() {
    return yield* requestWithHeaderTimeout(
      (services((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => {
            aborted = true;
            reject(init!.signal!.reason);
          }, { once: true });
        })
      )).http,
      defaultRuntimeServices.clock,
      "https://peer.test/",
      {},
      1,
    );
  });
  assertEquals(result, null);
  assertEquals(aborted, true);
});

Deno.test("HTTP response cancellation joins body cleanup and propagates its original failure", async () => {
  const started = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>();
  const fault = new Error("body cleanup failed");
  assertStrictEquals(
    await assertRejects(() =>
      run(() =>
        closeResponseBody(httpResponse(
          new Response(
            new ReadableStream({
              cancel() {
                throw fault;
              },
            }),
          ),
        ))
      )
    ),
    fault,
  );
  let calls = 0, exited = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        calls++;
        started.resolve();
        return finished.promise;
      },
    }),
  );
  const task = run(function*() {
    yield* closeResponseBody(httpResponse(response));
  });
  await started.promise;
  const joined = task.halt();
  void joined.then(() => exited = true, () => exited = true);
  // Give cancellation one event-loop turn; the controlled cleanup remains unresolved.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(exited, false);
  finished.reject(fault);
  assertStrictEquals(await assertRejects(() => joined), fault);
  assertEquals(calls, 1);
});

Deno.test("late HTTP response cleanup failure is not hidden during fetch cancellation", async () => {
  for (const fault of [new Error("late response cleanup failed"), new DOMException("foreign abort", "AbortError")]) {
    const started = Promise.withResolvers<void>();
    const task = run(function*() {
      yield* (services((_url, init) =>
        new Promise<Response>((resolve) => {
          init!.signal!.addEventListener("abort", () =>
            resolve(
              new Response(
                new ReadableStream<Uint8Array>({
                  cancel() {
                    throw fault;
                  },
                }),
              ),
            ), { once: true });
          started.resolve();
        })
      )).http.open("https://peer.test/", {});
    });
    await started.promise;
    assertStrictEquals(await assertRejects(() => task.halt()), fault);
  }
});

Deno.test("HTTP response teardown recognizes only its controller's exact abort reason", async () => {
  const started = Promise.withResolvers<void>();
  let continued = false;
  const task = run(function*() {
    yield* (services((_url, init) =>
      new Promise<Response>((resolve) => {
        init!.signal!.addEventListener("abort", () =>
          resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.error(init!.signal!.reason);
                },
              }),
            ),
          ), { once: true });
        started.resolve();
      })
    )).http.open("https://peer.test/", {});
    continued = true;
  });
  await started.promise;
  await task.halt();
  assertEquals(continued, false);
});

Deno.test("HTTP fetch cancellation preserves late I/O and foreign timeout failures once", async () => {
  for (const fault of [new Error("late fetch I/O"), new DOMException("foreign abort", "AbortError")]) {
    let started!: () => void, rejectFetch!: () => void;
    const ready = new Promise<void>((resolve) => started = resolve);
    const task = run(function*() {
      yield* (services((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => rejectFetch = () => reject(fault), { once: true });
          started();
        })
      )).http.open("https://peer.test/", {});
    });
    await ready;
    const stopped = task.halt();
    let joined = false;
    const pending = Promise.resolve(stopped).finally(() => joined = true);
    void pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(joined, false, "Cancellation joins the still-pending fetch");
    rejectFetch();
    assertStrictEquals(await assertRejects(() => pending), fault);
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          requestWithHeaderTimeout(
            (services((_url, init) =>
              new Promise<Response>((_resolve, reject) => {
                init!.signal!.addEventListener("abort", () => reject(fault), { once: true });
              })
            )).http,
            defaultRuntimeServices.clock,
            "https://peer.test/",
            {},
            1,
          )
        )
      ),
      fault,
      "A foreign same-class timeout failure is not the mailbox null outcome",
    );
    assertStrictEquals(
      await assertRejects(() => run(() => (services(() => Promise.reject(fault))).http.open("https://peer.test/", {}))),
      fault,
      "Ordinary fetch failure is not duplicated by teardown",
    );
  }
});

Deno.test("HTTP fetch honors the caller signal before acquisition and during headers", async () => {
  for (const preAborted of [true, false]) {
    const external = new AbortController(), entered = Promise.withResolvers<void>();
    const reason = new DOMException("caller cancelled request", "AbortError");
    let fetched = 0;
    if (preAborted) external.abort(reason);
    const task = run(() =>
      (services((_url, init) => {
        fetched++;
        entered.resolve();
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        });
      })).http.open("https://peer.test/", { signal: external.signal })
    );
    // Bound the regression before this owner starts forwarding the external signal.
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const failed = assertRejects(() =>
      Promise.race([
        Promise.resolve(task),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("caller cancellation was not forwarded")), 1000);
        }),
      ])
    );
    try {
      if (!preAborted) {
        await entered.promise;
        external.abort(reason);
      }
      assertStrictEquals(await failed, reason);
      assertEquals(fetched, preAborted ? 0 : 1);
    } finally {
      clearTimeout(deadline);
      await task.halt();
    }
  }
});

Deno.test("HTTP external cancellation keeps its reason when a later header deadline fires", async () => {
  const external = new AbortController(), entered = Promise.withResolvers<void>();
  const reason = new Error("external cancellation precedes deadline");
  let expire!: () => void, rejectFetch!: (error: unknown) => void;
  const task = run(() =>
    requestWithHeaderTimeout(
      ({
        ...services(() =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
            entered.resolve();
          })
        ),
        clock: {
          ...defaultRuntimeServices.clock,
          setTimeout(callback: () => void) {
            expire = callback;
          },
          clearTimeout() {},
        },
      }).http,
      {
        ...defaultRuntimeServices.clock,
        setTimeout(callback) {
          expire = callback;
        },
        clearTimeout() {},
      },
      "https://peer.test/",
      { signal: external.signal },
      10,
    )
  );
  await entered.promise;
  external.abort(reason);
  expire();
  rejectFetch(reason);
  assertStrictEquals(await assertRejects(() => Promise.resolve(task)), reason);
});

Deno.test("HTTP caller cancellation after headers aborts the body reader with the same reason", async () => {
  const external = new AbortController(), reading = Promise.withResolvers<void>();
  const reason = new DOMException("caller cancelled response", "AbortError");
  let reader: AsyncIterator<Uint8Array> | undefined;
  const task = run(function*() {
    const response = yield* (services((_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
            },
          }),
        ),
      )
    )).http.open("https://peer.test/", { signal: external.signal });
    reader = response.body()[Symbol.asyncIterator]();
    reading.resolve();
    try {
      yield* call(() => reader!.next());
    } finally {
      yield* call(async () => {
        await reader?.return?.();
      });
    }
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const failed = assertRejects(() =>
    Promise.race([
      Promise.resolve(task),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("body cancellation was not forwarded")), 1000);
      }),
    ])
  );
  try {
    await reading.promise;
    external.abort(reason);
    assertStrictEquals(await failed, reason);
  } finally {
    clearTimeout(deadline);
    await task.halt();
  }
});
