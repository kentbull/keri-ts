import { assertEquals } from "@std/assert";
import { run } from 'effection';
import { initCommand } from '../../commands/init.ts';
import { CLITestHarness, createMockArgs } from '../utils.ts';

/**
 * Integration tests for the main CLI entry point
 * These tests focus on testing the init command functionality that would be called from main
 */

Deno.test("Integration: CLI init command with help flag", async () => {
  const harness = new CLITestHarness();
  harness.captureOutput();

  try {
    const args = createMockArgs({
      help: true,
    });

    await run(() => initCommand(args));

    const output = harness.getOutput().join('\n');
    assertEquals(output.includes('kli init - Create a database and keystore'), true);
  } finally {
    harness.restoreOutput();
  }
});
