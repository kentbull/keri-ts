/** The check must fail a dependent that was not bumped and pass the real workspace. */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { checkInternalDependencies } from "./check-internal-dependencies.ts";

async function fixture(
  packages: Record<string, { name: string; version: string; dependencies?: Record<string, string>; build?: string }>,
) {
  const root = await Deno.makeTempDir({ prefix: "internal-deps-" });
  for (const [dir, { build, ...manifest }] of Object.entries(packages)) {
    await Deno.mkdir(`${root}/packages/${dir}/scripts`, { recursive: true });
    await Deno.writeTextFile(`${root}/packages/${dir}/package.json`, JSON.stringify(manifest));
    if (build) await Deno.writeTextFile(`${root}/packages/${dir}/scripts/build_npm.ts`, build);
  }
  return root;
}

Deno.test("a dependent pinned to an old dependency version is reported", async () => {
  const root = await fixture({
    keri: { name: "keri-ts", version: "2.2.3" },
    hosting: { name: "@keri-ts/hosting", version: "2.2.2", dependencies: { "keri-ts": "2.2.2" } },
  });
  try {
    const problems = await checkInternalDependencies(root);
    assertEquals(problems.length, 1);
    assertStringIncludes(problems[0], "@keri-ts/hosting@2.2.2 pins keri-ts at 2.2.2, but keri-ts is at 2.2.3");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a coherent workspace passes, and external dependencies are ignored", async () => {
  const root = await fixture({
    keri: { name: "keri-ts", version: "2.2.3", dependencies: { effection: "^3.6.0" } },
    hosting: {
      name: "@keri-ts/hosting",
      version: "2.2.3",
      dependencies: { "keri-ts": "2.2.3" },
      build: "readPackageVersionSync(\"../keri/package.json\")",
    },
  });
  try {
    assertEquals(await checkInternalDependencies(root), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a sibling the build reads but package.json does not declare is reported", async () => {
  const root = await fixture({
    keri: { name: "keri-ts", version: "2.2.3" },
    hosting: {
      name: "@keri-ts/hosting",
      version: "2.2.3",
      build: "readPackageVersionSync(\"../keri/package.json\")",
    },
  });
  try {
    const problems = await checkInternalDependencies(root);
    assertEquals(problems.length, 1);
    assertStringIncludes(problems[0], "does not declare it");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("the real workspace is coherent", async () => {
  assertEquals(await checkInternalDependencies(new URL("../..", import.meta.url).pathname), []);
});
