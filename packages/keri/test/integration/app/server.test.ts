import { action, type Operation, run, spawn, type Task } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { startServer } from "../../../src/app/server.ts";

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

/**
 * Helper function to convert fetch Promise to Effection Operation
 * This allows fetch to participate in the Effection task tree
 */
function* fetchOp(url: string, init?: RequestInit): Operation<Response> {
  return yield* action((resolve, reject) => {
    fetch(url, init).then(resolve, reject);
    return () => {}; // Cleanup function (can abort fetch if needed)
  });
}

/**
 * Helper function to convert Response.text() Promise to Effection Operation
 */
function* textOp(response: Response): Operation<string> {
  return yield* action((resolve, reject) => {
    response.text().then(resolve, reject);
    return () => {}; // Cleanup function
  });
}

/**
 * Helper function to wait for a server to be ready
 * Polls the server until it responds or times out
 */
function* waitForServer(
  port: number,
  maxAttempts: number = 10,
): Operation<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = yield* fetchOp(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(100), // 100ms timeout per attempt
      });
      if (response.ok) {
        // Consume the response body to avoid leaks
        yield* textOp(response);
        return; // Server is ready
      }
      // Consume non-ok responses too
      yield* textOp(response);
    } catch {
      // Server not ready yet, wait a bit
    }

    // Wait 50ms before next attempt
    yield* action((resolve) => {
      const timeoutId = setTimeout(() => resolve(undefined), 50);
      return () => clearTimeout(timeoutId);
    });
  }

  throw new Error(
    `Server on port ${port} did not become ready within ${maxAttempts} attempts`,
  );
}

/**
 * Helper function to properly shut down a server task
 * Halts the task (which triggers server.shutdown() via cleanup) and waits for completion
 * The startServer function's finally block ensures shutdown completes before returning
 */
function* waitForShutdown(serverTask: Task<void>): Operation<void> {
  // Halt the server task - this triggers the cleanup function in startServer
  // which calls server.shutdown(), and the finally block waits for server.finished
  yield* serverTask.halt();

  // The server task's finally block will have waited for shutdown to complete,
  // so we don't need to wait here. However, we add a small delay to ensure
  // Deno's leak detector sees the operation complete within the test context.
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), 100);
    return () => clearTimeout(timeoutId);
  });
}

Deno.test("Integration: Server - startServer with HTTP requests", async () => {
  const testPort = 8001; // Use a different port to avoid conflicts

  await run(function* (): Operation<void> {
    // Spawn the server as a background task
    // This creates a child task in the Effection task tree
    // The spawn() function returns a Task that can be halted or awaited
    const serverTask = yield* spawn(function* () {
      yield* startServer(testPort);
    });

    // Wait for server to be ready
    // This polls the server until it responds, demonstrating how to wait
    // for async operations in Effection
    yield* waitForServer(testPort);

    try {
      // Test 1: health endpoint
      const response1 = yield* fetchOp(`http://localhost:${testPort}/health`);
      assertEquals(response1.status, 200);
      const text1 = yield* textOp(response1);
      assertEquals(text1, "ok");

      // Test 2: 404 for unknown endpoint
      const response2 = yield* fetchOp(`http://localhost:${testPort}/unknown`);
      assertEquals(response2.status, 404);
      yield* textOp(response2);
    } finally {
      // Cleanup: Wait for server shutdown to complete
      yield* waitForShutdown(serverTask);
    }
  });
  console.log("Integration: startServer with HTTP requests passed");
});

/**
 * Test demonstrating concurrent requests against /health
 */
Deno.test("Integration: Server - startServer with concurrent requests", async () => {
  const testPort = 8002;

  await run(function* (): Operation<void> {
    const serverTask = yield* spawn(function* () {
      yield* startServer(testPort);
    });

    yield* waitForServer(testPort);

    try {
      // Spawn multiple concurrent fetch operations
      // Each spawn creates a child task that runs concurrently
      const request1 = yield* spawn(function* () {
        const res = yield* fetchOp(`http://localhost:${testPort}/health`);
        return yield* textOp(res);
      });

      const request2 = yield* spawn(function* () {
        const res = yield* fetchOp(`http://localhost:${testPort}/health`);
        return yield* textOp(res);
      });

      const request3 = yield* spawn(function* () {
        const res = yield* fetchOp(`http://localhost:${testPort}/health`);
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
      yield* waitForShutdown(serverTask);
    }
  });
});

/**
 * Test demonstrating error handling in Effection task tree
 */
Deno.test("Integration: Server - startServer error handling", async () => {
  const testPort = 8003;

  await run(function* (): Operation<void> {
    const serverTask = yield* spawn(function* () {
      yield* startServer(testPort);
    });

    yield* waitForServer(testPort);

    try {
      // Test that errors propagate correctly through the task tree
      const response = yield* fetchOp(
        `http://localhost:${testPort}/nonexistent`,
      );
      assertEquals(response.status, 404);
      // Consume the response body to avoid leaks
      yield* textOp(response);

      // Test that the server continues to work after an error
      const response2 = yield* fetchOp(`http://localhost:${testPort}/health`);
      assertEquals(response2.status, 200);
      const text = yield* textOp(response2);
      assertEquals(text, "ok");
    } finally {
      // Cleanup: Wait for server shutdown to complete
      yield* waitForShutdown(serverTask);
    }
  });
});
