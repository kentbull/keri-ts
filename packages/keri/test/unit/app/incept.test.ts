// @file-test-lane app-stateful-a

import { type Operation, run } from "effection";
import { assertStringIncludes } from "jsr:@std/assert";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { assertOperationThrows, CLITestHarness } from "../../../test/utils.ts";

async function captureCommandOutput(operation: Operation<void>): Promise<string> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => operation);
    return harness.getOutput().join("\n");
  } finally {
    harness.restoreOutput();
  }
}

Deno.test("CLI - incept command reuses initialized stores for happy-path coverage", async () => {
  const name = `incept-unit-${crypto.randomUUID()}`;
  await run(() => initCommand({ name, temp: true, nopasscode: true }));
  const headName = `incept-head-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name: headName,
      headDirPath,
      nopasscode: true,
    })
  );

  const singleSigOutput = await captureCommandOutput(
    inceptCommand({
      name,
      temp: true,
      alias: "alice",
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    }),
  );
  assertStringIncludes(singleSigOutput, "Prefix");
  assertStringIncludes(singleSigOutput, "Public key 1");

  const endpointOutput = await captureCommandOutput(
    inceptCommand({
      name,
      temp: true,
      alias: "relay",
      endpoint: true,
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    }),
  );
  assertStringIncludes(endpointOutput, "Prefix");

  const weightedOutput = await captureCommandOutput(
    inceptCommand({
      name,
      temp: true,
      alias: "weighted",
      transferable: true,
      icount: 2,
      isith: "[\"1/2\",\"1/2\"]",
      ncount: 2,
      nsith: "[{\"1\":[\"1/2\",\"1/2\"]}]",
      toad: 0,
    }),
  );
  assertStringIncludes(weightedOutput, "Prefix");
  assertStringIncludes(weightedOutput, "Public key 2");

  const headDirOutput = await captureCommandOutput(
    inceptCommand({
      name: headName,
      headDirPath,
      alias: "alice",
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    }),
  );
  assertStringIncludes(headDirOutput, "Prefix");
});

Deno.test("CLI - incept command requires alias", async () => {
  await assertOperationThrows(
    inceptCommand({ name: "test", temp: true }),
    "Alias is required and cannot be empty",
  );
});
