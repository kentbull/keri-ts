import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { tufa } from "../../../src/app/cli/cli.ts";
import { DISPLAY_VERSION } from "../../../src/app/version.ts";

Deno.test("CLI - tufa version command prints display version", async () => {
  const originalLog = console.log;
  const captured: string[] = [];
  console.log = (message?: unknown) => {
    captured.push(String(message ?? ""));
  };

  try {
    await run(() => tufa(["version"]));
    assertEquals(captured.length, 1);
    assertEquals(captured[0], DISPLAY_VERSION);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("CLI - tufa --version prints display version", async () => {
  await run(() => tufa(["--version"]));
});
