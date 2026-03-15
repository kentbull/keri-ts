import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { PathManager } from "../../../../src/db/core/path-manager.ts";

Deno.test("db/core path-manager - reopen falls back to ~/.tufa when primary mkdir gets Node-style EACCES", async () => {
  const homeDir = await Deno.makeTempDir({ prefix: "path-manager-home-" });
  const originalHome = Deno.env.get("HOME");
  const originalMkdir = Deno.mkdir;

  Deno.env.set("HOME", homeDir);

  const pathManager = new PathManager({
    name: `fallback-${crypto.randomUUID()}`,
  });

  const primaryPath = join("/usr/local/var", "keri/db", pathManager.name);
  const expectedAltPath = join(homeDir, ".tufa/db", pathManager.name);

  Object.defineProperty(Deno, "mkdir", {
    configurable: true,
    value: (path: string | URL, options?: Deno.MkdirOptions) => {
      if (typeof path === "string" && path === primaryPath) {
        const error = new Error(
          `EACCES: permission denied, mkdir '${path}'`,
        ) as Error & { code?: string };
        error.code = "EACCES";
        return Promise.reject(error);
      }
      return originalMkdir(path, options);
    },
  });

  try {
    await run(function* () {
      assertEquals(yield* pathManager.reopen(), true);
    });

    assertEquals(pathManager.path, expectedAltPath);
    assertEquals((await Deno.stat(expectedAltPath)).isDirectory, true);
  } finally {
    Object.defineProperty(Deno, "mkdir", {
      configurable: true,
      value: originalMkdir,
    });
    if (originalHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", originalHome);
    }
    await Deno.remove(homeDir, { recursive: true }).catch(() => undefined);
  }
});
