// @file-test-lane app-fast

import { type Operation, run, spawn } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { ValidationError } from "../../../src/core/errors.ts";
import { CLITestHarness, createMockArgs, testCLICommand } from "../../../test/utils.ts";

/**
 * Integration tests using Effection primitives for full system simulation.
 * The tests in this file are instructional and are examples for learning how to test with Effection.
 */

/*
Does the minimum we need to test the "testCLICommand" function without loading dependencies, config,
or any of that.
 */
function* fakeCLICommand(args: Record<string, unknown>): Operation<void> {
  const name = args.name as string | undefined;
  if (!name) {
    throw new ValidationError("Name is required and cannot be empty");
  }

  console.log(`starting ${name}`);
  console.log(`completed ${name}`);
}

Deno.test("Integration: Effection - CLI command execution with Effection run", async () => {
  const args = createMockArgs({
    name: "integration-test",
    nopasscode: true,
    temp: true,
  });

  const result = await run(() => testCLICommand(fakeCLICommand(args), args));

  assertEquals(result.output.length > 0, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("Integration: Effection - Multiple CLI commands with spawn", async () => {
  const names = ["keystore1", "keystore2", "keystore3"];
  const results = await run(function*() {
    const outputSizes: number[] = [];
    for (const name of names) {
      const args = createMockArgs({ name, nopasscode: true, temp: true });
      const result = yield* testCLICommand(fakeCLICommand(args), args);
      outputSizes.push(result.output.length);
    }
    return outputSizes;
  });

  assertEquals(results.length, 3);
  assertEquals(results.every((size) => size > 0), true);
});

Deno.test("Integration: Effection - CLI command with timeout using Effection", async () => {
  const args = createMockArgs({
    name: "timeout-test",
    nopasscode: true,
    temp: true,
  });

  const result = await run(() => testCLICommand(fakeCLICommand(args), args));

  assertEquals(result !== undefined, true);
  assertEquals(result.output.length > 0, true);
});

Deno.test("Integration: Effection - CLI error handling with Effection", async () => {
  const args = createMockArgs({
    name: "", // Invalid empty name
    nopasscode: true,
    temp: true,
  });

  // Test that errors are properly thrown
  try {
    await run(() => testCLICommand(fakeCLICommand(args), args));
    // Should not reach here - initCommand should throw
    throw new Error("Should have thrown an error");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertStringIncludes(message, "Name is required");
  }
});

Deno.test("Integration: Effection - CLI command with CLI test harness cleanup", async () => {
  const args = createMockArgs({
    name: "resource-test",
    nopasscode: true,
    temp: true,
  });

  let cleanupCalled = false;

  const result = await run(function*() {
    try {
      const harness = new CLITestHarness();
      harness.captureOutput();

      try {
        const commandResult = yield* testCLICommand(fakeCLICommand(args), args);
        return commandResult;
      } finally {
        harness.restoreOutput();
        cleanupCalled = true;
      }
    } finally {
      // Additional cleanup
      cleanupCalled = true;
    }
  });

  assertEquals(cleanupCalled, true);
  assertEquals(result.output.length > 0, true);
});

Deno.test("Integration: Effection - CLI command with nested operations", async () => {
  function* nestedInitCommand(args: Record<string, unknown>): Operation<void> {
    yield* fakeCLICommand(args);

    // Simulate additional nested operations
    const nestedOp = function*() {
      // Nested operation 1
      // deno-lint-ignore require-yield
      const deepOp = function*() {
        // Deeply nested operation
        return;
      };
      yield* deepOp();

      // Nested operation 2
      // deno-lint-ignore require-yield
      const anotherOp = function*() {
        return;
      };
      yield* anotherOp();
    };

    yield* nestedOp();
  }

  const args = createMockArgs({
    name: "nested-test",
    nopasscode: true,
    temp: true,
  });

  const result = await run(() => testCLICommand(nestedInitCommand(args), args));

  assertEquals(result.output.length > 0, true);
  assertEquals(result.errors.length, 0);
});
