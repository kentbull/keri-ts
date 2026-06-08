#!/usr/bin/env -S deno run -A
/**
 * Run annotated KERI test lanes for CI and local stage-gate parity.
 *
 * Ownership model:
 * - test files declare membership with `@file-test-lane`
 * - individual `Deno.test` registrations may override with `@test-lane`
 * - this runner audits annotations first, then executes configured lanes or
 *   lane groups with the concurrency policy declared below
 */

import { dirname } from "jsr:@std/path/dirname";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { relative } from "jsr:@std/path/relative";

/** Execution policy for one lane of annotated KERI tests. */
interface LaneConfig {
  description: string;
  allowAll?: boolean;
  parallelFullFiles?: boolean;
  maxFilesPerRun?: number;
  maxJobs?: number;
}

/** Public alias that expands to one or more concrete lanes. */
interface GroupDefinition {
  description: string;
  lanes: string[];
}

/** One discovered `Deno.test` registration and its resolved lane. */
interface DiscoveredTest {
  name: string;
  lane: string;
}

/** Lane metadata discovered from a single test file. */
interface FileLaneDiscovery {
  fileLane: string;
  tests: DiscoveredTest[];
}

/** Files that can run whole vs tests that must be split by filter. */
interface LaneRunShape {
  fullFiles: string[];
  splitFiles: Array<{ file: string; tests: string[] }>;
}

/** One child `deno test` command timing for CI and local comparisons. */
interface TestCommandTiming {
  lane: string;
  label: string;
  args: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
}

interface TimingOutput {
  target: string;
  generatedAt: string;
  totalDurationMs: number;
  audit: AuditResult;
  commands: TestCommandTiming[];
}

class DenoTestFailure extends Error {
  readonly code: number;

  constructor(code: number, label: string) {
    super(`${label} failed with exit code ${code}.`);
    this.code = code;
  }
}

const packageDir = new URL("../../packages/keri/", import.meta.url);

const laneConfigs: Record<string, LaneConfig> = {
  "db-fast": {
    description: "Parallel-safe DB coverage, including mailbox DB tests.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 2,
    maxJobs: 2,
  },
  "core-fast-a": {
    description: "Core eventing/receipt/foundation unit coverage.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 2,
    maxJobs: 2,
  },
  "core-fast-b": {
    description: "Core kever/query/routing unit coverage.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 2,
    maxJobs: 2,
  },
  "app-fast-parallel": {
    description: "Parallel-safe app, protocol, and CLI help coverage.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 2,
    maxJobs: 2,
  },
  "app-fast-isolated": {
    description: "Global-state app coverage that still mutates console or HOME.",
    allowAll: true,
  },
  "runtime-medium": {
    description: "Representative runtime coverage kept on the default path.",
    allowAll: true,
  },
  "app-stateful-a": {
    description: "Older stateful CLI and habitat tests on the default path.",
    allowAll: true,
  },
  "app-stateful-b": {
    description: "Older persistence and compat-open tests on the default path.",
    allowAll: true,
  },
  "interop-parity": {
    description: "Representative KERIpy/TUFA parity coverage.",
    allowAll: true,
  },
  "interop-acdc-extended": {
    description: "Extended reverse-direction ACDC KLI/Tufa parity coverage.",
    allowAll: true,
  },
  "interop-acdc-deep": {
    description: "Deep mixed-chain ACDC KLI/Tufa parity coverage.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 2,
    maxJobs: 2,
  },
  "interop-witness": {
    description: "Witness interop and witness CLI coverage.",
    allowAll: true,
  },
  "interop-gates-b": {
    description: "Gate B ready scenarios.",
    allowAll: true,
  },
  "interop-gates-c": {
    description: "Gate C plus Gate D ready scenarios.",
    allowAll: true,
  },
  "interop-delegation": {
    description: "Cross-implementation delegated inception and rotation scenarios.",
    allowAll: true,
  },
  "runtime-slow": {
    description: "Mailbox-heavy runtime, agent reopen, and witness runtime coverage.",
    allowAll: true,
  },
  "interop-mailbox-slow": {
    description: "Mailbox-heavy interop and Gate E coverage.",
    allowAll: true,
  },
};

const groupDefinitions: Record<string, GroupDefinition> = {
  "core-fast": {
    description: "Public core-fast alias over the two balanced core slices.",
    lanes: [
      "core-fast-a",
      "core-fast-b",
    ],
  },
  "app-fast": {
    description: "Public app-fast alias over parallel-safe and isolated app slices.",
    lanes: [
      "app-fast-parallel",
      "app-fast-isolated",
    ],
  },
  quality: {
    description: "Truthful default path with representative runtime and interop coverage.",
    lanes: [
      "db-fast",
      "core-fast-a",
      "core-fast-b",
      "app-fast-parallel",
      "app-fast-isolated",
      "runtime-medium",
      "app-stateful-a",
      "app-stateful-b",
      "interop-parity",
      "interop-witness",
      "interop-gates-b",
      "interop-gates-c",
    ],
  },
  slow: {
    description: "Explicit slow mailbox/runtime/interop coverage.",
    lanes: [
      "interop-acdc-extended",
      "interop-acdc-deep",
      "interop-delegation",
      "runtime-slow",
      "interop-mailbox-slow",
    ],
  },
  "extended-interop": {
    description: "Manual long-running interop coverage.",
    lanes: [
      "interop-acdc-extended",
      "interop-acdc-deep",
      "interop-delegation",
      "interop-mailbox-slow",
    ],
  },
  full: {
    description: "All KERI tests: default path plus explicit slow lanes.",
    lanes: [
      "db-fast",
      "core-fast-a",
      "core-fast-b",
      "app-fast-parallel",
      "app-fast-isolated",
      "runtime-medium",
      "app-stateful-a",
      "app-stateful-b",
      "interop-parity",
      "interop-witness",
      "interop-gates-b",
      "interop-gates-c",
      "interop-acdc-extended",
      "interop-acdc-deep",
      "interop-delegation",
      "runtime-slow",
      "interop-mailbox-slow",
    ],
  },
};

function usage(): never {
  console.error("Usage: scripts/ci/run-keri-test-group.ts <lane|group>");
  console.error("");
  console.error("Lane membership is discovered from test-source annotations:");
  console.error("  // @file-test-lane <lane>");
  console.error("  // @test-lane <lane>");
  console.error("");
  console.error("Available lanes:");
  for (const [laneName, lane] of Object.entries(laneConfigs)) {
    console.error(`  ${laneName.padEnd(20)} ${lane.description}`);
  }
  console.error("");
  console.error("Available groups:");
  console.error(
    `  ${"lane-audit".padEnd(20)} verify annotated ownership for all discovered KERI tests`,
  );
  for (const [groupName, group] of Object.entries(groupDefinitions)) {
    console.error(`  ${groupName.padEnd(20)} ${group.description}`);
  }
  Deno.exit(1);
}

function relativePackagePath(fileUrl: URL): string {
  return relative(fromFileUrl(packageDir), fromFileUrl(fileUrl));
}

async function collectTestFiles(): Promise<string[]> {
  const files: string[] = [];
  await walkTests(new URL("./test/", packageDir), files);
  return files.sort();
}

async function walkTests(dir: URL, files: string[]): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const entryUrl = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      dir,
    );
    if (entry.isDirectory) {
      await walkTests(entryUrl, files);
      continue;
    }
    if (entry.isFile && entry.name.endsWith(".test.ts")) {
      files.push(relativePackagePath(entryUrl));
    }
  }
}

/**
 * Extract static `Deno.test` names.
 *
 * Dynamic unnamed registrations are allowed only when the file has no
 * per-test lane overrides; in that case the file lane owns every registration.
 */
function extractTestNames(source: string): string[] {
  const names: string[] = [];
  const directPattern = /Deno\.test\(\s*(?:"([^"]+)"|'([^']+)')/gs;
  const objectPattern = /Deno\.test\(\s*\{[\s\S]*?\bname\s*:\s*(?:"([^"]+)"|'([^']+)')[\s\S]*?\}\s*\)/gs;
  const registrationCount = [...source.matchAll(/\bDeno\.test\(/g)].length;

  for (const match of source.matchAll(directPattern)) {
    names.push(match[1] ?? match[2] ?? "");
  }
  for (const match of source.matchAll(objectPattern)) {
    names.push(match[1] ?? match[2] ?? "");
  }

  const named = names.filter((name) => name.length > 0);
  if (
    named.length === 0 && registrationCount > 0
    && !/^\s*\/\/\s*@test-lane\s+/m.test(source)
  ) {
    return Array.from(
      { length: registrationCount },
      (_, index) => `__file_lane_dynamic_test_${index + 1}`,
    );
  }

  return named;
}

/**
 * Parse lane annotations and bind them to test registrations.
 *
 * Audit failure is deliberate: CI lanes are only trustworthy when every test
 * has explicit ownership and every per-test override is consumed exactly once.
 */
function parseFileLaneDiscovery(
  file: string,
  source: string,
): FileLaneDiscovery {
  const testNames = extractTestNames(source);
  if (testNames.length === 0) {
    throw new Error(`No Deno.test names found in ${file}.`);
  }

  const fileLaneMatches = [
    ...source.matchAll(/^\s*\/\/\s*@file-test-lane\s+([a-z0-9-]+)\s*$/gm),
  ];
  if (fileLaneMatches.length !== 1) {
    throw new Error(
      `${file} must declare exactly one "// @file-test-lane <lane>" annotation.`,
    );
  }

  const fileLane = fileLaneMatches[0][1];
  if (!(fileLane in laneConfigs)) {
    throw new Error(`${file} declares unknown file lane "${fileLane}".`);
  }

  const tests: DiscoveredTest[] = [];
  let pendingLane: string | null = null;
  let testIndex = 0;

  for (const line of source.split(/\r?\n/)) {
    const overrideMatch = line.match(
      /^\s*\/\/\s*@test-lane\s+([a-z0-9-]+)\s*$/,
    );
    if (overrideMatch) {
      const lane = overrideMatch[1];
      if (!(lane in laneConfigs)) {
        throw new Error(`${file} declares unknown test lane "${lane}".`);
      }
      pendingLane = lane;
      continue;
    }

    if (!/\bDeno\.test\(/.test(line)) {
      continue;
    }

    const name = testNames[testIndex];
    if (!name) {
      throw new Error(
        `${file} has more Deno.test registrations than discovered names.`,
      );
    }

    tests.push({
      name,
      lane: pendingLane ?? fileLane,
    });

    pendingLane = null;
    testIndex += 1;
  }

  if (pendingLane !== null) {
    throw new Error(`${file} ends with a dangling "// @test-lane" annotation.`);
  }

  if (tests.length !== testNames.length) {
    throw new Error(
      `${file} lane discovery found ${tests.length} test registrations but ${testNames.length} named tests.`,
    );
  }

  return { fileLane, tests };
}

/** Discover all test files and their audited lane assignments. */
async function buildDiscoveredTests(): Promise<Map<string, FileLaneDiscovery>> {
  const discovered = new Map<string, FileLaneDiscovery>();
  for (const file of await collectTestFiles()) {
    const source = await Deno.readTextFile(new URL(file, packageDir));
    discovered.set(file, parseFileLaneDiscovery(file, source));
  }
  return discovered;
}

/**
 * Build lane execution shapes from audited discovery.
 *
 * Whole-file runs preserve Deno's normal file-level behavior. Split runs are
 * used only when a file intentionally contributes tests to multiple lanes.
 */
function buildLaneRunShapes(
  discovered: Map<string, FileLaneDiscovery>,
): Record<string, LaneRunShape> {
  const lanes: Record<string, LaneRunShape> = {};
  for (const laneName of Object.keys(laneConfigs)) {
    lanes[laneName] = { fullFiles: [], splitFiles: [] };
  }

  for (const [file, discovery] of discovered.entries()) {
    const testsByLane = new Map<string, string[]>();
    for (const test of discovery.tests) {
      const tests = testsByLane.get(test.lane) ?? [];
      tests.push(test.name);
      testsByLane.set(test.lane, tests);
    }

    for (const [laneName, testNames] of testsByLane.entries()) {
      const shape = lanes[laneName];
      if (!shape) {
        throw new Error(`${file} resolved to unknown lane "${laneName}".`);
      }
      if (testNames.length === discovery.tests.length) {
        shape.fullFiles.push(file);
      } else {
        shape.splitFiles.push({ file, tests: testNames });
      }
    }
  }

  for (const shape of Object.values(lanes)) {
    shape.fullFiles.sort();
    shape.splitFiles.sort((left, right) => left.file.localeCompare(right.file));
  }

  return lanes;
}

interface AuditResult {
  discoveredFiles: number;
  discoveredTests: number;
}

/** Verify lane ownership before any target-specific execution starts. */
async function auditLaneAssignments(): Promise<AuditResult> {
  const discovered = await buildDiscoveredTests();
  let discoveredTests = 0;
  for (const { tests } of discovered.values()) {
    discoveredTests += tests.length;
  }
  return {
    discoveredFiles: discovered.size,
    discoveredTests,
  };
}

/** Resolve a CLI target to concrete lane names or print usage on mismatch. */
function resolveLaneNames(target: string): string[] {
  if (target in laneConfigs) {
    return [target];
  }
  if (target in groupDefinitions) {
    return [...new Set(groupDefinitions[target].lanes)];
  }
  usage();
}

function chunk<T>(values: T[], size: number): T[][] {
  if (size <= 0) {
    return [values];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

interface ParallelJobResolution {
  available: number;
  cap: number | null;
  chosen: number;
  source: "KERI_TEST_JOBS" | "DENO_JOBS" | "auto";
}

function parsePositiveIntEnv(key: string): number | null {
  const value = Deno.env.get(key);
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${key} must be a positive integer when set, got "${value}".`,
    );
  }

  return parsed;
}

/**
 * Resolve lane concurrency with explicit environment overrides first.
 *
 * `KERI_TEST_JOBS` is the runner-specific knob. `DENO_JOBS` remains supported
 * for CI compatibility, and automatic selection is capped by lane policy.
 */
function resolveParallelJobs(config: LaneConfig): ParallelJobResolution {
  const available = Math.max(navigator.hardwareConcurrency || 1, 1);
  const keriJobs = parsePositiveIntEnv("KERI_TEST_JOBS");
  if (keriJobs !== null) {
    return {
      available,
      cap: config.maxJobs ?? null,
      chosen: keriJobs,
      source: "KERI_TEST_JOBS",
    };
  }

  const denoJobs = parsePositiveIntEnv("DENO_JOBS");
  if (denoJobs !== null) {
    return {
      available,
      cap: config.maxJobs ?? null,
      chosen: denoJobs,
      source: "DENO_JOBS",
    };
  }

  const cap = config.maxJobs ?? available;
  return {
    available,
    cap,
    chosen: Math.min(available, cap),
    source: "auto",
  };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const roundedSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\/^$.*+?()[\]{}|]/g, "\\$&");
}

function splitTestFilter(testNames: string[]): string {
  return `/^(?:${testNames.map(escapeRegex).join("|")})$/`;
}

function sortedTimings(timings: TestCommandTiming[]): TestCommandTiming[] {
  return [...timings].sort((left, right) => right.durationMs - left.durationMs);
}

function timingMarkdown(output: TimingOutput): string {
  const lines = [
    `## KERI test timings: ${output.target}`,
    "",
    `Total child-command time: ${formatDuration(output.totalDurationMs)}`,
    "",
    "| Duration | Lane | Command |",
    "|---:|---|---|",
  ];

  for (const timing of sortedTimings(output.commands)) {
    lines.push(
      `| ${formatDuration(timing.durationMs)} | ${timing.lane} | ${timing.label.replaceAll("|", "\\|")} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function timingJsonPath(target: string): string | null {
  const explicit = Deno.env.get("KERI_TEST_TIMINGS_JSON")?.trim();
  if (explicit) {
    return explicit;
  }

  if (Deno.env.get("GITHUB_ACTIONS") === "true") {
    const dir = Deno.env.get("KERI_TEST_TIMINGS_DIR")?.trim()
      || ".test-timings";
    const job = Deno.env.get("GITHUB_JOB")?.trim() || "keri-tests";
    return `${dir}/${job}-${target}.json`;
  }

  return null;
}

async function emitTimingOutputs(output: TimingOutput): Promise<void> {
  if (output.commands.length === 0) {
    return;
  }

  const markdown = timingMarkdown(output);
  console.log(markdown.trimEnd());

  const summaryPath = Deno.env.get("GITHUB_STEP_SUMMARY")?.trim();
  if (summaryPath) {
    await Deno.writeTextFile(summaryPath, markdown, { append: true });
  }

  const jsonPath = timingJsonPath(output.target);
  if (jsonPath) {
    await Deno.mkdir(dirname(jsonPath), { recursive: true });
    await Deno.writeTextFile(
      jsonPath,
      `${JSON.stringify(output, null, 2)}\n`,
    );
    console.log(`==> Wrote KERI test timings to ${jsonPath}`);
  }
}

/** Run one Deno test command and record its child-process duration. */
async function runDenoTest(
  args: string[],
  label: string,
  laneName: string,
  timings: TestCommandTiming[],
  env?: Record<string, string>,
): Promise<void> {
  console.log(`==> ${label}`);
  const startedAt = new Date();
  const start = performance.now();
  const child = new Deno.Command("deno", {
    args,
    cwd: fromFileUrl(packageDir),
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  const completedAt = new Date();
  const durationMs = Math.round(performance.now() - start);
  timings.push({
    lane: laneName,
    label,
    args,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    success: status.success,
  });
  console.log(`==> ${label} completed in ${formatDuration(durationMs)}`);
  if (!status.success) {
    throw new DenoTestFailure(status.code, label);
  }
}

function baseTestArgs(config: LaneConfig): string[] {
  const args = ["test"];
  if (config.allowAll) {
    args.push("--allow-all", "--unstable-ffi");
  }
  return args;
}

/** Execute one concrete lane according to its whole-file/split-file shape. */
async function runLane(
  laneName: string,
  shapes: Record<string, LaneRunShape>,
  timings: TestCommandTiming[],
): Promise<void> {
  const config = laneConfigs[laneName];
  const shape = shapes[laneName];
  console.log(`==> Lane ${laneName}: ${config.description}`);

  if (config.parallelFullFiles && shape.fullFiles.length > 0) {
    const jobs = resolveParallelJobs(config);
    console.log(
      `==> Lane ${laneName} parallel jobs: available=${jobs.available} chosen=${jobs.chosen} cap=${
        jobs.cap ?? "none"
      } source=${jobs.source}`,
    );
    const env = { DENO_JOBS: `${jobs.chosen}` };
    const batchSize = config.maxFilesPerRun ?? shape.fullFiles.length;
    for (const [index, batch] of chunk(shape.fullFiles, batchSize).entries()) {
      await runDenoTest(
        [...baseTestArgs(config), "--parallel", ...batch],
        `${laneName} full files batch ${index + 1}`,
        laneName,
        timings,
        env,
      );
    }
  } else {
    for (const file of shape.fullFiles) {
      await runDenoTest(
        [...baseTestArgs(config), file],
        `${laneName} full file ${file}`,
        laneName,
        timings,
      );
    }
  }

  for (const splitFile of shape.splitFiles) {
    await runDenoTest(
      [
        ...baseTestArgs(config),
        "--filter",
        splitTestFilter(splitFile.tests),
        splitFile.file,
      ],
      `${laneName} split file ${splitFile.file} (${splitFile.tests.length} tests)`,
      laneName,
      timings,
    );
  }
}

async function main(): Promise<void> {
  const target = Deno.args[0];
  if (!target) {
    usage();
  }

  const timings: TestCommandTiming[] = [];
  const audit = await auditLaneAssignments();
  console.log(
    `==> Lane audit passed: ${audit.discoveredFiles} files, ${audit.discoveredTests} tests annotated`,
  );

  if (target === "lane-audit") {
    return;
  }

  const discovered = await buildDiscoveredTests();
  const shapes = buildLaneRunShapes(discovered);
  let exitCode = 0;
  try {
    for (const laneName of resolveLaneNames(target)) {
      await runLane(laneName, shapes, timings);
    }
  } catch (error) {
    if (error instanceof DenoTestFailure) {
      exitCode = error.code;
    } else {
      throw error;
    }
  } finally {
    await emitTimingOutputs({
      target,
      generatedAt: new Date().toISOString(),
      totalDurationMs: timings.reduce(
        (total, timing) => total + timing.durationMs,
        0,
      ),
      audit,
      commands: timings,
    });
  }

  if (exitCode !== 0) {
    Deno.exit(exitCode);
  }
}

if (import.meta.main) {
  await main();
}
