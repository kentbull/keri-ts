import { call, run, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { closeResponseBody, fetchResponseHandle, fetchResponseHandleOrNull } from "../../../src/app/httping.ts";
import { defaultRuntimeServices, type RuntimeServices } from "../../../src/app/runtime-services.ts";

/** Keep the production clock while controlling the exact response ownership handoff. */
function services(fetch: RuntimeServices["http"]["fetch"]): RuntimeServices {
  return { ...defaultRuntimeServices, http: { fetch } };
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
    yield* fetchResponseHandle("https://peer.test/", {}, {
      services: services(() => Promise.resolve(new Response(body))),
    });
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
    yield* fetchResponseHandle("https://peer.test/", {}, {
      services: services((_url, init) =>
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
      ),
    });
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
        yield* fetchResponseHandle("https://peer.test/", {}, {
          services: services(() =>
            Promise.resolve(
              new Response(
                new ReadableStream<Uint8Array>({
                  cancel() {
                    closed++;
                  },
                }),
              ),
            )
          ),
        });
        assertEquals(closed, index); // The current response remains usable within this request scope.
      });
      assertEquals(closed, index + 1);
    }
  });
});

Deno.test("HTTP open timeout retains the mailbox null outcome and joins the aborted fetch", async () => {
  let aborted = false;
  const result = await run(function*() {
    return yield* fetchResponseHandleOrNull("https://peer.test/", {}, {
      timeoutMs: 1,
      services: services((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Timed out", "AbortError"));
          }, { once: true });
        })
      ),
    });
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
        closeResponseBody(
          new Response(
            new ReadableStream({
              cancel() {
                throw fault;
              },
            }),
          ),
        )
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
    yield* closeResponseBody(response);
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
  const started = Promise.withResolvers<void>();
  const fault = new Error("late response cleanup failed");
  const task = run(function*() {
    yield* fetchResponseHandle("https://peer.test/", {}, {
      services: services((_url, init) =>
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
      ),
    });
  });
  await started.promise;
  assertStrictEquals(await assertRejects(() => task.halt()), fault);
});
