import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { cacheKey, type Files, type KeyInputs, lmdbHelperDir, readFiles } from "./deps-cache-key.ts";

/** The repository's own manifests, locks and LMDB build scripts, read from the checkout under test. */
const repo: Files = await readFiles();

function inputs(files: Files): KeyInputs {
  return {
    files,
    denoVersion: "2.9.8",
    nodeVersion: "25.9.0",
    lmdbDataV1: true,
    os: "Linux",
    arch: "X64",
    platform: "ubuntu26\ng++ 15",
  };
}

const key = async (files: Files) => (await cacheKey(inputs(files))).key;

/** Apply `edit` to the parsed JSON file at `path`. */
function editJson(files: Files, path: string, edit: (json: Record<string, unknown>) => void): Files {
  const json = JSON.parse(files[path]!);
  edit(json);
  return { ...files, [path]: JSON.stringify(json, null, 2) + "\n" };
}

/** What `release:version` does to a release: every workspace version and internal pin moves to `next`. */
function versionPackages(files: Files, next: string): Files {
  const root = JSON.parse(files["package.json"]!) as { workspaces: string[] };
  const names = new Set<string>();
  for (const dir of root.workspaces) names.add(JSON.parse(files[`${dir}/package.json`]!).name);
  const bumpPins = (deps: Record<string, string> | undefined) => {
    for (const name of Object.keys(deps ?? {})) if (names.has(name)) deps![name] = next;
  };
  let out = editJson(files, "package.json", (json) => json.version = next);
  out = editJson(out, "deno.json", (json) => json.version = next);
  for (const dir of root.workspaces) {
    out = editJson(out, `${dir}/package.json`, (json) => {
      json.version = next;
      bumpPins(json.dependencies as Record<string, string>);
    });
    if (out[`${dir}/deno.json`]) out = editJson(out, `${dir}/deno.json`, (json) => json.version = next);
  }
  out = editJson(out, "package-lock.json", (json) => {
    json.version = next;
    const packages = json.packages as Record<string, { version?: string; dependencies?: Record<string, string> }>;
    for (const path of ["", ...root.workspaces]) {
      packages[path].version = next;
      bumpPins(packages[path].dependencies);
    }
  });
  // deno.lock records internal pins as `npm:<name>@<version>` in its workspace section.
  let lock = out["deno.lock"]!;
  for (const name of names) {
    lock = lock.replace(new RegExp(`"npm:${name.replace("/", "\\/")}@[^"]+"`, "g"), `"npm:${name}@${next}"`);
  }
  return { ...out, "deno.lock": lock };
}

Deno.test("a Version Packages commit leaves the key unchanged", async () => {
  const bumped = versionPackages(repo, "9.9.9");
  assertNotEquals(bumped["deno.lock"], repo["deno.lock"]);
  assertNotEquals(bumped["packages/keri/package.json"], repo["packages/keri/package.json"]);
  assertEquals(await key(bumped), await key(repo));
});

Deno.test("tasks, exports and workspace source imports are not dependencies", async () => {
  const edited = editJson(repo, "packages/keri/deno.json", (json) => {
    (json.tasks as Record<string, string>)["extra"] = "echo source only";
    (json.imports as Record<string, string>)["cesr-ts"] = "../cesr/other.ts";
  });
  assertEquals(await key(edited), await key(repo));
});

Deno.test("a dependency change alters the key", async () => {
  const added = editJson(repo, "packages/hosting/package.json", (json) => {
    json.dependencies = { ...(json.dependencies as Record<string, string>), "left-pad": "1.3.0" };
  });
  assertNotEquals(await key(added), await key(repo));
  const relocked = {
    ...repo,
    "deno.lock": repo["deno.lock"]!.replace("\"npm:effection@3.6.1\"", "\"npm:effection@3.6.2\""),
  };
  assertNotEquals(relocked["deno.lock"], repo["deno.lock"]);
  assertNotEquals(await key(relocked), await key(repo));
  const lmdbPin = editJson(repo, "package.json", (json) => {
    (json.dependencies as Record<string, string>).lmdb = "git+https://github.com/kentbull/lmdb-js.git#0000000";
  });
  assertNotEquals(await key(lmdbPin), await key(repo));
  const imported = editJson(repo, "deno.json", (json) => {
    (json.imports as Record<string, string>)["effection"] = "npm:effection@^4.0.0";
  });
  assertNotEquals(await key(imported), await key(repo));
});

Deno.test("the LMDB build scripts, runtimes, flag and platform are part of the key", async () => {
  const base = await key(repo);
  const setup = "packages/keri/scripts/setup_lmdb_v1.sh";
  assertNotEquals(await key({ ...repo, [setup]: repo[setup] + "\n# changed\n" }), base);
  const helper = Object.keys(repo).find((path) => path.startsWith(`${lmdbHelperDir}/`))!;
  assertNotEquals(await key({ ...repo, [helper]: repo[helper] + "\n// changed\n" }), base);
  const gate = "scripts/ci/report-lmdb-runtime.ts";
  assertNotEquals(await key({ ...repo, [gate]: repo[gate] + "\n// changed\n" }), base);
  for (
    const change of [
      { denoVersion: "2.9.9" },
      { nodeVersion: "25.9.1" },
      { lmdbDataV1: false },
      { arch: "ARM64" },
      { platform: "ubuntu26\ng++ 16" },
    ]
  ) {
    assertNotEquals((await cacheKey({ ...inputs(repo), ...change })).key, base, JSON.stringify(change));
  }
});

Deno.test("the restore prefix keeps platform and runtimes and drops only the dependency digest", async () => {
  const { key: exact, restorePrefix } = await cacheKey(inputs(repo));
  assertEquals(exact.startsWith(restorePrefix), true);
  assertEquals(/^[0-9a-f]{32}$/.test(exact.slice(restorePrefix.length)), true);
  assertEquals(restorePrefix.includes("-deno-2.9.8-node-25.9.0-lmdb-data-v1-"), true);
});
