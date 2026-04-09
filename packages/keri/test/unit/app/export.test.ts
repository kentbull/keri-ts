// @file-test-lane app-stateful-b

import { run } from "effection";
import { assertStringIncludes } from "jsr:@std/assert";
import { exportCommand } from "../../../src/app/cli/export.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { CLITestHarness } from "../../../test/utils.ts";

Deno.test("CLI - export command works with custom head directory", async () => {
  const name = `export-head-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  await run(() =>
    inceptCommand({
      name,
      headDirPath,
      alias: "alice",
      transferable: true,
      icount: 1,
      ncount: 1,
      toad: 0,
    })
  );

  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() =>
      exportCommand({
        name,
        headDirPath,
        alias: "alice",
      })
    );
    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "KERI10JSON");
    assertStringIncludes(output, "-V");
    assertStringIncludes(output, "1AAG");
  } finally {
    harness.restoreOutput();
  }
});
