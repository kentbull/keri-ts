import { run } from "effection";
import { assertStringIncludes } from "jsr:@std/assert";
import { initCommand } from "../../../src/app/cli/init.ts";
import { CLITestHarness, createMockArgs } from "../../../test/utils.ts";

/**
 * Integration tests for the main CLI entry point
 * These tests focus on testing the init command functionality that would be called from main
 */

Deno.test("Integration: CLI - init command with help flag", async () => {
  const harness = new CLITestHarness();
  harness.captureOutput();

  try {
    const args = createMockArgs({
      help: true,
    });

    await run(() => initCommand(args));

    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "tufa init - Create a database and keystore");
  } finally {
    harness.restoreOutput();
  }
});
