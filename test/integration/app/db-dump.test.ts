import { run } from "effection";
import { describe, it } from "vitest";
import { dumpEvts } from "../../../src/app/cli/db-dump.ts";
import { Baser } from "../../../src/db/basing.ts";
import { CLITestHarness } from "../../../test/utils.ts";

/**
 * Integration test for db dump command
 * Tests dumping the evts sub-database with debugging support
 */

describe("Integration: DB dump command", () => {
  it("should dump database contents - debug iterator issue", async () => {
    const harness = new CLITestHarness();
    harness.captureOutput();

    try {
      // Test with an existing database
      const args = {
        name: "accolon",
        base: undefined,
        temp: false,
      };

      console.log("Starting db dump test...");
      console.log("Args:", args);

      await run(() => dumpEvts(args));

      const output = harness.getOutput();
      const errors = harness.getErrors();

      console.log("\n=== Captured Output ===");
      output.forEach((line, i) => console.log(`[${i}] ${line}`));

      console.log("\n=== Captured Errors ===");
      errors.forEach((line, i) => console.log(`[${i}] ${line}`));

      // If we got here without throwing, the test passed
      // The error should be visible in the captured output
    } catch (error) {
      console.error("\n=== Test Error ===");
      console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
      console.error("Error message:", error instanceof Error ? error.message : String(error));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");

      const output = harness.getOutput();
      const errors = harness.getErrors();

      console.log("\n=== Output before error ===");
      output.forEach((line, i) => console.log(`[${i}] ${line}`));

      console.log("\n=== Errors before fatal ===");
      errors.forEach((line, i) => console.log(`[${i}] ${line}`));

      throw error;
    } finally {
      harness.restoreOutput();
    }
  });

  it("should test Baser.getAllEvtsIter directly", async () => {
    await run(function* () {
      const baser = new Baser({
        name: "accolon",
        base: undefined,
        temp: false,
        reopen: true,
        readonly: true,
      });

      try {
        const opened = yield* baser.reopen();
        console.log("Database opened:", opened);

        if (!opened) {
          console.error("Failed to open database");
          return;
        }

        console.log("Database path:", baser.path);
        console.log("Evts database:", baser.evts ? "exists" : "null");

        // Get count first
        const count = yield* baser.cntEvts();
        console.log("Entry count:", count);

        // Try to get the iterator
        console.log("Getting iterator...");
        const iter = baser.getAllEvtsIter(new Uint8Array(0), false);
        console.log("Iterator type:", typeof iter);
        console.log("Iterator:", iter);
        console.log(
          "Is generator?",
          iter.constructor.name === "GeneratorFunction" || iter[Symbol.iterator]
        );

        // Try to iterate
        console.log("Starting iteration...");
        let entryCount = 0;

        try {
          for (const [keyBytes, valBytes] of iter) {
            entryCount++;
            console.log(
              `Entry ${entryCount}: key length=${keyBytes.length}, val length=${valBytes.length}`
            );

            if (entryCount >= 5) {
              console.log("Stopping after 5 entries for testing");
              break;
            }
          }
          console.log(`Iteration complete. Total entries iterated: ${entryCount}`);
        } catch (iterError) {
          console.error("Iteration error:", iterError);
          console.error(
            "Error type:",
            iterError instanceof Error ? iterError.constructor.name : typeof iterError
          );
          console.error(
            "Error message:",
            iterError instanceof Error ? iterError.message : String(iterError)
          );
          console.error(
            "Error stack:",
            iterError instanceof Error ? iterError.stack : "No stack trace"
          );
          throw iterError;
        }
      } finally {
        yield* baser.close();
      }
    });
  });
});
