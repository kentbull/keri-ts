import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { b, bytesHex } from "../../../../cesr/mod.ts";
import { openOobiStore } from "../../../src/db/oobi-store.ts";
import { createScenarioContext, runCmd } from "./interop-keystore-helpers.ts";

/** Raw Python-owned table rows plus the preserved root metadata. */
interface PythonSnapshot {
  path: string;
  metadata: Record<string, string>;
  tables: Record<string, [string, string][]>;
}

Deno.test("interop/oobi-store - remove an exact pending key and reopen the complete Python store", async () => {
  const ctx = await createScenarioContext();
  const headDirPath = ctx.env.HOME;
  const name = "python-oobi-maintenance";
  const selected = "https://example.test/oobi/A%2fb?role=controller";
  const retained = " https://example.test/oobi/A%2Fb?role=controller ";
  const fixture = new URL("./oobi-store-reference.py", import.meta.url);
  /** Exercise the verified peer's typed store and capture every persistent row. */
  async function reference(action: "create" | "verify"): Promise<PythonSnapshot> {
    const result = await runCmd(
      ctx.pythonCommand,
      [
        fromFileUrl(fixture),
        action,
        headDirPath,
        name,
        selected,
        retained,
      ],
      ctx.env,
      ctx.packageRoot,
    );
    assertEquals(result.code, 0, `${result.stderr}\n${result.stdout}`);
    return JSON.parse(result.stdout);
  }
  try {
    const before = await reference("create");
    const data = await Deno.readFile(`${before.path}/data.mdb`);
    await run(function*() {
      const store = yield* openOobiStore({ headDirPath, name, compat: true });
      assertEquals(store.path, before.path);
      assertEquals(store.get(selected)?.date, "2026-10-20T00:00:00.000000+00:00");
    });
    assertEquals(await Deno.readFile(`${before.path}/data.mdb`), data);
    await run(function*() {
      const store = yield* openOobiStore({ headDirPath, name, compat: true, readonly: false });
      assertEquals(store.rem(selected), true);
    });
    before.tables["oobis."] = before.tables["oobis."].filter(([key]) => key !== bytesHex(b(selected)));
    assertEquals(await reference("verify"), before);
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
