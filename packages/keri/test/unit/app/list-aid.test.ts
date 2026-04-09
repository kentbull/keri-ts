// @file-test-lane app-stateful-b

import { type Operation, run } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { aidCommand } from "../../../src/app/cli/aid.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { listCommand } from "../../../src/app/cli/list.ts";
import { assertOperationThrows, CLITestHarness } from "../../../test/utils.ts";

function identifierLines(lines: string[]): string[] {
  return lines.filter((line) => /^[^:()]+ \([A-Za-z0-9_-]{10,}\)$/.test(line.trim()));
}

async function captureOutputLines(operation: Operation<void>): Promise<string[]> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => operation);
    return harness.getOutput();
  } finally {
    harness.restoreOutput();
  }
}

Deno.test("CLI - list and aid commands reuse one initialized store across empty and reopened views", async () => {
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

  const emptyListOutput = await captureOutputLines(listCommand({
    name,
    headDirPath,
  }));
  assertEquals(identifierLines(emptyListOutput), []);

  const inceptOutput = await captureOutputLines(inceptCommand({
    name,
    headDirPath,
    alias,
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  }));
  const joinedInceptOutput = inceptOutput.join("\n");
  assertStringIncludes(joinedInceptOutput, "Prefix");
  const prefixLine = inceptOutput.find((entry) => entry.startsWith("Prefix"));
  if (!prefixLine) {
    throw new Error(`Unable to parse prefix from output:\n${joinedInceptOutput}`);
  }
  const prefix = prefixLine.trim().split(/\s+/).at(-1) ?? "";

  const listOutput = await captureOutputLines(listCommand({
    name,
    headDirPath,
  }));
  assertEquals(identifierLines(listOutput), [
    `${alias} (${prefix})`,
  ]);

  const aidOutput = await captureOutputLines(aidCommand({
    name,
    headDirPath,
    alias,
  }));
  assertStringIncludes(aidOutput.join("\n"), prefix);
});

Deno.test("CLI - aid command requires alias", async () => {
  await assertOperationThrows(
    aidCommand({ name: "test" }),
    "Alias is required and cannot be empty",
  );
});
