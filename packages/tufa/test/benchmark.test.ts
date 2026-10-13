import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";

/** Real command entrypoint ensures pipe/stdout behavior is exercised rather than replacing console methods. */
const CLI = fromFileUrl(new URL("../mod.ts", import.meta.url));
/** One valid JSON message; repetitions test actual frame counting. */
const SAMPLE = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";

/** Execute a finite benchmark corpus through the actual Deno CLI process. */
async function benchmarkFile(input: string, options: string[] = []): Promise<Deno.CommandOutput> {
  const path = await Deno.makeTempFile({ suffix: ".cesr" });
  try {
    await Deno.writeTextFile(path, input);
    return await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", CLI, "benchmark", "cesr", "--in", path, "--iterations", "1", "--warmup", "0", ...options],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } finally {
    await Deno.remove(path);
  }
}

Deno.test("tufa/benchmark - cesr reads stream file and prints metrics", async () => {
  const result = await benchmarkFile(SAMPLE.repeat(3));
  const output = new TextDecoder().decode(result.stdout);
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  assertStringIncludes(output, "CESR parser benchmark");
  assertStringIncludes(output, "frames/iteration: 3.00");
  assertStringIncludes(output, "throughput:");
});

Deno.test("tufa/benchmark - JSON counts complete runs and rejects malformed or oversized corpora", async () => {
  const result = await benchmarkFile(SAMPLE.repeat(2), ["--json"]);
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  const parsed = JSON.parse(new TextDecoder().decode(result.stdout));
  assertEquals(parsed.iterations, 1);
  assertEquals(parsed.totalFrames, 2);
  assertEquals(parsed.totalBytes, SAMPLE.length * 2);
  // Failed runs must not emit successful throughput metrics, even before the first measured pass.
  for (const [input, options] of [[SAMPLE.slice(0, 20), []], [SAMPLE, ["--max-bytes", "8"]]] as const) {
    const failed = await benchmarkFile(input, [...options]);
    assertEquals(failed.code, 1);
    assertEquals(failed.stdout.length, 0);
  }
});
