import { run } from "effection";
import { assertStringIncludes } from "jsr:@std/assert";
import { initCommand } from "../../../src/app/cli/init.ts";
import { assertOperationThrows, createMockArgs } from "../../../test/utils.ts";

Deno.test("CLI - init command with valid arguments", async () => {
  const args = createMockArgs({
    name: "testkeystore",
    nopasscode: true,
  });

  await run(() => initCommand(args));
  // Test passes if no exception is thrown
});

Deno.test("CLI - init command requires name", async () => {
  const args = createMockArgs({
    name: "",
    nopasscode: true,
  });

  await assertOperationThrows(
    initCommand(args),
    "Name is required and cannot be empty",
  );
});

Deno.test("CLI - init command with missing name", async () => {
  const args = createMockArgs({
    name: undefined,
    nopasscode: true,
  });

  await assertOperationThrows(
    initCommand(args),
    "Name is required and cannot be empty",
  );
});

Deno.test("CLI - init command with help flag", async () => {
  const args = createMockArgs({
    help: true,
  });

  // Mock console.log to capture output
  const originalLog = console.log;
  let capturedOutput = "";
  console.log = (message: string) => {
    capturedOutput += message;
  };

  try {
    await run(() => initCommand(args));
    assertStringIncludes(capturedOutput, "tufa init -");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("CLI - init command with all options", async () => {
  const args = createMockArgs({
    name: "fulltest",
    base: "/custom/base",
    temp: true,
    salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
    configDir: "/custom/config",
    configFile: "custom.json",
    passcode: "testpasscode123456789012",
    nopasscode: true, // Use nopasscode to avoid prompt
  });

  await run(() => initCommand(args));
  // Test passes if no exception is thrown
});

Deno.test("CLI - init command with custom salt", async () => {
  const args = createMockArgs({
    name: "salttest",
    salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
    nopasscode: true,
  });

  await run(() => initCommand(args));
  // Test passes if no exception is thrown
});

Deno.test("CLI - init command with config overrides", async () => {
  const args = createMockArgs({
    name: "configtest",
    configDir: "/custom/config/dir",
    configFile: "custom-config.json",
    nopasscode: true,
  });

  await run(() => initCommand(args));
  // Test passes if no exception is thrown
});

Deno.test("CLI - init command honors custom head directory", async () => {
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const args = createMockArgs({
    name: `headtest-${crypto.randomUUID()}`,
    headDirPath,
    nopasscode: true,
  });

  const originalLog = console.log;
  let capturedOutput = "";
  console.log = (...messages: unknown[]) => {
    capturedOutput += `${messages.map(String).join(" ")}\n`;
  };

  try {
    await run(() => initCommand(args));
    assertStringIncludes(capturedOutput, headDirPath);
  } finally {
    console.log = originalLog;
  }
});
