/**
 * Shared helpers for DNT-based npm package builds.
 *
 * These utilities keep the keri-ts, cesr-ts, and tufa npm build scripts focused
 * on package-specific entrypoints while centralizing the release-sensitive
 * filesystem and manifest operations.
 */

/** Minimal package manifest shape needed by version-aware build scripts. */
export interface PackageManifest {
  version?: string;
}

/** Criteria used to rediscover a DNT-emitted entrypoint after path rewriting. */
export interface GeneratedEntrypointLookup {
  /** Directory tree to search, usually the generated npm output directory. */
  root: string;
  /** Package root prefix to strip when returning a package-relative path. */
  outDir: string;
  /** Generated filename to match, such as `mod.js` or `cli-node.js`. */
  fileName: string;
  /** Stable source marker that must survive DNT output rewriting. */
  marker: string;
}

/**
 * Read a package version from a manifest, optionally preferring an environment
 * override used by release builds.
 */
export function readPackageVersionSync(path: string, options: { envOverride?: string } = {}): string {
  if (options.envOverride) {
    const fromEnv = Deno.env.get(options.envOverride);
    if (fromEnv && fromEnv.trim()) {
      return fromEnv.trim();
    }
  }

  const raw = Deno.readTextFileSync(path);
  const pkg = JSON.parse(raw) as PackageManifest;
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error(`Missing version in ${path}`);
  }

  return version;
}

/** Write deterministic pretty JSON with a trailing newline. */
export function writeJsonFileSync(path: string, value: unknown): void {
  Deno.writeTextFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Write the narrow import map shape consumed by DNT build scripts. */
export function writeDntImportMapSync(path: string, imports: Record<string, string>): void {
  writeJsonFileSync(path, { imports });
}

/**
 * Default npm installs in generated build output to skip lifecycle scripts.
 *
 * Native dependency rebuilds are handled explicitly elsewhere; letting npm run
 * arbitrary package scripts during build generation would make release builds
 * less deterministic.
 */
export function setIgnoreScriptsDefault(): void {
  if (!Deno.env.has("NPM_CONFIG_IGNORE_SCRIPTS")) {
    Deno.env.set("NPM_CONFIG_IGNORE_SCRIPTS", "true");
  }
}

/** Recursively list regular files under a directory. */
export function listFilesSync(dir: string): string[] {
  const files: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...listFilesSync(path));
    } else if (entry.isFile) {
      files.push(path);
    }
  }
  return files;
}

/** Convert an absolute generated file path into a package-relative target. */
export function toPackagePath(path: string, outDir: string): string {
  return `./${path.replace(`${outDir}/`, "")}`;
}

/**
 * Find exactly one generated entrypoint by filename and marker comment.
 *
 * DNT-generated path segments can drift when source paths move. The marker keeps
 * package manifests tied to generated output facts instead of hard-coded paths.
 */
export function findGeneratedEntrypoint(
  { root, outDir, fileName, marker }: GeneratedEntrypointLookup,
): string {
  const matches = listFilesSync(root).filter((path) => {
    if (!path.endsWith(`/${fileName}`)) {
      return false;
    }
    return Deno.readTextFileSync(path).includes(marker);
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one generated ${fileName} containing ${
        JSON.stringify(marker)
      } under ${root}, found ${matches.length}: ${matches.join(", ")}`,
    );
  }

  return toPackagePath(matches[0], outDir);
}

/** Assert that a package-relative manifest target exists in the npm output. */
export function assertPackagePathExists(outDir: string, path: string): void {
  // Manifest targets are package-relative and usually begin with `./`; strip
  // only that leading marker before joining against the generated output dir.
  const relative = path.replace(/^\.\//, "");
  const fullPath = `${outDir}/${relative}`;
  const stat = Deno.statSync(fullPath);
  if (!stat.isFile) {
    throw new Error(`Expected npm package path to be a file: ${path}`);
  }
}

/** Remove a path when present while preserving all non-NotFound failures. */
export function removeIfExistsSync(path: string, options: { recursive?: boolean } = {}): void {
  try {
    Deno.removeSync(path, options);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/** Ensure a generated Node executable has a shebang and executable mode. */
export function prependShebangIfMissing(path: string): void {
  const current = Deno.readTextFileSync(path);
  if (!current.startsWith("#!/usr/bin/env node\n")) {
    Deno.writeTextFileSync(path, `#!/usr/bin/env node\n${current}`);
  }
  Deno.chmodSync(path, 0o755);
}
