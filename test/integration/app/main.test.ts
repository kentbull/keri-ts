import { describe, it, expect } from "vitest";
import { run } from 'effection';
import { initCommand } from '../../../src/app/cli/init.ts';
import { CLITestHarness, createMockArgs } from '../../../test/utils.ts';

/**
 * Integration tests for the main CLI entry point
 * These tests focus on testing the init command functionality that would be called from main
 */

describe("Integration: CLI", () => {
  it("init command with help flag", async () => {
    const harness = new CLITestHarness();
    harness.captureOutput();

    try {
      const args = createMockArgs({
        help: true,
      });

      await run(() => initCommand(args));

      const output = harness.getOutput().join('\n');
      expect(output.includes('kli init - Create a database and keystore')).toBe(true);
    } finally {
      harness.restoreOutput();
    }
  });
});

