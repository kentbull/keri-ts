/** Exact KERIpy runtime selection shared by every CLI and Python interop subprocess. */
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { join } from "jsr:@std/path/join";

/** Independently observed interpreter and source identity, persisted with qualification logs. */
export interface KeripyProvenance {
  /** Source commit verified by Git or installed distribution provenance. */
  commit: string;
  /** Explicit editable checkout, or null for the historical pinned installation. */
  root: string | null;
  /** Actual imported package location, not distribution version metadata. */
  module: string;
  /** Interpreter used for both CLI and auxiliary Python subprocesses. */
  python: string;
  /** Complete interpreter version/build description. */
  pythonVersion: string;
  /** Verified CLI module for this source revision. */
  cliModule: string;
  /** Source imports checked against Git bytes, or installed hashes recorded without that claim. */
  importVerification: "git-bytes" | "installed-record";
  /** Startup imports only; actual commands must qualify their additional lazy imports. */
  loadedModules: Record<string, { path: string; sha256: string }>;
  /** Runtime dependency versions; a missing distribution is recorded as null. */
  dependencies: Record<string, string | null>;
}

/** Selected command plus the Python interpreter that must accompany it. */
export interface KeripyRuntime {
  /** Test-owned CLI launcher using the verified interpreter and module. */
  kliCommand: string;
  /** Actual Python path for verifier/alignment helper subprocesses. */
  pythonCommand: string;
  /** Provenance written to the test home and optional artifact directory. */
  provenance: KeripyProvenance;
}

/** Keep Python executable code in a source file, not generated shell text. */
const PROBE = fromFileUrl(new URL("../../../../../scripts/ci/probe-keripy.py", import.meta.url));

/** Preserve the installed console entry point's exit status with the verified interpreter. */
const CLI = fromFileUrl(new URL("../../../../../scripts/ci/run-keripy-cli.py", import.meta.url));

/** Quote a literal executable/module argument for the tiny POSIX CLI launcher. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Validate the selected import before emitting a CLI wrapper or starting test state. */
export async function verifyKeripy(
  workDir: string,
  env: Record<string, string>,
  pinned: { python: string; commit: string },
): Promise<KeripyRuntime> {
  const root = env.KERIPY_INTEROP_ROOT?.trim();
  const expected = root ? env.KERIPY_INTEROP_EXPECTED_COMMIT?.trim() : pinned.commit;
  if (!expected || !/^[0-9a-f]{40}$/.test(expected)) {
    throw new Error("KERIPY_INTEROP_ROOT requires a full KERIPY_INTEROP_EXPECTED_COMMIT SHA.");
  }
  if (!root && env.KERIPY_INTEROP_EXPECTED_COMMIT) {
    throw new Error("KERIPY_INTEROP_EXPECTED_COMMIT requires KERIPY_INTEROP_ROOT.");
  }
  const python = root ? env.KERIPY_INTEROP_PYTHON?.trim() || join(root, "venv/bin/python") : pinned.python;
  const result = await new Deno.Command(python, {
    args: [PROBE, "--expected-commit", expected, ...(root ? ["--root", root] : [])],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(`KERIpy provenance check failed:\n${new TextDecoder().decode(result.stderr)}`);
  }
  const provenance = JSON.parse(new TextDecoder().decode(result.stdout)) as KeripyProvenance;
  const json = `${JSON.stringify(provenance, null, 2)}\n`;
  await Deno.writeTextFile(join(workDir, "keripy-runtime.json"), json);
  const artifacts = env.KERIPY_INTEROP_PROVENANCE_DIR || env.KERI_TEST_TIMINGS_DIR;
  if (artifacts) {
    await Deno.mkdir(artifacts, { recursive: true });
    await Deno.writeTextFile(join(artifacts, `keripy-${expected}-${crypto.randomUUID()}.json`), json);
  }
  console.log(`KERIpy runtime: ${JSON.stringify(provenance)}`);
  const kliCommand = join(workDir, "verified-kli");
  await Deno.writeTextFile(
    kliCommand,
    `#!/bin/sh\nexec ${shellQuote(provenance.python)} ${shellQuote(CLI)} ${shellQuote(provenance.cliModule)} "$@"\n`,
  );
  await Deno.chmod(kliCommand, 0o755);
  return { kliCommand, pythonCommand: provenance.python, provenance };
}

/** Record the resolver's own KERIpy dependencies without labeling them as the selected CLI revision. */
export async function recordResolverRuntime(
  root: string,
  resolverCommit: string,
  python: string,
  env: Record<string, string>,
): Promise<void> {
  const result = await new Deno.Command(python, {
    args: [PROBE, "--resolver-root", root, "--resolver-commit", resolverCommit],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(`DID Webs runtime probe failed: ${new TextDecoder().decode(result.stderr)}`);
  const embedded = JSON.parse(new TextDecoder().decode(result.stdout));
  const evidence = { resolverRoot: root, resolverCommit, embeddedKeripy: embedded };
  console.log(`DID Webs runtime (separate from CLI): ${JSON.stringify(evidence)}`);
  const artifacts = env.KERIPY_INTEROP_PROVENANCE_DIR || env.KERI_TEST_TIMINGS_DIR;
  if (artifacts) {
    await Deno.mkdir(artifacts, { recursive: true });
    await Deno.writeTextFile(
      join(artifacts, `did-webs-${resolverCommit}-${crypto.randomUUID()}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }
}
