import { assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { b, bytesHex } from "../../../../cesr/mod.ts";
import { createScenarioContext, runCmd, runTufa } from "./interop-keystore-helpers.ts";

/** Rows observed through a freshly reopened Python-owned Baser. */
interface PythonSnapshot {
  path: string;
  tables: Record<string, [string, string][]>;
}

Deno.test("interop/oobi-store - remove an exact pending key and reopen the complete Python store", async () => {
  const ctx = await createScenarioContext();
  const headDirPath = ctx.env.HOME;
  const name = "python-oobi-maintenance";
  const selected = "https://example.test/oobi/A%2fb?role=controller";
  const retained = " https://example.test/oobi/A%2Fb?role=controller ";
  const fixture = new URL("./oobi-store-reference.py", import.meta.url);
  /** Exercise the verified peer's typed store and capture pending/adjacent rows. */
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
    const keyFile = `${headDirPath}/keys.json`;
    await Deno.writeTextFile(keyFile, JSON.stringify([selected, selected]));
    const args = ["oobi", "clean", "--name", name, "--head-dir", headDirPath, "--compat", "--key-file", keyFile];
    const preview = await runTufa(args, ctx.env, ctx.packageRoot);
    assertEquals(preview.code, 0, preview.stderr);
    assertEquals(JSON.parse(preview.stdout), {
      path: before.path,
      mode: "preview",
      status: "complete",
      selectedCount: 1,
      entries: [{ key: selected, present: true }],
      missing: [],
      deletedCount: 0,
      deleted: [],
      remaining: [selected],
    });
    const applied = await runTufa([...args, "--apply"], ctx.env, ctx.packageRoot);
    assertEquals(applied.code, 0, applied.stderr);
    assertEquals(JSON.parse(applied.stdout).status, "complete");
    assertEquals(JSON.parse(applied.stdout).deleted, [selected]);
    const after = await reference("verify");
    assertEquals(after.path, before.path);
    for (const name of ["oobis.", "woobi.", "coobi.", "roobi."]) {
      const expected = name === "oobis."
        ? before.tables[name].filter(([key]) => key !== bytesHex(b(selected)))
        : before.tables[name];
      assertEquals(after.tables[name], expected);
    }
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
