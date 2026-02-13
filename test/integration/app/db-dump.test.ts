import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { dumpEvts } from "../../../src/app/cli/db-dump.ts";
import { Baser } from "../../../src/db/basing.ts";
import { CLITestHarness } from "../../../test/utils.ts";

/**
 * Integration test for db dump command
 * Tests dumping the evts sub-database with debugging support
 */

Deno.test({
  name: "Integration: DB dump command - should dump database contents - debug iterator issue",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const name = `db-dump-${crypto.randomUUID()}`;
    const key = new TextEncoder().encode("evt.0001");
    const val = new TextEncoder().encode("sample event payload");

    await run(function* () {
      const baser = new Baser({
        name,
        temp: true,
        reopen: true,
        readonly: false,
      });

      try {
        const opened = yield* baser.reopen();
        assert(opened, "Fixture database should open");
        assertEquals(baser.putEvt(key, val), true, "Fixture event should be written");
      } finally {
        // Keep temp database files for readonly dump step.
        yield* baser.close();
      }
    });

    const harness = new CLITestHarness();
    harness.captureOutput();

    try {
      const args = {
        name,
        base: undefined,
        temp: true,
      };

      await run(() => dumpEvts(args));

      const output = harness.getOutput();
      const errors = harness.getErrors();

      assertEquals(errors.length, 0, `Expected no stderr output, got: ${errors.join("\n")}`);
      assert(output.some((line) => line.includes("Baser.evts sub-database dump (1 entries)")));
      assert(output.some((line) => line.includes("Total entries: 1")));
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
  },
});

Deno.test({
  name: "Integration: DB dump command - should test Baser.getAllEvtsIter directly",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
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
        const count = baser.cntEvts();
        console.log("Entry count:", count);

        // Try to get the iterator
        console.log("Getting iterator...");
        const iter = baser.getAllEvtsIter(new Uint8Array(0));
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
  },
});
