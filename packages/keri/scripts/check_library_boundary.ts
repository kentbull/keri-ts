#!/usr/bin/env -S deno run -A

/**
 * Check that public `keri-ts` library surfaces stay narrow and npm exports stay
 * truthful after DNT normalization.
 *
 * Source boundary checks prevent app/CLI/server dependencies from leaking into
 * library imports. The npm manifest check verifies the generated package keeps
 * the intended export keys while allowing DNT-emitted file paths to be
 * discovered by the build script rather than hard-coded here.
 */

import { assertBrowserGraphClean } from "../../../scripts/npm/dnt-helpers.ts";

interface DenoInfoDependency {
  code?: { specifier?: string };
}

interface DenoInfoModule {
  specifier?: string;
  dependencies?: DenoInfoDependency[];
}

interface DenoInfoOutput {
  roots?: string[];
  redirects?: Record<string, string>;
  modules?: DenoInfoModule[];
}

interface ExportTarget {
  browser?: string;
  import: string;
  types: string;
}

interface NpmManifest {
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, ExportTarget>;
}

const PACKAGE_DIR = new URL("../", import.meta.url);
const NPM_MANIFEST_PATH = new URL("../npm/package.json", import.meta.url);

/** Public npm export keys that `packages/keri/scripts/build_npm.ts` normalizes. */
const EXPECTED_EXPORT_KEYS = [
  ".",
  "./cli",
  "./runtime",
  "./runtime/node",
  "./db",
  "./db/lmdb",
  "./db/indexeddb",
];

/**
 * Export keys whose source graph is gated above and that therefore ship a
 * polyfill-free `browser` target. The Node-only keys must not have one.
 */
const BROWSER_EXPORT_KEYS = [".", "./runtime", "./db", "./db/indexeddb"];

interface SurfaceCheck {
  label: string;
  entrypoint: URL;
  forbidden: string[];
  /** Forbid the `Deno.` global in reachable package sources. */
  forbidDenoGlobal?: boolean;
}

/** App and host-process dependencies that no library surface may load. */
const APP_FORBIDDEN = [
  "/packages/tufa/",
  "/src/cli/",
  "npm:commander",
  "npm:/commander@",
  "npm:hono",
  "npm:/hono@",
];

/** Host modules that only `keri-ts/runtime/node` may load. */
const HOST_FORBIDDEN = ["npm:lmdb", "npm:/lmdb@", "node:"];

const SURFACES: SurfaceCheck[] = [
  {
    label: "keri-ts root surface",
    entrypoint: new URL("../mod.ts", import.meta.url),
    forbidden: [...APP_FORBIDDEN, ...HOST_FORBIDDEN],
    forbidDenoGlobal: true,
  },
  {
    label: "keri-ts runtime surface",
    entrypoint: new URL("../runtime.ts", import.meta.url),
    forbidden: [...APP_FORBIDDEN, ...HOST_FORBIDDEN],
    forbidDenoGlobal: true,
  },
  {
    label: "keri-ts runtime/node surface",
    entrypoint: new URL("../runtime-node.ts", import.meta.url),
    forbidden: [...APP_FORBIDDEN, "npm:lmdb", "npm:/lmdb@"],
  },
  {
    label: "keri-ts db surface",
    entrypoint: new URL("../db.ts", import.meta.url),
    forbidden: [...APP_FORBIDDEN, ...HOST_FORBIDDEN],
    forbidDenoGlobal: true,
  },
  {
    label: "keri-ts db/indexeddb surface",
    entrypoint: new URL("../db-indexeddb.ts", import.meta.url),
    forbidden: [...APP_FORBIDDEN, ...HOST_FORBIDDEN],
    forbidDenoGlobal: true,
  },
];

/** Load Deno's module graph for one public source entrypoint. */
async function loadInfo(entrypoint: URL): Promise<DenoInfoOutput> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint.pathname],
    cwd: PACKAGE_DIR.pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (output.code !== 0) {
    throw new Error(
      `deno info failed for ${entrypoint.pathname}\n${new TextDecoder().decode(output.stderr)}`,
    );
  }

  return JSON.parse(new TextDecoder().decode(output.stdout)) as DenoInfoOutput;
}

/**
 * Walk only value imports. `import type` edges are erased at runtime and may
 * legitimately name backend types without loading the backend.
 */
function runtimeReach(info: DenoInfoOutput): string[] {
  const modules = new Map((info.modules ?? []).map((module) => [module.specifier, module]));
  const seen = new Set<string>();
  const pending = [...(info.roots ?? [])];
  while (pending.length > 0) {
    const raw = pending.pop()!;
    const specifier = info.redirects?.[raw] ?? raw;
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    for (const dependency of modules.get(specifier)?.dependencies ?? []) {
      if (dependency.code?.specifier) pending.push(dependency.code.specifier);
    }
  }
  return [...seen];
}

/** Assert that a public source surface does not import forbidden app/runtime modules. */
async function assertSurfaceBoundary(
  { label, entrypoint, forbidden, forbidDenoGlobal }: SurfaceCheck,
): Promise<void> {
  const info = await loadInfo(entrypoint);
  const specifiers = runtimeReach(info);

  const hits = specifiers.filter((specifier) => forbidden.some((pattern) => specifier.includes(pattern)));
  if (hits.length > 0) {
    const details = hits.sort().map((specifier) => `  - ${specifier}`).join(
      "\n",
    );
    throw new Error(`${label} reaches forbidden modules:\n${details}`);
  }

  if (forbidDenoGlobal) assertNoDenoGlobal(label, specifiers);
}

/**
 * Assert that reachable package sources do not touch the `Deno` global. A
 * browser bundle has no `Deno`, and the npm shim only papers over the gap in
 * the entrypoints that declare themselves host-only.
 */
function assertNoDenoGlobal(label: string, specifiers: string[]): void {
  const hits: string[] = [];
  for (const specifier of specifiers) {
    if (!specifier.startsWith("file://")) continue;
    const path = new URL(specifier).pathname;
    if (!path.startsWith(PACKAGE_DIR.pathname)) continue;
    if (/\bDeno\./.test(Deno.readTextFileSync(path))) hits.push(specifier);
  }
  if (hits.length > 0) {
    const details = hits.sort().map((specifier) => `  - ${specifier}`).join("\n");
    throw new Error(`${label} reaches sources using the Deno global:\n${details}`);
  }
}

/**
 * Assert generated npm manifest exports match the public surface contract.
 *
 * The build script is responsible for discovering DNT output paths. This check
 * only verifies that the normalized manifest has the expected export keys, that
 * each import/types target exists, browser-safe keys carry a `browser` target
 * (Node-only keys must not), the browser graph is Node-free, and that root `main`/`module`/`types` agree
 * with `exports["."]`.
 */
function assertManifestExports(): void {
  try {
    Deno.statSync(NPM_MANIFEST_PATH);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(
        "Skipping npm manifest export check because packages/keri/npm/package.json has not been generated.",
      );
      return;
    }
    throw error;
  }

  const raw = Deno.readTextFileSync(NPM_MANIFEST_PATH);
  const manifest = JSON.parse(raw) as NpmManifest;
  const exportsField = manifest.exports ?? {};
  const exportKeys = Object.keys(exportsField).sort();
  const expectedKeys = [...EXPECTED_EXPORT_KEYS].sort();

  if (JSON.stringify(exportKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `packages/keri/npm/package.json exports drifted.\nExpected: ${expectedKeys.join(", ")}\nActual: ${
        exportKeys.join(", ")
      }`,
    );
  }

  for (const key of EXPECTED_EXPORT_KEYS) {
    const actual = exportsField[key];
    if (!actual) {
      throw new Error(
        `Missing export ${key} in packages/keri/npm/package.json`,
      );
    }
    assertPackageTargetExists(actual.import, `export ${key}.import`);
    assertPackageTargetExists(actual.types, `export ${key}.types`);
    if (BROWSER_EXPORT_KEYS.includes(key)) {
      if (!actual.browser) {
        throw new Error(`Browser-safe export ${key} is missing its browser condition`);
      }
      assertPackageTargetExists(actual.browser, `export ${key}.browser`);
    } else if (actual.browser !== undefined) {
      throw new Error(`Node-only export ${key} must not declare a browser condition`);
    }
  }
  assertBrowserGraphClean(
    new URL("../npm/", import.meta.url).pathname,
    BROWSER_EXPORT_KEYS.map((key) => exportsField[key].browser!),
  );

  const rootExport = exportsField["."];
  if (
    manifest.main !== rootExport?.import
    || manifest.module !== rootExport?.import
    || manifest.types !== rootExport?.types
  ) {
    throw new Error(
      `packages/keri/npm/package.json root targets drifted.\nManifest: ${
        JSON.stringify({ main: manifest.main, module: manifest.module, types: manifest.types })
      }\nRoot export: ${JSON.stringify(rootExport)}`,
    );
  }

  const leakedInternalExports = exportKeys.filter((key) => key.includes("/src/npm/"));
  if (leakedInternalExports.length > 0) {
    throw new Error(
      `Internal src/npm exports leaked into the npm manifest: ${leakedInternalExports.join(", ")}`,
    );
  }
}

/** Assert one package-relative normalized manifest target exists on disk. */
function assertPackageTargetExists(target: string, label: string): void {
  if (!target.startsWith("./")) {
    throw new Error(`${label} must be a package-relative ./ path, got ${target}`);
  }
  if (target.includes("*")) {
    const [prefix, suffix] = target.slice(2).split("*");
    const slash = prefix.lastIndexOf("/");
    const directory = new URL(`../npm/${prefix.slice(0, slash + 1)}`, import.meta.url);
    const matches = [...Deno.readDirSync(directory)].some((entry) => entry.isFile && entry.name.endsWith(suffix));
    if (!matches) {
      throw new Error(`${label} pattern matches no package files: ${target}`);
    }
    return;
  }
  const path = new URL(`../npm/${target.slice(2)}`, import.meta.url);
  const stat = Deno.statSync(path);
  if (!stat.isFile) {
    throw new Error(`${label} points to a missing package file: ${target}`);
  }
}

for (const surface of SURFACES) {
  await assertSurfaceBoundary(surface);
}

assertManifestExports();

console.log("keri-ts library boundary check passed");
