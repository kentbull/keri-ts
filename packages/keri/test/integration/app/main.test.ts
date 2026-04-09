// @file-test-lane app-fast-parallel

import { run } from "effection";
import { tufa } from "../../../../tufa/src/cli/cli.ts";

/**
 * Integration tests for the main CLI entry point
 * These tests focus on testing the init command functionality that would be called from main
 */

Deno.test("Integration: CLI - init command with help flag", async () => {
  // Help output should be exercised through CLI parsing, not direct command handlers.
  await run(() => tufa(["init", "--help"]));
});
