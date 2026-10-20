import { run } from "effection";
import { assert, assertEquals, assertRejects, assertStrictEquals, assertStringIncludes } from "jsr:@std/assert";
import { b, t, Verfer } from "../../../../cesr/mod.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { branToSeedAeid, createHabery } from "../../../src/app/habbing.ts";
import { PathError, ValidationError } from "../../../src/core/errors.ts";
import { PathManager } from "../../../src/db/core/path-manager.ts";

const passcode = "MyPasscodeARealSecret";
const wrong = "AnotherPasscodeSecretX";
const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";

/** Exercise the real CLI with explicitly closed noninteractive stdin. */
async function command(args: string[], env: Record<string, string> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
      cwd: new URL("../../../../../", import.meta.url),
      env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    }).output();
    return { code: result.code, stdout: t(result.stdout), stderr: t(result.stderr) };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.test("init credentials - reject absent, incomplete and contradictory credentials before effects", async () => {
  const head = await Deno.makeTempDir();
  const first = branToSeedAeid(passcode);
  const other = branToSeedAeid(wrong);
  try {
    const invalid = [
      [],
      ["--temp"],
      ["--passcode", ""],
      ["--passcode", "   "],
      ["--passcode", "short"],
      ["--aeid", first.aeid],
      ["--seed", first.seed],
      ["--aeid", first.aeid, "--seed", other.seed],
      ["--aeid", "invalid", "--seed", "invalid"],
      ["--nopasscode", "--passcode", passcode],
      ["--nopasscode", "--aeid", first.aeid, "--seed", first.seed],
      ["--passcode", passcode, "--aeid", first.aeid, "--seed", first.seed],
    ];
    for (const flags of invalid) {
      const result = await command([
        "init",
        "--name",
        "never-created",
        "--head-dir",
        head,
        "--config-dir",
        head,
        "--config-file",
        "never-created",
        ...flags,
      ]);
      assertEquals(result.code, 1, `${flags.join(" ")}: ${result.stdout}`);
      assertEquals(result.stdout, "");
      assertEquals([...Deno.readDirSync(head)], []);
    }
    for (const args of [{ passcode: null }, { seed: 7 }, { nopasscode: "true" }, { temp: 1 }]) {
      await assertRejects(() =>
        run(() =>
          initCommand({
            name: "never-created",
            headDirPath: head,
            ...args,
          })
        ), ValidationError);
      assertEquals([...Deno.readDirSync(head)], []);
    }
  } finally {
    await Deno.remove(head, { recursive: true });
  }
});

Deno.test("init credentials - passcode and explicit key pair reopen encrypted state without prompting", async () => {
  const headDirPath = await Deno.makeTempDir();
  const first = branToSeedAeid(passcode);
  try {
    for (
      const [name, flags] of [
        ["passcode", ["--passcode", passcode]],
        ["keypair", ["--aeid", first.aeid, "--seed", first.seed]],
      ] as const
    ) {
      const initialized = await command(["init", "--name", name, "--head-dir", headDirPath, "--salt", salt, ...flags]);
      assertEquals(initialized.code, 0, initialized.stderr);
      assertStringIncludes(initialized.stdout, first.aeid);
      assertEquals(initialized.stdout.includes("Credential Store created"), false);
      assertEquals(initialized.stderr.includes("Passcode:"), false);
      assertEquals(initialized.stdout.includes("please enter"), false);
      let pub = "";
      await run(function*() {
        const hby = yield* createHabery({ name, headDirPath, bran: passcode, skipConfig: true, skipSignator: true });
        try {
          assertEquals(hby.mgr.aeid, first.aeid);
          assertEquals(hby.mgr.salt, salt);
          assert(hby.ks.getGbls("salt") !== salt);
          const [verfers] = hby.mgr.incept({ icount: 1, ncount: 1, transferable: true });
          pub = verfers[0].qb64;
        } finally {
          yield* hby.close();
        }
      });
      const denied = await command(["init", "--name", name, "--head-dir", headDirPath, "--passcode", wrong]);
      assertEquals(denied.code, 1);
      assertStringIncludes(denied.stderr, "not associated with last aeid");
      const deniedList = await command(["list", "--name", name, "--head-dir", headDirPath, "--passcode", wrong]);
      assertEquals(deniedList.code, 1);
      assertStringIncludes(deniedList.stderr, "not associated with last aeid");
      await run(function*() {
        const hby = yield* createHabery({
          name,
          headDirPath,
          seed: first.seed,
          aeid: first.aeid,
          skipConfig: true,
          skipSignator: true,
        });
        try {
          const sigers = hby.mgr.sign(b("reopened"), [pub], true);
          assertEquals(sigers.length, 1);
          assert(new Verfer({ qb64: pub }).verify(sigers[0].raw, b("reopened")));
        } finally {
          yield* hby.close();
        }
      });
    }
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("init credentials - explicit plaintext and temporary paths remain explicit", async () => {
  const headDirPath = await Deno.makeTempDir();
  try {
    for (const temp of [false, true]) {
      const name = `explicit-${temp}`;
      const flags = temp ? ["--temp"] : [];
      const result = await command([
        "init",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--salt",
        salt,
        "--nopasscode",
        ...flags,
      ], { TMPDIR: headDirPath });
      assertEquals(result.code, 0, result.stderr);
      await run(function*() {
        // The child's TMPDIR is supplied as the test-owned head for temp paths.
        const prior = Deno.env.get("TMPDIR");
        Deno.env.set("TMPDIR", headDirPath);
        try {
          const hby = yield* createHabery({ name, headDirPath, temp, skipConfig: true, skipSignator: true });
          try {
            assertEquals(hby.mgr.aeid, "");
            assertEquals(hby.ks.getGbls("salt"), salt);
            assertEquals(hby.temp, temp);
            assert(hby.db.path!.startsWith(headDirPath));
          } finally {
            yield* hby.close();
          }
        } finally {
          if (prior === undefined) Deno.env.delete("TMPDIR");
          else Deno.env.set("TMPDIR", prior);
        }
      });
    }
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});

Deno.test("init credentials - persistent path failure never retries in temporary mode", async () => {
  const head = await Deno.makeTempDir();
  try {
    const parent = `${head}/not-a-directory`;
    await Deno.writeTextFile(parent, "retain me");
    const result = await command([
      "init",
      "--name",
      "must-not-fallback",
      "--head-dir",
      parent,
      "--nopasscode",
    ], { TMPDIR: head });
    assertEquals(result.code, 1);
    assertEquals(result.stdout.includes("temporary"), false);
    assertEquals(await Deno.readTextFile(parent), "retain me");
    assertEquals([...Deno.readDirSync(head)].map((entry) => entry.name), ["not-a-directory"]);
  } finally {
    await Deno.remove(head, { recursive: true });
  }
});

Deno.test("init credentials - propagate persistent PathError without creating a temporary store", async () => {
  const headDirPath = await Deno.makeTempDir();
  const original = PathManager.prototype.reopen;
  const previous = Deno.env.get("TMPDIR");
  const failure = new PathError("Persistent location is unavailable");
  Deno.env.set("TMPDIR", headDirPath);
  PathManager.prototype.reopen = function*(options = {}) {
    if (!this.temp && !options.temp) throw failure;
    return yield* original.call(this, options);
  };
  try {
    const error = await assertRejects(() =>
      run(() =>
        initCommand({
          name: "no-temporary-fallback",
          headDirPath,
          nopasscode: true,
        })
      ), PathError);
    assertStrictEquals(error, failure);
    assertEquals([...Deno.readDirSync(headDirPath)], []);
  } finally {
    PathManager.prototype.reopen = original;
    if (previous === undefined) Deno.env.delete("TMPDIR");
    else Deno.env.set("TMPDIR", previous);
    await Deno.remove(headDirPath, { recursive: true });
  }
});
