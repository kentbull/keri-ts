import { assertEquals } from "jsr:@std/assert";
import { type Operation, run, spawn } from "npm:effection@^3.6.0";
import { fetchOp, startTestServer, textOp, waitForTaskHalt } from "../test-helpers.ts";

/**
 * Integration test for the shared Tufa HTTP host.
 *
 * These tests keep the package-surface startup contract honest: one Tufa host
 * should serve `/health`, return `404` for unknown routes, and remain stable
 * under concurrent requests.
 */

Deno.test("tufa/server - startServer serves HTTP requests", async () => {
  await run(function*(): Operation<void> {
    const { address, task: serverTask } = yield* startTestServer();

    try {
      const response1 = yield* fetchOp(
        `http://${address.hostname}:${address.port}/health`,
      );
      assertEquals(response1.status, 200);
      const text1 = yield* textOp(response1);
      assertEquals(text1, "ok");

      const response2 = yield* fetchOp(
        `http://${address.hostname}:${address.port}/unknown`,
      );
      assertEquals(response2.status, 404);
      yield* textOp(response2);
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

Deno.test("tufa/server - startServer handles concurrent requests", async () => {
  await run(function*(): Operation<void> {
    const { address, task: serverTask } = yield* startTestServer();

    try {
      const request1 = yield* spawn(function*() {
        const res = yield* fetchOp(
          `http://${address.hostname}:${address.port}/health`,
        );
        return yield* textOp(res);
      });

      const request2 = yield* spawn(function*() {
        const res = yield* fetchOp(
          `http://${address.hostname}:${address.port}/health`,
        );
        return yield* textOp(res);
      });

      const request3 = yield* spawn(function*() {
        const res = yield* fetchOp(
          `http://${address.hostname}:${address.port}/health`,
        );
        return yield* textOp(res);
      });

      assertEquals(yield* request1, "ok");
      assertEquals(yield* request2, "ok");
      assertEquals(yield* request3, "ok");
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

Deno.test("tufa/server - startServer recovers from 404s and keeps serving", async () => {
  await run(function*(): Operation<void> {
    const { address, task: serverTask } = yield* startTestServer();

    try {
      const response = yield* fetchOp(
        `http://${address.hostname}:${address.port}/nonexistent`,
      );
      assertEquals(response.status, 404);
      yield* textOp(response);

      const response2 = yield* fetchOp(
        `http://${address.hostname}:${address.port}/health`,
      );
      assertEquals(response2.status, 200);
      const text = yield* textOp(response2);
      assertEquals(text, "ok");
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});
