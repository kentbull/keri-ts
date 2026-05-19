#!/usr/bin/env -S deno run -A

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
  exports?: Record<string, ExportTarget>;
}

const PACKAGE_DIR = new URL("../", import.meta.url);
const NPM_MANIFEST_PATH = new URL("../npm/package.json", import.meta.url);

const EXPECTED_EXPORTS: Record<string, ExportTarget> = {
  ".": {
    import: "./esm/keri/src/npm/index.js",
    types: "./types/keri/src/npm/index.d.ts",
  },
  "./runtime": {
    import: "./esm/keri/src/npm/runtime.js",
    types: "./types/keri/src/npm/runtime.d.ts",
  },
  "./db": {
    import: "./esm/keri/src/npm/db.js",
    types: "./types/keri/src/npm/db.d.ts",
  },
};

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

async function assertSurfaceBoundary(
  { label, entrypoint, forbidden }: SurfaceCheck,
): Promise<void> {
  const info = await loadInfo(entrypoint);
  const specifiers = (info.modules ?? [])
    .map((module) => module.specifier)
    .filter((specifier): specifier is string => Boolean(specifier));

  const hits = specifiers.filter((specifier) => forbidden.some((pattern) => specifier.includes(pattern)));
  if (hits.length > 0) {
    const details = hits.sort().map((specifier) => `  - ${specifier}`).join("\n");
    throw new Error(`${label} reaches forbidden modules:\n${details}`);
  }
}

function assertManifestExports(): void {
  const raw = Deno.readTextFileSync(NPM_MANIFEST_PATH);
  const manifest = JSON.parse(raw) as NpmManifest;
  const exportsField = manifest.exports ?? {};
  const exportKeys = Object.keys(exportsField).sort();
  const expectedKeys = Object.keys(EXPECTED_EXPORTS).sort();

  if (JSON.stringify(exportKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `packages/keri/npm/package.json exports drifted.\nExpected: ${expectedKeys.join(", ")}\nActual: ${
        exportKeys.join(", ")
      }`,
    );
  }

  for (const [key, expected] of Object.entries(EXPECTED_EXPORTS)) {
    const actual = exportsField[key];
    if (!actual) {
      throw new Error(`Missing export ${key} in packages/keri/npm/package.json`);
    }
    if (actual.import !== expected.import || actual.types !== expected.types) {
      throw new Error(
        `Export ${key} drifted.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
      );
    }
  }

  const leakedInternalExports = exportKeys.filter((key) => key.includes("/src/npm/"));
  if (leakedInternalExports.length > 0) {
    throw new Error(
      `Internal src/npm exports leaked into the npm manifest: ${leakedInternalExports.join(", ")}`,
    );
  }
}

for (const surface of SURFACES) {
  await assertSurfaceBoundary(surface);
}

assertManifestExports();

console.log("keri-ts library boundary check passed");
