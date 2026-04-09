// @file-test-lane app-stateful-b

import { run } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { aidCommand } from "../../../src/app/cli/aid.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { listCommand } from "../../../src/app/cli/list.ts";
import { assertOperationThrows, CLITestHarness } from "../../../test/utils.ts";

function identifierLines(lines: string[]): string[] {
  return lines.filter((line) => /^[^:()]+ \([A-Za-z0-9_-]{10,}\)$/.test(line.trim()));
}

Deno.test("CLI - list command shows no identifiers before first incept", async () => {
  const name = `list-empty-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-list-${crypto.randomUUID()}`;

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
      listCommand({
        name,
        headDirPath,
      })
    );
    assertEquals(identifierLines(harness.getOutput()), []);
  } finally {
    harness.restoreOutput();
  }
});

Deno.test("CLI - list and aid commands show persisted identifier visibility after reopen", async () => {
  const name = `list-aid-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-list-${crypto.randomUUID()}`;
  const alias = "alice";

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  const inceptHarness = new CLITestHarness();
  inceptHarness.captureOutput();
  let prefix = "";
  try {
    await run(() =>
      inceptCommand({
        name,
        headDirPath,
        alias,
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      })
    );
    const output = inceptHarness.getOutput().join("\n");
    assertStringIncludes(output, "Prefix");
    const line = inceptHarness.getOutput().find((entry) => entry.startsWith("Prefix"));
    if (!line) {
      throw new Error(`Unable to parse prefix from output:\n${output}`);
    }
    prefix = line.trim().split(/\s+/).at(-1) ?? "";
  } finally {
    inceptHarness.restoreOutput();
  }

  const listHarness = new CLITestHarness();
  listHarness.captureOutput();
  try {
    await run(() =>
      listCommand({
        name,
        headDirPath,
      })
    );
    assertEquals(identifierLines(listHarness.getOutput()), [
      `${alias} (${prefix})`,
    ]);
  } finally {
    listHarness.restoreOutput();
  }

  const aidHarness = new CLITestHarness();
  aidHarness.captureOutput();
  try {
    await run(() =>
      aidCommand({
        name,
        headDirPath,
        alias,
      })
    );
    assertStringIncludes(aidHarness.getOutput().join("\n"), prefix);
  } finally {
    aidHarness.restoreOutput();
  }
});

Deno.test("CLI - aid command requires alias", async () => {
  await assertOperationThrows(
    aidCommand({ name: "test" }),
    "Alias is required and cannot be empty",
  );
});
