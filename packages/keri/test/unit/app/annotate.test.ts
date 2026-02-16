import { assertStringIncludes } from "jsr:@std/assert";
import { run } from "effection";
import { tufa } from "../../../src/app/cli/cli.ts";

Deno.test("CLI - tufa annotate reads from file and writes annotation", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const outPath = `${dir}/out.annotated`;

  try {
    const cesr = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';
    await Deno.writeTextFile(inPath, cesr);

    await run(() => tufa(["annotate", "--in", inPath, "--out", outPath]));
    const out = await Deno.readTextFile(outPath);

    assertStringIncludes(out, "SERDER KERI JSON");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
