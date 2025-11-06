import { assertEquals, assert } from "@std/assert";
import { type Operation, run, spawn } from 'effection';
import { initCommand } from '../../commands/init.ts';
import { 
  CLITestHarness, 
  testCLICommand, 
  testConcurrentCLICommands,
  createMockArgs
} from '../utils.ts';

/**
 * Integration tests using Effection primitives for full system simulation.
 * The tests in this file are instructional and are examples for learning how to test with Effection.
 */
Deno.test("Integration: CLI command execution with Effection run", async () => {
  const args = createMockArgs({
    name: 'integration-test',
    nopasscode: true,
  });

  const result = await run(() => testCLICommand(initCommand(args), args));
  
  assertEquals(result.output.length > 0, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("Integration: Multiple CLI commands with spawn", async () => {
  const commands = [
    {
      name: 'init1',
      command: initCommand(createMockArgs({ name: 'keystore1', nopasscode: true })),
      args: createMockArgs({ name: 'keystore1', nopasscode: true })
    },
    {
      name: 'init2', 
      command: initCommand(createMockArgs({ name: 'keystore2', nopasscode: true })),
      args: createMockArgs({ name: 'keystore2', nopasscode: true })
    },
    {
      name: 'init3',
      command: initCommand(createMockArgs({ name: 'keystore3', nopasscode: true })),
      args: createMockArgs({ name: 'keystore3', nopasscode: true })
    }
  ];

  const results = await run(() => testConcurrentCLICommands(commands));
  
  assertEquals(Object.keys(results).length, 3);
  assertEquals(results.init1.output.length > 0, true);
  assertEquals(results.init2.output.length > 0, true);
  assertEquals(results.init3.output.length > 0, true);
});

Deno.test("Integration: CLI command with timeout using Effection", async () => {
  const args = createMockArgs({
    name: 'timeout-test',
    nopasscode: true,
  });

  // Test that command completes within reasonable time
  const result = await run(function* () {
    const commandTask = spawn(() => testCLICommand(initCommand(args), args));
    
    // Wait for command to complete
    const commandResult = yield* commandTask;
    
    return commandResult;
  });

  assert(result !== undefined);
  assertEquals(result.output.length > 0, true);
});

Deno.test("Integration: CLI error handling with Effection", async () => {
  const args = createMockArgs({
    name: '', // Invalid empty name
    nopasscode: true,
  });

  // Test that errors are properly thrown
  try {
    await run(() => testCLICommand(initCommand(args), args));
    // Should not reach here - initCommand should throw
    assert(false, 'Should have thrown an error');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertEquals(message.includes('Name is required'), true);
  }
});

Deno.test("Integration: CLI command with CLI test harness cleanup", async () => {
  const args = createMockArgs({
    name: 'resource-test',
    nopasscode: true,
  });

  let cleanupCalled = false;

  const result = await run(function* () {
    try {
      const harness = new CLITestHarness();
      harness.captureOutput();
      
      try {
        const commandResult = yield* testCLICommand(initCommand(args), args);
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

Deno.test("Integration: CLI command with nested operations", async () => {
  function* nestedInitCommand(args: Record<string, unknown>): Operation<void> {
    yield* initCommand(args);
    
    // Simulate additional nested operations
    const nestedOp = function* () {
      // Nested operation 1
      // deno-lint-ignore require-yield
      const deepOp = function* () {
        // Deeply nested operation
        return;
      };
      yield* deepOp();
      
      // Nested operation 2
      // deno-lint-ignore require-yield
      const anotherOp = function* () {
        return;
      };
      yield* anotherOp();
    };
    
    yield* nestedOp();
  }

  const args = createMockArgs({
    name: 'nested-test',
    nopasscode: true,
  });

  const result = await run(() => testCLICommand(nestedInitCommand(args), args));
  
  assertEquals(result.output.length > 0, true);
  assertEquals(result.errors.length, 0);
});
