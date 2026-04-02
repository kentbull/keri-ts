import { run } from "effection";
import { assertStringIncludes } from "jsr:@std/assert";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { assertOperationThrows, CLITestHarness } from "../../../test/utils.ts";

Deno.test("CLI - incept command creates single-sig identifier", async () => {
  const name = `incept-unit-${crypto.randomUUID()}`;
  await run(() => initCommand({ name, temp: true, nopasscode: true }));

  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() =>
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
      })
    );
    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "Prefix");
    assertStringIncludes(output, "Public key 1");
  } finally {
    harness.restoreOutput();
  }
});

Deno.test("CLI - incept command requires alias", async () => {
  await assertOperationThrows(
    inceptCommand({ name: "test", temp: true }),
    "Alias is required and cannot be empty",
  );
});

Deno.test("CLI - incept command blocks witness endpoint mode in single-sig phase", async () => {
  await assertOperationThrows(
    inceptCommand({
      name: "test",
      alias: "alice",
      endpoint: true,
    }),
    "Witness endpoint receipting is not available in single-sig local phase",
  );
});

Deno.test("CLI - incept command works with custom head directory", async () => {
  const name = `incept-head-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() =>
      inceptCommand({
        name,
        headDirPath,
        alias: "alice",
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      })
    );
    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "Prefix");
  } finally {
    harness.restoreOutput();
  }
});

Deno.test("CLI - incept command accepts weighted threshold JSON expressions", async () => {
  const name = `incept-weighted-${crypto.randomUUID()}`;
  await run(() => initCommand({ name, temp: true, nopasscode: true }));

  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() =>
      inceptCommand({
        name,
        temp: true,
        alias: "weighted",
        transferable: true,
        icount: 2,
        isith: '["1/2","1/2"]',
        ncount: 2,
        nsith: '[{"1":["1/2","1/2"]}]',
        toad: 0,
      })
    );
    const output = harness.getOutput().join("\n");
    assertStringIncludes(output, "Prefix");
    assertStringIncludes(output, "Public key 2");
  } finally {
    harness.restoreOutput();
  }
});
