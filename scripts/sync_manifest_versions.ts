/**
 * Sync deno.json version fields from package manifest versions.
 *
 * Usage:
 *   deno run -A scripts/sync_manifest_versions.ts
 *   deno run -A scripts/sync_manifest_versions.ts --check
 */

interface PackageManifest {
  version?: string;
}

interface DenoManifest {
  version?: string;
}

interface SyncTarget {
  name: "keri" | "cesr";
  packagePath: URL;
  denoPath: URL;
}

const TARGETS: SyncTarget[] = [
  {
    name: "keri",
    packagePath: new URL("../packages/keri/package.json", import.meta.url),
    denoPath: new URL("../packages/keri/deno.json", import.meta.url),
  },
  {
    name: "cesr",
    packagePath: new URL("../packages/cesr/package.json", import.meta.url),
    denoPath: new URL("../packages/cesr/deno.json", import.meta.url),
  },
];

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseArgs(args: string[]): { check: boolean } {
  if (args.length === 0) {
    return { check: false };
  }

  if (args.length === 1 && args[0] === "--check") {
    return { check: true };
  }

  throw new Error(`Unknown argument(s): ${args.join(" ")}`);
}

async function readPackageVersion(path: URL): Promise<string> {
  const raw = await Deno.readTextFile(path);
  const manifest = JSON.parse(raw) as PackageManifest;
  const version = manifest.version?.trim();
  if (!version) {
    throw new Error(`Missing version in ${path.pathname}`);
  }
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(`Invalid semver in ${path.pathname}: ${version}`);
  }
  return version;
}

async function syncTarget(target: SyncTarget, check: boolean): Promise<void> {
  const packageVersion = await readPackageVersion(target.packagePath);
  const raw = await Deno.readTextFile(target.denoPath);
  const denoManifest = JSON.parse(raw) as DenoManifest;
  const currentVersion = denoManifest.version?.trim();

  if (currentVersion === packageVersion) {
    return;
  }

  if (check) {
    throw new Error(
      `${target.name}: version mismatch (${target.denoPath.pathname}=${
        currentVersion ?? "<missing>"
      }, ${target.packagePath.pathname}=${packageVersion})`,
    );
  }

  denoManifest.version = packageVersion;
  const formatted = `${JSON.stringify(denoManifest, null, 2)}\n`;
  await Deno.writeTextFile(target.denoPath, formatted);
}

async function main() {
  const { check } = parseArgs(Deno.args);
  for (const target of TARGETS) {
    await syncTarget(target, check);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`manifest version sync failed: ${message}`);
    Deno.exit(1);
  }
}
