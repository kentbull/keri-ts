// @file-test-lane server

import { type Operation, run, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { startServer } from "../../../../tufa/src/host/http-server.ts";
import { fetchOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";
import { startTestServer } from "../../runtime-test-hosts.ts";

/**
 * Integration test for startServer function
 *
 * This test demonstrates how to manually simulate an Effection task loop/tree in tests:
 *
 * KEY EFFECTION PATTERNS DEMONSTRATED:
 *
 * 1. **run()** - Creates the outermost Effection task tree
 *    - All operations run within this tree
 *    - Returns a Promise that resolves when the operation completes
 *
 * 2. **spawn()** - Creates a child task that runs concurrently
 *    - Returns a Task that can be halted or awaited
 *    - Child tasks are automatically cleaned up when parent is halted
 *
 * 3. **yield*** - Yields control to an Operation
 *    - Allows Effection to manage the operation's lifecycle
 *    - Operations can be cancelled, cleaned up, etc.
 *
 * 4. **action()** - Wraps promise-based APIs into Operations
 *    - Takes a function that receives resolve/reject callbacks
 *    - Returns a cleanup function for resource management
 *
 * 5. **Structured Concurrency** - Tasks form a tree structure
 *    - When a parent task halts, all children are automatically halted
 *    - Resources are cleaned up automatically
 *
 * TEST STRUCTURE:
 * - run() creates the main task tree
 * - spawn() starts the server as a background task
 * - fetchOp() wraps fetch() as an Effection Operation
 * - textOp() wraps response.text() as an Effection Operation
 * - serverTask.halt() stops the server task (and all children)
 */

Deno.test("Integration: Server - startServer with HTTP requests", async () => {
  await run(function*(): Operation<void> {
    const { address, task: serverTask } = yield* startTestServer();

    try {
      // Test 1: health endpoint
      const response1 = yield* fetchOp(
        `http://${address.hostname}:${address.port}/health`,
      );
      assertEquals(response1.status, 200);
      const text1 = yield* textOp(response1);
      assertEquals(text1, "ok");

      // Test 2: 404 for unknown endpoint
      const response2 = yield* fetchOp(
        `http://${address.hostname}:${address.port}/unknown`,
      );
      assertEquals(response2.status, 404);
      yield* textOp(response2);
    } finally {
      // Cleanup: Wait for server shutdown to complete
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
  console.log("Integration: startServer with HTTP requests passed");
});

/**
 * Test demonstrating concurrent requests against /health
 */
Deno.test("Integration: Server - startServer with concurrent requests", async () => {
  await run(function*(): Operation<void> {
    const { address, task: serverTask } = yield* startTestServer();

    try {
      // Spawn multiple concurrent fetch operations
      // Each spawn creates a child task that runs concurrently
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

      // Wait for all requests to complete
      // yield* on a spawned task waits for it to complete
      const result1 = yield* request1;
      const result2 = yield* request2;
      const result3 = yield* request3;

      // Verify results
      assertEquals(result1, "ok");
      assertEquals(result2, "ok");
      assertEquals(result3, "ok");
    } finally {
      // Cleanup: Wait for server shutdown to complete
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

/**
 * Test demonstrating error handling in Effection task tree
 */
Deno.test("Integration: Server - startServer error handling", async () => {
  await run(function*(): Operation<void> {
    const { address, task: serverTask } = yield* startTestServer();

    try {
      // Test that errors propagate correctly through the task tree
      const response = yield* fetchOp(
        `http://${address.hostname}:${address.port}/nonexistent`,
      );
      assertEquals(response.status, 404);
      // Consume the response body to avoid leaks
      yield* textOp(response);

      // Test that the server continues to work after an error
      const response2 = yield* fetchOp(
        `http://${address.hostname}:${address.port}/health`,
      );
      assertEquals(response2.status, 200);
      const text = yield* textOp(response2);
      assertEquals(text, "ok");
    } finally {
      // Cleanup: Wait for server shutdown to complete
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});
