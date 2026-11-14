#!/usr/bin/env -S deno run --allow-read --allow-env --allow-write --allow-run=c++
/**
 * Compute the one dependency-cache key shared by Warm, the PR stage gate and the release workflows.
 *
 * The cache holds the Deno cache and `node_modules` with the LMDB-js addon already rebuilt for KERI
 * (`setup_lmdb_v1.sh`), so a job that restores an exact hit neither installs nor compiles anything. The key
 * therefore depends on exactly the inputs of that install and build:
 *
 *   - the dependency sections of every workspace `package.json` and the dependency settings of every
 *     `deno.json`, without `version` fields and without pins between workspace packages;
 *   - `deno.lock` and `package-lock.json` with the workspace packages' own versions and pins removed (the lmdb
 *     pin and the resolved lmdb versions are ordinary entries of these files and so stay in the key);
 *   - the LMDB build and its gate: `setup_lmdb_v1.sh`, `packages/keri/scripts/lmdb/*` and
 *     `scripts/ci/report-lmdb-runtime.ts`;
 *   - the Deno and Node versions, `LMDB_DATA_V1`, and the runner OS, architecture, image and C++ compiler.
 *
 * A Version Packages commit (versions and internal pins only) or a source-only commit leaves the key unchanged,
 * so the entry Warm saved on master is the one a release of the next tag restores. Bump `cachePrefix` to
 * retire every entry when the recipe itself changes meaning.
 *
 * Usage (from the checkout whose dependencies are installed, e.g. a release tag):
 *   DENO_VERSION=.. NODE_VERSION=.. LMDB_DATA_V1=.. deno run <permissions> deps-cache-key.ts
 * writes `key` and `restore-prefix` to `$GITHUB_OUTPUT` (or prints them).
 */

/** Prefix of every dependency-cache entry; one value for every workflow, so all of them share entries. */
export const cachePrefix = "deps-v7";

/** Raw file text by repository-relative path; null when the file does not exist in the checkout. */
export type Files = Record<string, string | null>;

/** Everything the key depends on, read from the checkout and the runner. */
export interface KeyInputs {
  files: Files;
  denoVersion: string;
  nodeVersion: string;
  lmdbDataV1: boolean;
  os: string;
  arch: string;
  /** Runner image identity and `c++ --version` output: a native addon is only valid for its toolchain. */
  platform: string;
}

/** The exact key and the prefix a partial restore may fall back to (same platform and runtimes). */
export interface CacheKey {
  key: string;
  restorePrefix: string;
}

/** Files that build or gate the LMDB addon; their bytes enter the key unchanged. */
export const lmdbBuildFiles = ["packages/keri/scripts/setup_lmdb_v1.sh", "scripts/ci/report-lmdb-runtime.ts"];
/** Directory of helper scripts `setup_lmdb_v1.sh` runs; every file in it enters the key. */
export const lmdbHelperDir = "packages/keri/scripts/lmdb";

const packageJsonSections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "overrides",
  "workspaces",
];
const denoJsonSections = ["imports", "scopes", "nodeModulesDir", "allowScripts", "workspace", "patch", "links"];
const dependencyMaps = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** Parsed JSON as the key reads it. */
type Json = null | boolean | number | string | Json[] | JsonObject;
/** A parsed JSON object. */
interface JsonObject {
  [key: string]: Json;
}

/** JSON with object keys sorted, so equal content always hashes equally. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parse(path: string, text: string | null): JsonObject | null {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

/** The workspace member directories the root package.json declares (npm `workspaces`). */
export function workspaceDirs(files: Files): string[] {
  const root = parse("package.json", files["package.json"]);
  const workspaces = root?.workspaces;
  return Array.isArray(workspaces) ? workspaces.filter((dir): dir is string => typeof dir === "string") : [];
}

/** npm names of the root and every workspace package: pins to these move with every version bump. */
export function internalNames(files: Files): Set<string> {
  const names = new Set<string>();
  for (const path of ["package.json", ...workspaceDirs(files).map((dir) => `${dir}/package.json`)]) {
    const name = parse(path, files[path] ?? null)?.name;
    if (typeof name === "string") names.add(name);
  }
  return names;
}

function pick(source: JsonObject | null, keys: string[]): JsonObject | null {
  if (!source) return null;
  const picked: JsonObject = {};
  for (const key of keys) if (key in source) picked[key] = source[key];
  return picked;
}

/** A dependency map without the workspace packages. */
function withoutInternal(map: Json, internal: Set<string>): Json {
  if (!map || typeof map !== "object" || Array.isArray(map)) return map;
  return Object.fromEntries(Object.entries(map).filter(([name]) => !internal.has(name)));
}

/** A package.json reduced to its dependency sections without internal pins. */
function packageJsonDeps(text: string | null, path: string, internal: Set<string>): Json {
  const picked = pick(parse(path, text), packageJsonSections);
  if (!picked) return null;
  for (const section of dependencyMaps) {
    if (section in picked) picked[section] = withoutInternal(picked[section], internal);
  }
  return picked;
}

/** A deno.json reduced to its dependency settings; relative imports are workspace source, not dependencies. */
function denoJsonDeps(text: string | null, path: string): Json {
  const picked = pick(parse(path, text), denoJsonSections);
  if (!picked) return null;
  const imports = picked.imports;
  if (imports && typeof imports === "object" && !Array.isArray(imports)) {
    picked.imports = Object.fromEntries(
      Object.entries(imports).filter(([, target]) => typeof target !== "string" || !target.startsWith(".")),
    );
  }
  return picked;
}

/** Whether a lockfile string or key names a workspace package at a version (`npm:keri-ts@2.2.5`, `keri-ts@2.2.5`). */
function internalSpecifier(text: string, internal: Set<string>): boolean {
  const bare = text.startsWith("npm:") ? text.slice(4) : text;
  const at = bare.lastIndexOf("@");
  return at > 0 && internal.has(bare.slice(0, at));
}

/** deno.lock without workspace-package specifiers anywhere (the workspace section pins them by version). */
function stripInternalSpecifiers(value: Json, internal: Set<string>): Json {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item !== "string" || !internalSpecifier(item, internal))
      .map((item) => stripInternalSpecifiers(item, internal));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !internalSpecifier(key, internal))
        .map(([key, item]) => [key, stripInternalSpecifiers(item, internal)]),
    );
  }
  return value;
}

/** package-lock.json without the root and workspace packages' versions and internal pins. */
function packageLockDeps(text: string | null, files: Files, internal: Set<string>): Json {
  const lock = parse("package-lock.json", text);
  if (!lock) return null;
  const { version: _version, ...rest } = lock;
  const own = new Set(["", ...workspaceDirs(files)]);
  const packages = rest.packages;
  if (packages && typeof packages === "object" && !Array.isArray(packages)) {
    rest.packages = Object.fromEntries(
      Object.entries(packages).map(([path, entry]) => {
        if (!own.has(path) || !entry || typeof entry !== "object" || Array.isArray(entry)) return [path, entry];
        const { version: _entryVersion, ...fields } = entry;
        for (const section of dependencyMaps) {
          if (section in fields) fields[section] = withoutInternal(fields[section], internal);
        }
        return [path, fields];
      }),
    );
  }
  return rest;
}

/** The canonical text of every dependency and LMDB-build input; its digest is the variable part of the key. */
export function dependencyInputs(files: Files): string {
  const internal = internalNames(files);
  const members = workspaceDirs(files);
  const manifests: JsonObject = {};
  for (const path of ["package.json", ...members.map((dir) => `${dir}/package.json`)]) {
    manifests[path] = packageJsonDeps(files[path] ?? null, path, internal);
  }
  for (const path of ["deno.json", ...members.map((dir) => `${dir}/deno.json`)]) {
    manifests[path] = denoJsonDeps(files[path] ?? null, path);
  }
  const lmdb: JsonObject = {};
  for (const [path, text] of Object.entries(files)) {
    if (lmdbBuildFiles.includes(path) || path.startsWith(`${lmdbHelperDir}/`)) lmdb[path] = text;
  }
  return canonical({
    manifests,
    denoLock: stripInternalSpecifiers(parse("deno.lock", files["deno.lock"] ?? null), internal),
    packageLock: packageLockDeps(files["package-lock.json"] ?? null, files, internal),
    lmdb,
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The cache key: readable runtime fields, then the platform and dependency digests. */
export async function cacheKey(inputs: KeyInputs): Promise<CacheKey> {
  const platform = (await sha256(inputs.platform)).slice(0, 16);
  const dependencies = (await sha256(dependencyInputs(inputs.files))).slice(0, 32);
  const lmdb = inputs.lmdbDataV1 ? "lmdb-data-v1" : "lmdb-default";
  const restorePrefix =
    `${cachePrefix}-${inputs.os}-${inputs.arch}-${platform}-deno-${inputs.denoVersion}-node-${inputs.nodeVersion}-${lmdb}-`;
  return { key: `${restorePrefix}${dependencies}`, restorePrefix };
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Read every key input from the checkout in the working directory. */
export async function readFiles(): Promise<Files> {
  const files: Files = {};
  for (const path of ["package.json", "deno.json", "deno.lock", "package-lock.json", ...lmdbBuildFiles]) {
    files[path] = await readOrNull(path);
  }
  for (const dir of workspaceDirs(files)) {
    for (const name of ["package.json", "deno.json"]) files[`${dir}/${name}`] = await readOrNull(`${dir}/${name}`);
  }
  try {
    for await (const entry of Deno.readDir(lmdbHelperDir)) {
      if (entry.isFile) {
        files[`${lmdbHelperDir}/${entry.name}`] = await Deno.readTextFile(`${lmdbHelperDir}/${entry.name}`);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return files;
}

/** `c++ --version`, or a marker when the runner has no C++ compiler. */
async function compiler(): Promise<string> {
  try {
    const out = await new Deno.Command("c++", { args: ["--version"], stdout: "piped", stderr: "null" }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : "c++ failed";
  } catch {
    return "no c++";
  }
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const { key, restorePrefix } = await cacheKey({
    files: await readFiles(),
    denoVersion: required("DENO_VERSION"),
    nodeVersion: required("NODE_VERSION"),
    lmdbDataV1: Deno.env.get("LMDB_DATA_V1") === "true",
    os: Deno.env.get("RUNNER_OS") ?? Deno.build.os,
    arch: Deno.env.get("RUNNER_ARCH") ?? Deno.build.arch,
    platform: `${Deno.env.get("ImageOS") ?? Deno.build.os}\n${await compiler()}`,
  });
  const lines = `key=${key}\nrestore-prefix=${restorePrefix}\n`;
  const output = Deno.env.get("GITHUB_OUTPUT");
  if (output) await Deno.writeTextFile(output, lines, { append: true });
  console.log(lines.trim());
}

if (import.meta.main) await main();
