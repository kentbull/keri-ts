import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { createConfiger } from "../../../../src/app/identity/configing.ts";
import { InvalidPathNameError } from "../../../../src/core/errors.ts";
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
    await run(function*() {
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

// Expected values below come from running hio 0.7.20 `Filer` with KERIpy's class constants.
const KERI_DB = {
  tailDirPath: "keri/db",
  cleanTailDirPath: "keri/clean/db",
  altTailDirPath: ".keri/db",
  altCleanTailDirPath: ".keri/clean/db",
};

async function withHome(body: (home: string) => Promise<void>): Promise<void> {
  const home = await Deno.makeTempDir({ prefix: "path-manager-home-" });
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    await body(home);
  } finally {
    if (originalHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", originalHome);
    await Deno.remove(home, { recursive: true }).catch(() => undefined);
  }
}

const mode = (path: string) => Deno.statSync(path).mode! & 0o7777;

Deno.test("db/core path-manager - a fallback does not change where the next open starts", () =>
  withHome(async (home) => {
    Deno.writeTextFileSync(`${home}/afile`, "");
    const head = `${home}/afile/x`;
    const pm = new PathManager({ name: "n", headDirPath: head }, KERI_DB);
    await run(() => pm.reopen());
    assertEquals(pm.path, `${home}/.keri/db/n`);
    assertEquals(pm.headDirPath, head);
    await run(() => pm.close());
    await run(() => pm.reopen());
    assertEquals(pm.path, `${home}/.keri/db/n`);
  }));

Deno.test("db/core path-manager - only the leaf directory is restricted, including an existing one", () =>
  withHome(async (home) => {
    const leaf = `${home}/h/keri/db/n`;
    const pm = new PathManager({ name: "n", headDirPath: `${home}/h` }, KERI_DB);
    await run(() => pm.reopen());
    assertEquals(pm.path, leaf);
    assertEquals(mode(leaf), 0o1700);
    assertEquals(mode(`${home}/h/keri/db`) & 0o700, 0o700);
    assertEquals(mode(`${home}/h/keri/db`) === 0o1700, false);

    Deno.chmodSync(leaf, 0o755);
    await run(() => pm.reopen());
    assertEquals(mode(leaf), 0o1700);
  }));

Deno.test("db/core path-manager - clean removes an existing clean copy before use", () =>
  withHome(async (home) => {
    const leaf = `${home}/h/keri/clean/db/n`;
    Deno.mkdirSync(leaf, { recursive: true });
    Deno.writeTextFileSync(`${leaf}/marker`, "");
    const pm = new PathManager({ name: "n", headDirPath: `${home}/h` }, KERI_DB);
    await run(() => pm.reopen({ clean: true }));
    assertEquals(pm.path, leaf);
    assertEquals([...Deno.readDirSync(leaf)], []);
  }));

Deno.test("db/core path-manager - absolute names and bases are refused", () => {
  assertThrows(() => new PathManager({ name: "/abs" }, KERI_DB), InvalidPathNameError);
  assertThrows(() => new PathManager({ name: "n", base: "/abs" }, KERI_DB), InvalidPathNameError);
});

Deno.test("db/core path-manager - a temp store keeps one directory per name across reopen", () =>
  withHome(async () => {
    const name = `t-${crypto.randomUUID()}`;
    const pm = new PathManager({ name, temp: true }, { ...KERI_DB, tempPrefix: "keri_lmdb_" });
    await run(() => pm.reopen());
    const path = pm.path!;
    assertEquals(path.endsWith(`/keri_lmdb_${name}_test`), true);
    Deno.writeTextFileSync(`${path}/marker`, "");
    await run(() => pm.close());
    await run(() => pm.reopen());
    assertEquals(pm.path, path);
    assertEquals(Deno.statSync(`${path}/marker`).isFile, true);
    await run(() => pm.close(true));
    assertThrows(() => Deno.statSync(path), Deno.errors.NotFound);
  }));

Deno.test("configing - the config file sits directly under its base, as in KERIpy", () =>
  withHome(async (home) => {
    const named = await run(() => createConfiger({ name: "wil", base: "", headDirPath: `${home}/h` }));
    assertEquals(named.path, `${home}/h/keri/cf/wil.json`);
    await run(() => named.close(true));
    const defaultBase = await run(() => createConfiger({ name: "wil", headDirPath: `${home}/h` }));
    assertEquals(defaultBase.path, `${home}/h/keri/cf/main/wil.json`);
    await run(() => defaultBase.close(true));
  }));
