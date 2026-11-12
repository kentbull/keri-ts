import { assertEquals, assertThrows } from "jsr:@std/assert";
import { extendedInteropMatrix, referenceProfiles } from "./extended-interop-matrix.ts";
import { groups, interop, required, suites } from "./keri-test-suites.ts";

Deno.test("extended matrices preserve every exported owner and all four reference executions", () => {
  assertEquals(groups.full, [...required, ...interop]);
  assertEquals(groups["extended-interop"], interop);
  for (const [target, count] of [["full", 28], ["extended-interop", 18], ["qualification", 30]] as const) {
    const rows = extendedInteropMatrix(target).include;
    assertEquals(rows.length, count);
    assertEquals(new Set(rows.map((row) => row.id)).size, count);
    assertEquals([...new Set(rows.map((row) => row.suite))], groups[target]);
    for (const suite of groups[target]) {
      const selected = rows.filter((row) => row.suite === suite);
      assertEquals(
        selected.map((row) => row.profile),
        suite === "interop-reference-profiles" ? referenceProfiles : [""],
      );
    }
  }
});

Deno.test("concrete matrix rows preserve their pinned peer and service preparation", () => {
  for (const suite of Object.keys(suites)) {
    const rows = extendedInteropMatrix(suite).include;
    for (const row of rows) {
      assertEquals(row.main, suite === "interop-essr-storage");
      assertEquals(
        row.candidate,
        ["interop-v2-registry", "interop-ipex-disclosure", "interop-kram"].includes(suite),
      );
      assertEquals(row.services, suite === "interop-v2-registry");
    }
  }
  assertThrows(() => extendedInteropMatrix("unknown"), Error, "Unknown extended interop target");
});

Deno.test("reference selector accepts exactly one known peer before preparing dependencies", async () => {
  const path = "scripts/ci/qualify-reference-profiles.py";
  const code = `import runpy\nm = runpy.run_path(${JSON.stringify(path)})\n`
    + `assert m['selected_profiles']([]) == tuple(${JSON.stringify(referenceProfiles)})\n`
    + referenceProfiles.map((profile) =>
      `assert m['selected_profiles'](['--profile', '${profile}']) == ('${profile}',)\n`
    ).join("");
  const selected = await new Deno.Command("python3", { args: ["-c", code] }).output();
  assertEquals(selected.code, 0, new TextDecoder().decode(selected.stderr));
  for (const args of [["--profile", "unknown"], ["--unknown"], ["--profile"]]) {
    const rejected = await new Deno.Command("python3", { args: [path, ...args], stderr: "piped" }).output();
    assertEquals(rejected.code, 2);
  }
});
