/**
 * Ensure keri-ts resolves cesr-ts from the latest patch in the current minor line.
 *
 * Policy:
 * - Read packages/cesr/package.json version (X.Y.Z)
 * - Require keri deno import maps to use "npm:cesr-ts@^X.Y.0"
 *
 * Usage:
 *   deno run -A scripts/check_cesr_dependency_policy.ts
 */

interface PackageManifest {
  version?: string;
}

interface DenoManifest {
  imports?: Record<string, string>;
}

interface Target {
  name: string;
  path: URL;
}

const CESR_PACKAGE_PATH = new URL(
  "../packages/cesr/package.json",
  import.meta.url,
);
const TARGETS: Target[] = [
  { name: "root", path: new URL("../deno.json", import.meta.url) },
  {
    name: "packages/keri",
    path: new URL("../packages/keri/deno.json", import.meta.url),
  },
];

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

async function readCesrVersion(): Promise<string> {
  const raw = await Deno.readTextFile(CESR_PACKAGE_PATH);
  const manifest = JSON.parse(raw) as PackageManifest;
  const version = manifest.version?.trim();
  if (!version) {
    throw new Error(`Missing version in ${CESR_PACKAGE_PATH.pathname}`);
  }
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(
      `Invalid semver in ${CESR_PACKAGE_PATH.pathname}: ${version}`,
    );
  }
  return version;
}

function expectedImportSpecifier(cesrVersion: string): string {
  const match = cesrVersion.match(/^(\d+)\.(\d+)\./);
  if (!match) {
    throw new Error(`Unsupported cesr-ts version format: ${cesrVersion}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `npm:cesr-ts@^${major}.${minor}.0`;
}

async function checkTarget(target: Target, expected: string): Promise<void> {
  const raw = await Deno.readTextFile(target.path);
  const manifest = JSON.parse(raw) as DenoManifest;
  const actual = manifest.imports?.["cesr-ts"];
  if (actual === expected) {
    return;
  }

  throw new Error(
    `${target.name}: expected imports["cesr-ts"] to be "${expected}" in ` +
      `${target.path.pathname}, found "${actual ?? "<missing>"}"`,
  );
}

async function main() {
  if (Deno.args.length > 0) {
    throw new Error(`Unknown argument(s): ${Deno.args.join(" ")}`);
  }

  const cesrVersion = await readCesrVersion();
  const expected = expectedImportSpecifier(cesrVersion);

  for (const target of TARGETS) {
    await checkTarget(target, expected);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`cesr dependency policy check failed: ${message}`);
    Deno.exit(1);
  }
}
