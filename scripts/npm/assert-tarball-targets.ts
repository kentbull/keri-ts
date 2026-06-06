/**
 * Assert that a packed npm tarball contains every target referenced by its
 * package manifest.
 *
 * Smoke scripts run this before Docker install so manifest/path drift fails at
 * the tarball boundary with an actionable error.
 */
import { packageTargetPaths } from "./package-targets.mjs";

/** Captured output from a `tar` invocation. */
interface TarOutput {
  stdout: string;
  stderr: string;
}

/** Parse the tarball path and optional bin-target assertion flag. */
function parseArgs(args: string[]): { tarballPath: string; includeBin: boolean } {
  const tarballPath = args.find((arg) => !arg.startsWith("--"));
  if (!tarballPath) {
    throw new Error("Usage: assert-tarball-targets.ts <tarball.tgz> [--include-bin]");
  }
  return {
    tarballPath,
    includeBin: args.includes("--include-bin"),
  };
}

/** Run `tar` and preserve stderr for package-boundary diagnostics. */
async function runTar(args: string[]): Promise<TarOutput> {
  const output = await new Deno.Command("tar", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout);
  const stderr = decoder.decode(output.stderr);
  if (output.code !== 0) {
    throw new Error(`tar ${args.join(" ")} failed:\n${stderr}`);
  }

  return { stdout, stderr };
}

/** Validate manifest targets against the tarball listing. */
async function main(): Promise<void> {
  const { tarballPath, includeBin } = parseArgs(Deno.args);
  const manifestOutput = await runTar(["-xOzf", tarballPath, "package/package.json"]);
  const manifest = JSON.parse(manifestOutput.stdout);
  const targets = packageTargetPaths(manifest, { includeBin }) as string[];
  if (targets.length === 0) {
    throw new Error(`No package ${includeBin ? "export/bin" : "export"} targets found in ${tarballPath}`);
  }

  const listingOutput = await runTar(["-tzf", tarballPath]);
  // Split tar output on either Unix LF or Windows CRLF line endings so the
  // assertion remains stable across tar implementations.
  const listing = new Set(listingOutput.stdout.split(/\r?\n/).filter(Boolean));
  const missing = targets.filter((target) => !listing.has(target));
  if (missing.length === 0) {
    return;
  }

  console.error(`Packed tarball is missing package target(s): ${missing.join(", ")}`);
  console.error("Package targets:");
  console.error(targets.join("\n"));
  console.error("Matching package contents:");
  console.error(
    // Limit diagnostics to files that can satisfy package manifest targets:
    // the manifest itself, ESM output, and declaration output.
    [...listing].filter((path) => /^package\/(package\.json|esm\/|types\/)/.test(path)).slice(0, 200).join("\n"),
  );
  Deno.exit(1);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
