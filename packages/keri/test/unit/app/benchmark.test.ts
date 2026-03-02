import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { run } from "effection";
import { tufa } from "../../../src/app/cli/cli.ts";

Deno.test("CLI - tufa benchmark cesr reads stream file and prints metrics", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const sample = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';

  const originalLog = console.log;
  let captured = "";
  console.log = (...messages: unknown[]) => {
    captured += `${messages.map(String).join(" ")}\n`;
  };

  try {
    await Deno.writeTextFile(inPath, sample.repeat(3));
    await run(() =>
      tufa([
        "benchmark",
        "cesr",
        "--in",
        inPath,
        "--iterations",
        "1",
        "--warmup",
        "0",
      ])
    );
    assertStringIncludes(captured, "CESR parser benchmark");
    assertStringIncludes(captured, "frames/iteration:");
    assertStringIncludes(captured, "throughput:");
  } finally {
    console.log = originalLog;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI - tufa benchmark cesr emits JSON result when requested", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const sample = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';

  const originalLog = console.log;
  let captured = "";
  console.log = (...messages: unknown[]) => {
    captured += `${messages.map(String).join(" ")}\n`;
  };

  try {
    await Deno.writeTextFile(inPath, sample.repeat(2));
    await run(() =>
      tufa([
        "benchmark",
        "cesr",
        "--in",
        inPath,
        "--iterations",
        "1",
        "--warmup",
        "0",
        "--json",
      ])
    );

    const line = captured.trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assertEquals(parsed.source, inPath);
    assertEquals(parsed.iterations, 1);
  } finally {
    console.log = originalLog;
    await Deno.remove(dir, { recursive: true });
  }
});
