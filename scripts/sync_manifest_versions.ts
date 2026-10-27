/**
 * Sync Deno and npm workspace-lock version mirrors from package manifests.
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

/** Npm owns all other fields; preserve them while updating workspace version mirrors. */
interface WorkspaceLock {
  packages: Record<string, PackageManifest>;
}

interface SyncTarget {
  name: "tufa" | "keri" | "cesr" | "verifier" | "hosting" | "wallet" | "registrar" | "observer";
  packagePath: URL;
  denoPath: URL;
}

const TARGETS: SyncTarget[] = [
  {
    name: "observer",
    packagePath: new URL("../packages/observer/package.json", import.meta.url),
    denoPath: new URL("../packages/observer/deno.json", import.meta.url),
  },
  {
    name: "registrar",
    packagePath: new URL("../packages/registrar/package.json", import.meta.url),
    denoPath: new URL("../packages/registrar/deno.json", import.meta.url),
  },
  {
    name: "wallet",
    packagePath: new URL("../packages/wallet/package.json", import.meta.url),
    denoPath: new URL("../packages/wallet/deno.json", import.meta.url),
  },
  {
    name: "hosting",
    packagePath: new URL("../packages/hosting/package.json", import.meta.url),
    denoPath: new URL("../packages/hosting/deno.json", import.meta.url),
  },
  {
    name: "verifier",
    packagePath: new URL("../packages/verifier/package.json", import.meta.url),
    denoPath: new URL("../packages/verifier/deno.json", import.meta.url),
  },
  {
    name: "tufa",
    packagePath: new URL("../packages/tufa/package.json", import.meta.url),
    denoPath: new URL("../packages/tufa/deno.json", import.meta.url),
  },
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

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

async function syncTarget(target: SyncTarget, packageVersion: string, check: boolean): Promise<void> {
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

/** Keep the checked-in npm workspace metadata aligned without resolving dependencies. */
async function syncWorkspaceLock(versions: ReadonlyMap<SyncTarget["name"], string>, check: boolean): Promise<void> {
  const path = new URL("../package-lock.json", import.meta.url);
  const lock = JSON.parse(await Deno.readTextFile(path)) as WorkspaceLock;
  let changed = false;
  for (const [name, version] of versions) {
    const key = `packages/${name}`;
    const entry = lock.packages[key];
    if (!entry) throw new Error(`Missing ${key} in package-lock.json`);
    if (entry.version === version) continue;
    if (check) throw new Error(`package-lock.json: ${key} version ${entry.version} does not match ${version}`);
    entry.version = version;
    changed = true;
  }
  if (changed) await Deno.writeTextFile(path, `${JSON.stringify(lock, null, 2)}\n`);
}

async function main() {
  const { check } = parseArgs(Deno.args);
  const versions = new Map<SyncTarget["name"], string>();
  for (const target of TARGETS) {
    const version = await readPackageVersion(target.packagePath);
    await syncTarget(target, version, check);
    versions.set(target.name, version);
  }
  await syncWorkspaceLock(versions, check);
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
