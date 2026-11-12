/**
 * Shared helpers for DNT-based npm package builds.
 *
 * These utilities keep the keri-ts, cesr-ts, and tufa npm build scripts focused
 * on package-specific entrypoints while centralizing the release-sensitive
 * filesystem and manifest operations.
 */
import { dirname, resolve } from "node:path";

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
 * Find exactly one generated entrypoint by filename and stable source text.
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

/** DNT-generated side-effect imports that pull Node-only code into an entrypoint. */
const DNT_ENTRY_IMPORT = /^import "[^"]*_dnt\.(?:polyfills|shims)\.js";\r?\n/gm;

/**
 * Emit a polyfill-free sibling of a generated entrypoint for the `browser`
 * export condition and return its package-relative path.
 *
 * DNT prepends `import "../_dnt.polyfills.js"` to every entrypoint, and that
 * module loads `node:module`, `node:url` and `node:path`. The polyfills only
 * serve `import.meta.dirname`/`filename`/`main`/`resolve`, which no browser-safe
 * module reads, so the wrapper is the entrypoint minus that import. Everything
 * else is shared with the `import` target, so the original file is untouched.
 */
export function emitBrowserEntrypoint(outDir: string, importTarget: string): string {
  const relative = importTarget.replace(/^\.\//, "");
  if (!relative.endsWith(".js")) {
    throw new Error(`Expected a .js entrypoint to derive a browser target from: ${importTarget}`);
  }
  const browserRelative = `${relative.slice(0, -".js".length)}.browser.js`;
  const source = Deno.readTextFileSync(`${outDir}/${relative}`);
  Deno.writeTextFileSync(`${outDir}/${browserRelative}`, source.replace(DNT_ENTRY_IMPORT, ""));
  return `./${browserRelative}`;
}

/** Module specifiers that must never be reachable from a `browser` target. */
const BROWSER_FORBIDDEN_SPECIFIER = /^(?:node:|npm:|@deno\/shim-deno(?:\/|$)|lmdb(?:\/|$))|_dnt\.|deno-shim/;

/** Static and dynamic import/export specifiers in DNT's plain ES output. */
const MODULE_SPECIFIER = /(?:import|export)\s*(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Assert that nothing reachable from the given `browser` targets imports a
 * Node-only module, DNT's polyfills/shims, the Deno shim or LMDB.
 *
 * This walks emitted files the same way a bundler would: relative specifiers are
 * followed, bare specifiers are checked and left to the dependency's own
 * `browser` handling.
 */
export function assertBrowserGraphClean(outDir: string, browserTargets: string[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  const pending = browserTargets.map((target) => resolve(outDir, target));
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const match of Deno.readTextFileSync(path).matchAll(MODULE_SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (BROWSER_FORBIDDEN_SPECIFIER.test(specifier)) {
        problems.push(`${path} imports ${specifier}`);
      } else if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(path), specifier));
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Browser export targets reach Node-only modules:\n  ${problems.join("\n  ")}`);
  }
}
