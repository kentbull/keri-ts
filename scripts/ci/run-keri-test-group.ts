#!/usr/bin/env -S deno run -A
/** Execute explicit KERI file suites with bounded parallelism and durable timing evidence. */
import { dirname } from "jsr:@std/path/dirname";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { join } from "jsr:@std/path/join";
import { groups, suites, type TestSuite } from "./keri-test-suites.ts";
import reference from "./keripy-reference.json" with { type: "json" };

/** Package root for child processes and file ownership discovery. */
const packageDir = new URL("../../packages/keri/", import.meta.url);
/** Repository root keeps local and CI artifact paths consistent. */
const repoDir = new URL("../../", import.meta.url);

/** One actual child command, including failure status and wall-clock duration. */
interface CommandTiming {
  /** Concrete owner suite, before group expansion. */
  suite: string;
  /** Exact Deno arguments, preserving the selected files. */
  args: string[];
  /** ISO wall-clock start for correlating raw logs. */
  startedAt: string;
  /** Monotonic child-process elapsed time. */
  durationMs: number;
  /** Child exit code; failed commands are retained. */
  exitCode: number;
}

/** Find all maintained test files; ownership does not depend on source comments. */
async function testFiles(dir: URL, prefix = "test"): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...await testFiles(new URL(`${entry.name}/`, dir), path));
    } else if (entry.isFile && entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

/** Reject orphaned, duplicated or stale file entries before selecting any suite. */
async function audit(): Promise<number> {
  const found = new Set(await testFiles(new URL("test/", packageDir)));
  const owners = new Map<string, string>();
  for (const [name, suite] of Object.entries(suites)) {
    if (suite.files.length === 0) throw new Error(`Empty test suite: ${name}`);
    for (const file of suite.files) {
      if (!found.has(file)) throw new Error(`Missing test file in ${name}: ${file}`);
      if (owners.has(file)) throw new Error(`Duplicate test ownership: ${file} in ${owners.get(file)} and ${name}`);
      owners.set(file, name);
    }
  }
  const orphaned = [...found].filter((file) => !owners.has(file));
  if (orphaned.length) throw new Error(`Unowned test files:\n${orphaned.join("\n")}`);
  for (const [name, members] of Object.entries(groups)) {
    if (members.length !== new Set(members).size) throw new Error(`Duplicate suite in ${name}`);
    for (const member of members) if (!suites[member]) throw new Error(`Unknown suite ${member} in ${name}`);
  }
  return found.size;
}

/** Resolve a concrete owner or named group without silently deduplicating mistakes. */
function selection(target: string): readonly string[] {
  if (suites[target]) return [target];
  if (groups[target]) return groups[target];
  throw new Error(
    `Unknown test target ${target}. Choose audit, ${Object.keys(groups).join(", ")}, or ${
      Object.keys(suites).join(", ")
    }.`,
  );
}

/** Cap caller-requested concurrency at the suite's measured isolation policy. */
function jobs(suite: TestSuite): number {
  const value = Deno.env.get("KERI_TEST_JOBS") || Deno.env.get("DENO_JOBS");
  const requested = value ? Number(value) : navigator.hardwareConcurrency;
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error("Test worker count must be a positive integer.");
  }
  return Math.min(requested, suite.jobs ?? 1);
}

/** Execute a suite; isolated files remain separate processes while safe files share a bounded pool. */
async function runSuite(name: string, timings: CommandTiming[]): Promise<void> {
  const suite = suites[name];
  const env = { ...suite.env };
  // Native protocol and storage owners use main; legacy/mailbox owners retain their selected peer.
  const mainRoot = Deno.env.get("KERIPY_MAIN_ROOT");
  if (["interop-essr-storage", "interop-ipex-disclosure", "interop-tel-backers"].includes(name) && mainRoot) {
    const python = Deno.env.get("KERIPY_MAIN_PYTHON");
    if (!python) throw new Error("Main peer requires KERIPY_MAIN_PYTHON.");
    Object.assign(env, {
      KERIPY_INTEROP_PROFILE: "main",
      KERIPY_INTEROP_ROOT: mainRoot,
      KERIPY_INTEROP_PYTHON: python,
      KERIPY_INTEROP_EXPECTED_COMMIT: reference.profiles.main.commit,
    });
  }
  const batches = suite.jobs ? [suite.files] : suite.files.map((file) => [file]);
  for (const files of batches) {
    const args = ["test", "--allow-all", "--unstable-ffi", ...(suite.jobs ? ["--parallel"] : []), ...files];
    console.log(`==> ${name}: ${files.length} files, ${jobs(suite)} worker(s)`);
    const start = performance.now();
    const startedAt = new Date().toISOString();
    const child = new Deno.Command(Deno.execPath(), {
      args,
      cwd: packageDir,
      env: { DENO_JOBS: String(jobs(suite)), ...env },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const status = await child.status;
    const durationMs = Math.round(performance.now() - start);
    timings.push({ suite: name, args, startedAt, durationMs, exitCode: status.code });
    console.log(`==> ${name}: exit ${status.code}, ${(durationMs / 1000).toFixed(1)}s`);
    // Finish independent files/suites so a full run reports all maintained failures.
  }
}

/** Resolve the artifact path for local and hosted runs, on success as well as failure. */
function timingPath(target: string): string {
  const explicit = Deno.env.get("KERI_TEST_TIMINGS_JSON");
  if (explicit) return explicit;
  const directory = Deno.env.get("KERI_TEST_TIMINGS_DIR") || fromFileUrl(new URL(".test-timings/", repoDir));
  const job = Deno.env.get("GITHUB_JOB") || "local";
  return join(directory, `${job}-${target}.json`);
}

/** Record immutable source identity and expose every tracked or untracked local modification. */
async function sourceState(): Promise<{ head: string; dirty: string }> {
  const [head, status] = await Promise.all([
    new Deno.Command("git", { args: ["rev-parse", "HEAD"], cwd: repoDir, stdout: "piped", stderr: "piped" }).output(),
    new Deno.Command("git", { args: ["status", "--porcelain"], cwd: repoDir, stdout: "piped", stderr: "piped" })
      .output(),
  ]);
  if (!head.success || !status.success) throw new Error("Cannot determine test source Git provenance.");
  return {
    head: new TextDecoder().decode(head.stdout).trim(),
    dirty: new TextDecoder().decode(status.stdout).trim(),
  };
}

/** Observe the native loader and written data format without rebuilding dependencies. */
async function lmdbRuntime(): Promise<unknown> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", fromFileUrl(new URL("./report-lmdb-runtime.ts", import.meta.url))],
    cwd: packageDir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = new TextDecoder().decode(result.stdout);
  if (!result.success) {
    throw new Error(`LMDB setup probe failed: ${output}\n${new TextDecoder().decode(result.stderr)}`);
  }
  const provenance: unknown = JSON.parse(output);
  console.log(`LMDB runtime: ${JSON.stringify(provenance)}`);
  return provenance;
}

/** Audit ownership, optionally print selected files, then retain every executed command's result. */
async function main(): Promise<void> {
  const target = Deno.args[0];
  if (!target) throw new Error("Usage: run-keri-test-group.ts <suite|group|audit> [--list]");
  const files = await audit();
  console.log(`==> Ownership audit passed: ${files} test files`);
  if (target === "audit") return;
  const selected = selection(target);
  if (Deno.args[1] === "--list") {
    console.log(JSON.stringify(selected.map((name) => ({ name, ...suites[name] })), null, 2));
    return;
  }
  const source = await sourceState();
  if (target === "qualification" && source.dirty) {
    throw new Error("Qualification requires a clean committed source tree; commit or isolate pending work first.");
  }
  const lmdb = await lmdbRuntime();
  const timings: CommandTiming[] = [];
  const started = performance.now();
  try {
    for (const name of selected) await runSuite(name, timings);
  } finally {
    const path = timingPath(target);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(
      path,
      `${
        JSON.stringify(
          {
            target,
            generatedAt: new Date().toISOString(),
            source,
            deno: Deno.version,
            lmdb,
            discoveredFiles: files,
            wallTimeMs: Math.round(performance.now() - started),
            totalChildTimeMs: timings.reduce((sum, item) => sum + item.durationMs, 0),
            commands: timings,
          },
          null,
          2,
        )
      }\n`,
    );
    console.log(`==> Timings: ${path}`);
  }
  if (timings.some((item) => item.exitCode !== 0)) Deno.exit(1);
}

if (import.meta.main) await main();
