import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";

/** ANSI escape prefix used by the actual colored stdout contract. */
const ESC = String.fromCharCode(0x1b);
/** Real CLI entrypoint exercises native writes and scoped command completion. */
const CLI = fromFileUrl(new URL("../mod.ts", import.meta.url));
/** Small valid JSON body for presentation tests. */
const SAMPLE = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";

/** Run annotation in an isolated process and return its requested output destination. */
async function annotateFile(options: string[] = [], fileOutput = false, colors?: string): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    const input = `${dir}/in.cesr`;
    const output = `${dir}/out.annotated`;
    await Deno.writeTextFile(input, SAMPLE);
    if (colors) {
      // Only this child sees the test color configuration; no parent environment is mutated.
      await Deno.mkdir(`${dir}/.tufa`);
      await Deno.writeTextFile(`${dir}/.tufa/annot-color.yaml`, colors);
    }
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", CLI, "annotate", "--in", input, ...options, ...(fileOutput ? ["--out", output] : [])],
      env: { HOME: dir },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    if (fileOutput) {
      assertEquals(result.stdout.length, 0);
      return await Deno.readTextFile(output);
    }
    return new TextDecoder().decode(result.stdout);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("tufa/annotate - reads from file and writes annotation", async () => {
  assertStringIncludes(await annotateFile([], true), "SERDER KERI JSON");
});

Deno.test("tufa/annotate - --colored applies ANSI styling on stdout", async () => {
  const output = await annotateFile(["--colored"]);
  assertStringIncludes(output, "SERDER KERI JSON");
  assertStringIncludes(output, ESC);
});

Deno.test("tufa/annotate - --colored --pretty colors pretty JSON body lines", async () => {
  const output = await annotateFile(["--colored", "--pretty"]);
  assertStringIncludes(output, "\"v\": \"KERI10JSON00002e_\"");
  assertStringIncludes(output, ESC);
  assertStringIncludes(output, "  \"v\":");
});

Deno.test("tufa/annotate - --colored never colors --out file output", async () => {
  const output = await annotateFile(["--colored"], true);
  assertStringIncludes(output, "SERDER KERI JSON");
  assertEquals(output.includes(ESC), false);
});

Deno.test("tufa/annotate - loads valid YAML color overrides from HOME", async () => {
  const output = await annotateFile(["--colored"], false, "comment: red\nbody: brightGreen\n");
  assertStringIncludes(output, `${ESC}[31mSERDER KERI JSON`);
});
