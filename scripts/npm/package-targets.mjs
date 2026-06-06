/**
 * Shared manifest-target discovery for npm smoke tests.
 *
 * This file is plain ESM because it must run inside bare Node Docker images as
 * well as from Deno TypeScript helpers.
 */

/**
 * Collect raw package target strings from main/module/types/exports and,
 * optionally, bin entries.
 */
export function collectManifestTargets(manifest, options = {}) {
  const targets = [];
  const includeBin = Boolean(options.includeBin);

  collectTarget(manifest?.main, targets);
  collectTarget(manifest?.module, targets);
  collectTarget(manifest?.types, targets);
  if (includeBin) {
    collectTarget(manifest?.bin, targets);
  }
  for (const target of Object.values(manifest?.exports ?? {})) {
    collectTarget(target, targets);
  }

  return [...new Set(targets)];
}

/** Convert all manifest targets into tarball listing paths. */
export function packageTargetPaths(manifest, options = {}) {
  return collectManifestTargets(manifest, options)
    .map(packageTargetPath)
    .filter((target) => target !== null);
}

/** Convert one package manifest target into its `package/...` tarball path. */
export function packageTargetPath(target) {
  if (typeof target !== "string") {
    return null;
  }
  if (target.startsWith("./")) {
    return `package/${target.slice(2)}`;
  }
  // npm `bin` targets may be bare package-relative paths like `esm/cli.js`.
  // Absolute paths, parent-relative paths, and URLs are not package contents.
  if (!target.startsWith("/") && !target.startsWith("../") && !target.includes("://")) {
    return `package/${target}`;
  }
  return null;
}

/** Recursively collect target strings from conditional export objects. */
function collectTarget(target, targets) {
  if (typeof target === "string") {
    targets.push(target);
    return;
  }
  if (!target || typeof target !== "object") {
    return;
  }
  for (const value of Object.values(target)) {
    collectTarget(value, targets);
  }
}
