// @file-test-lane app-fast

import { run } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { tufa } from "../../../src/app/cli/cli.ts";

const ESC = String.fromCharCode(0x1b);

Deno.test("CLI - tufa annotate reads from file and writes annotation", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const outPath = `${dir}/out.annotated`;

  try {
    const cesr = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
    await Deno.writeTextFile(inPath, cesr);

    await run(() => tufa(["annotate", "--in", inPath, "--out", outPath]));
    const out = await Deno.readTextFile(outPath);

    assertStringIncludes(out, "SERDER KERI JSON");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI - tufa annotate --colored applies ANSI styling on stdout", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const cesr = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
  await Deno.writeTextFile(inPath, cesr);

  const originalLog = console.log;
  let captured = "";
  console.log = (...values: unknown[]) => {
    captured += `${values.map(String).join(" ")}\n`;
  };

  try {
    await run(() => tufa(["annotate", "--in", inPath, "--colored"]));
  } finally {
    console.log = originalLog;
    await Deno.remove(dir, { recursive: true });
  }

  assertStringIncludes(captured, "SERDER KERI JSON");
  assertStringIncludes(captured, ESC);
});

Deno.test("CLI - tufa annotate --colored --pretty colors pretty JSON body lines", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const cesr = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
  await Deno.writeTextFile(inPath, cesr);

  const originalLog = console.log;
  let captured = "";
  console.log = (...values: unknown[]) => {
    captured += `${values.map(String).join(" ")}\n`;
  };

  try {
    await run(() => tufa(["annotate", "--in", inPath, "--colored", "--pretty"]));
  } finally {
    console.log = originalLog;
    await Deno.remove(dir, { recursive: true });
  }

  assertStringIncludes(captured, "\"v\": \"KERI10JSON00002e_\"");
  assertStringIncludes(captured, ESC);
  assertStringIncludes(captured, "  \"v\":");
});

Deno.test("CLI - tufa annotate --colored never colors --out file output", async () => {
  const dir = await Deno.makeTempDir();
  const inPath = `${dir}/in.cesr`;
  const outPath = `${dir}/out.annotated`;
  const cesr = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
  await Deno.writeTextFile(inPath, cesr);

  try {
    await run(() => tufa(["annotate", "--in", inPath, "--out", outPath, "--colored"]));
    const out = await Deno.readTextFile(outPath);
    assertStringIncludes(out, "SERDER KERI JSON");
    assertEquals(out.includes(ESC), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI - tufa annotate loads valid YAML color overrides from HOME", async () => {
  const dir = await Deno.makeTempDir();
  const homeDir = `${dir}/home`;
  const inPath = `${dir}/in.cesr`;

  await Deno.mkdir(`${homeDir}/.tufa`, { recursive: true });
  await Deno.writeTextFile(
    `${homeDir}/.tufa/annot-color.yaml`,
    "comment: red\nbody: brightGreen\n",
  );
  await Deno.writeTextFile(
    inPath,
    "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}",
  );

  const originalHome = Deno.env.get("HOME");
  const originalLog = console.log;
  let captured = "";
  Deno.env.set("HOME", homeDir);
  console.log = (...values: unknown[]) => {
    captured += `${values.map(String).join(" ")}\n`;
  };

  try {
    await run(() => tufa(["annotate", "--in", inPath, "--colored"]));
  } finally {
    console.log = originalLog;
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(dir, { recursive: true });
  }

  assertStringIncludes(captured, `${ESC}[31mSERDER KERI JSON`);
});
