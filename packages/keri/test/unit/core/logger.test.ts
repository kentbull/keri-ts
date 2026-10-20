import { assertEquals } from "jsr:@std/assert";

Deno.test("enabled diagnostics go only to stderr and honor the selected minimum level", async () => {
  const logger = new URL("../../../src/core/logger.ts", import.meta.url).href;
  for (
    const [minimum, expected] of [
      ["debug", ["debug", "info", "warn", "error"]],
      ["info", ["info", "warn", "error"]],
      ["warn", ["warn", "error"]],
      ["error", ["error"]],
    ] as const
  ) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `
        import { consoleLogger, setLogLevel, getLogLevel } from ${JSON.stringify(logger)};
        setLogLevel(${JSON.stringify(minimum)});
        if (getLogLevel() !== ${JSON.stringify(minimum)}) throw new Error("level was not retained");
        for (const level of ["debug", "info", "warn", "error"]) consoleLogger[level](level, "detail");
      `,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(result.code, 0, stderr);
    assertEquals(new TextDecoder().decode(result.stdout), "");
    assertEquals(stderr.trim().split("\n"), expected.map((level) => `${level} detail`));
  }
});
