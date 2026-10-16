/** The version command must reject stale mirrors and preserve npm-owned lock metadata. */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test("manifest sync repairs Deno and workspace lock versions without dependency drift", async () => {
  const root = await Deno.makeTempDir({ prefix: "manifest-mirrors-" });
  const versions = { tufa: "0.12.0", keri: "0.12.0", cesr: "0.11.0" };
  const lock = {
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": { version: "1.0.0", dependencies: { keep: "1.2.3" } },
      "node_modules/keep": { version: "1.2.3", integrity: "unchanged npm metadata" },
      "packages/tufa": { version: "0.9.0", license: "Apache-2.0" },
      "packages/keri": { version: "0.9.0", license: "Apache-2.0" },
      "packages/cesr": { version: "0.9.0", license: "Apache-2.0" },
    },
  };
  const helper = `${root}/scripts/sync_manifest_versions.ts`;
  const lockPath = `${root}/package-lock.json`;
  /** Invoke the actual standalone command against only this fixture tree. */
  const run = (...args: string[]) =>
    new Deno.Command(Deno.execPath(), {
      args: ["run", `--allow-read=${root}`, `--allow-write=${root}`, helper, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
  try {
    await Deno.mkdir(`${root}/scripts`);
    await Deno.copyFile(new URL("./sync_manifest_versions.ts", import.meta.url), helper);
    for (const [name, version] of Object.entries(versions)) {
      const directory = `${root}/packages/${name}`;
      await Deno.mkdir(directory, { recursive: true });
      await Deno.writeTextFile(`${directory}/package.json`, JSON.stringify({ version }));
      // Only the lock is initially stale; Deno mirrors already agree.
      await Deno.writeTextFile(`${directory}/deno.json`, JSON.stringify({ version, exports: "./mod.ts" }));
    }
    await Deno.writeTextFile(lockPath, JSON.stringify(lock, null, 2) + "\n");
    const stale = await run("--check");
    assertEquals(stale.code, 1, "a stale workspace lock must fail check mode");
    assertStringIncludes(new TextDecoder().decode(stale.stderr), "package-lock.json");
    assertEquals((await run()).code, 0);
    const updated = JSON.parse(await Deno.readTextFile(lockPath));
    assertEquals(updated, {
      ...lock,
      packages: {
        ...lock.packages,
        "packages/tufa": { ...lock.packages["packages/tufa"], version: versions.tufa },
        "packages/keri": { ...lock.packages["packages/keri"], version: versions.keri },
        "packages/cesr": { ...lock.packages["packages/cesr"], version: versions.cesr },
      },
    });
    // Repair the other existing mirror with the same authoritative package version.
    await Deno.writeTextFile(
      `${root}/packages/keri/deno.json`,
      JSON.stringify({ version: "0.1.0", exports: "./mod.ts" }),
    );
    assertEquals((await run("--check")).code, 1);
    assertEquals((await run()).code, 0);
    assertEquals(JSON.parse(await Deno.readTextFile(`${root}/packages/keri/deno.json`)), {
      version: versions.keri,
      exports: "./mod.ts",
    });
    assertEquals((await run("--check")).code, 0);
    const bytes = await Deno.readTextFile(lockPath);
    assertEquals((await run()).code, 0);
    assertEquals(await Deno.readTextFile(lockPath), bytes, "consistent mirrors are not rewritten");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
