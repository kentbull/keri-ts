import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { createConfiger, type Configer } from "../../../src/app/configing.ts";

async function reopenAndReadExistingConfig(
  cf: Configer,
  expected: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = cf.path;
  assert(path, "Config path must be set after opening configer");

  await run(() => cf.close());
  Deno.writeTextFileSync(path, `${JSON.stringify(expected)}\n`);

  await run(() => cf.reopen());
  return cf.get<Record<string, unknown>>();
}

Deno.test("Configer loads existing JSON file from persistent location", async () => {
  const cf = await run(() =>
    createConfiger({
      name: `persistent-cf-${crypto.randomUUID()}`,
      headDirPath: `/tmp/tufa-config-${crypto.randomUUID()}`,
      temp: false,
    })
  );

  try {
    const expected = {
      dt: "2026-02-25T00:00:00.000000+00:00",
      curls: ["tcp://localhost:5621/"],
      iurls: ["tcp://localhost:5620/?role=peer&name=tam"],
    };
    const loaded = await reopenAndReadExistingConfig(cf, expected);
    assertEquals(loaded, expected);
  } finally {
    await run(() => cf.close(true));
  }
});

Deno.test("Configer loads existing JSON file from temp location", async () => {
  const cf = await run(() =>
    createConfiger({
      name: `temp-cf-${crypto.randomUUID()}`,
      temp: true,
    })
  );

  try {
    const expected = {
      durls: ["http://127.0.0.1:7723/oobi/abc"],
      wurls: ["http://127.0.0.1:5644/.well-known/keri/oobi/xyz?name=Root"],
    };
    const loaded = await reopenAndReadExistingConfig(cf, expected);
    assertEquals(loaded, expected);
  } finally {
    await run(() => cf.close(true));
  }
});
