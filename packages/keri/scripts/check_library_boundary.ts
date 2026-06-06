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

interface DenoInfoModule {
  specifier?: string;
}

interface DenoInfoOutput {
  modules?: DenoInfoModule[];
}

interface ExportTarget {
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
const EXPECTED_EXPORT_KEYS = [".", "./cli", "./runtime", "./db"];

interface SurfaceCheck {
  label: string;
  entrypoint: URL;
  forbidden: string[];
}

const SURFACES: SurfaceCheck[] = [
  {
    label: "keri-ts root surface",
    entrypoint: new URL("../mod.ts", import.meta.url),
    forbidden: [
      "/packages/tufa/",
      "/src/app/cli/",
      "npm:commander",
      "npm:/commander@",
      "npm:hono",
      "npm:/hono@",
      "node:",
    ],
  },
  {
    label: "keri-ts runtime surface",
    entrypoint: new URL("../runtime.ts", import.meta.url),
    forbidden: [
      "/packages/tufa/",
      "/src/app/cli/",
      "npm:commander",
      "npm:/commander@",
      "npm:hono",
      "npm:/hono@",
    ],
  },
  {
    label: "keri-ts db surface",
    entrypoint: new URL("../db.ts", import.meta.url),
    forbidden: [
      "/packages/tufa/",
      "/src/app/cli/",
      "npm:commander",
      "npm:/commander@",
      "npm:hono",
      "npm:/hono@",
    ],
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

/** Assert that a public source surface does not import forbidden app/runtime modules. */
async function assertSurfaceBoundary(
  { label, entrypoint, forbidden }: SurfaceCheck,
): Promise<void> {
  const info = await loadInfo(entrypoint);
  const specifiers = (info.modules ?? [])
    .map((module) => module.specifier)
    .filter((specifier): specifier is string => Boolean(specifier));

  const hits = specifiers.filter((specifier) => forbidden.some((pattern) => specifier.includes(pattern)));
  if (hits.length > 0) {
    const details = hits.sort().map((specifier) => `  - ${specifier}`).join(
      "\n",
    );
    throw new Error(`${label} reaches forbidden modules:\n${details}`);
  }
}

/**
 * Assert generated npm manifest exports match the public surface contract.
 *
 * The build script is responsible for discovering DNT output paths. This check
 * only verifies that the normalized manifest has the expected export keys, that
 * each import/types target exists, and that root `main`/`module`/`types` agree
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
  }

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
