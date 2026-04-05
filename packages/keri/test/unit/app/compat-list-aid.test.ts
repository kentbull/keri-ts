import { run } from "effection";
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { aidCommand } from "../../../src/app/cli/aid.ts";
import { listCommand } from "../../../src/app/cli/list.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { CLITestHarness, ensureCompatLmdbBuild } from "../../../test/utils.ts";

function identifierLines(lines: string[]): string[] {
  return lines.filter((line) => /^[^:()]+ \([A-Za-z0-9_-]{10,}\)$/.test(line.trim()));
}

Deno.test("CLI - compat list/aid open a .keri-layout store without config or signator side effects", async () => {
  await ensureCompatLmdbBuild();

  const oldHome = Deno.env.get("HOME");
  const home = await Deno.makeTempDir({ prefix: "tufa-compat-home-" });
  const name = `compat-${crypto.randomUUID()}`;
  const alias = "alice";

  Deno.env.set("HOME", home);

  try {
    let prefix = "";
    await run(function*() {
      const hby = yield* createHabery({
        name,
        compat: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assert(hby.db.path?.includes("/.keri/db/"));
        assert(hby.ks.path?.includes("/.keri/ks/"));
        const hab = hby.makeHab(alias, undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        prefix = hab.pre;
      } finally {
        yield* hby.close();
      }
    });

    const listHarness = new CLITestHarness();
    listHarness.captureOutput();
    try {
      await run(() =>
        listCommand({
          name,
          compat: true,
        })
      );
      assertEquals(identifierLines(listHarness.getOutput()), [
        `${alias} (${prefix})`,
      ]);
    } finally {
      listHarness.restoreOutput();
    }

    const aidHarness = new CLITestHarness();
    aidHarness.captureOutput();
    try {
      await run(() =>
        aidCommand({
          name,
          alias,
          compat: true,
        })
      );
      assertStringIncludes(aidHarness.getOutput().join("\n"), prefix);
    } finally {
      aidHarness.restoreOutput();
    }
  } finally {
    if (oldHome) {
      Deno.env.set("HOME", oldHome);
    } else {
      Deno.env.delete("HOME");
    }
  }
});
