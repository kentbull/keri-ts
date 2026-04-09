#!/usr/bin/env -S deno run -A

import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { relative } from "jsr:@std/path/relative";

interface LaneConfig {
  description: string;
  allowAll?: boolean;
  parallelFullFiles?: boolean;
  maxFilesPerRun?: number;
}

interface GroupDefinition {
  description: string;
  lanes: string[];
}

interface DiscoveredTest {
  name: string;
  lane: string;
}

interface FileLaneDiscovery {
  fileLane: string;
  tests: DiscoveredTest[];
}

interface LaneRunShape {
  fullFiles: string[];
  splitFiles: Array<{ file: string; tests: string[] }>;
}

const packageDir = new URL("../../packages/keri/", import.meta.url);

const laneConfigs: Record<string, LaneConfig> = {
  "db-fast": {
    description: "Parallel-safe DB coverage, including mailbox DB tests.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 8,
  },
  "core-fast": {
    description: "Core KEL/query/reply unit coverage.",
    allowAll: true,
    parallelFullFiles: true,
    maxFilesPerRun: 6,
  },
  "app-fast": {
    description: "Light app, protocol, and CLI help coverage.",
    allowAll: true,
  },
  server: {
    description: "Dedicated server integration coverage.",
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
  quality: {
    description: "Truthful default path with representative runtime and interop coverage.",
    lanes: [
      "db-fast",
      "core-fast",
      "app-fast",
      "server",
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
      "runtime-slow",
      "interop-mailbox-slow",
    ],
  },
  full: {
    description: "All KERI tests: default path plus explicit slow lanes.",
    lanes: [
      "db-fast",
      "core-fast",
      "app-fast",
      "server",
      "runtime-medium",
      "app-stateful-a",
      "app-stateful-b",
      "interop-parity",
      "interop-witness",
      "interop-gates-b",
      "interop-gates-c",
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
  console.error(`  ${"lane-audit".padEnd(20)} verify annotated ownership for all discovered KERI tests`);
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
    const entryUrl = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);
    if (entry.isDirectory) {
      await walkTests(entryUrl, files);
      continue;
    }
    if (entry.isFile && entry.name.endsWith(".test.ts")) {
      files.push(relativePackagePath(entryUrl));
    }
  }
}

function extractTestNames(source: string): string[] {
  const names: string[] = [];
  const directPattern = /Deno\.test\(\s*(?:"([^"]+)"|'([^']+)')/gs;
  const objectPattern = /Deno\.test\(\s*\{[\s\S]*?\bname\s*:\s*(?:"([^"]+)"|'([^']+)')[\s\S]*?\}\s*\)/gs;

  for (const match of source.matchAll(directPattern)) {
    names.push(match[1] ?? match[2] ?? "");
  }
  for (const match of source.matchAll(objectPattern)) {
    names.push(match[1] ?? match[2] ?? "");
  }

  return names.filter((name) => name.length > 0);
}

function parseFileLaneDiscovery(file: string, source: string): FileLaneDiscovery {
  const testNames = extractTestNames(source);
  if (testNames.length === 0) {
    throw new Error(`No Deno.test names found in ${file}.`);
  }

  const fileLaneMatches = [...source.matchAll(/^\s*\/\/\s*@file-test-lane\s+([a-z0-9-]+)\s*$/gm)];
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
    const overrideMatch = line.match(/^\s*\/\/\s*@test-lane\s+([a-z0-9-]+)\s*$/);
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
      throw new Error(`${file} has more Deno.test registrations than discovered names.`);
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

async function buildDiscoveredTests(): Promise<Map<string, FileLaneDiscovery>> {
  const discovered = new Map<string, FileLaneDiscovery>();
  for (const file of await collectTestFiles()) {
    const source = await Deno.readTextFile(new URL(file, packageDir));
    discovered.set(file, parseFileLaneDiscovery(file, source));
  }
  return discovered;
}

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

async function runDenoTest(args: string[], label: string): Promise<void> {
  console.log(`==> ${label}`);
  const child = new Deno.Command("deno", {
    args,
    cwd: fromFileUrl(packageDir),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  if (!status.success) {
    Deno.exit(status.code);
  }
}

function baseTestArgs(config: LaneConfig): string[] {
  const args = ["test"];
  if (config.allowAll) {
    args.push("--allow-all", "--unstable-ffi");
  }
  return args;
}

async function runLane(
  laneName: string,
  shapes: Record<string, LaneRunShape>,
): Promise<void> {
  const config = laneConfigs[laneName];
  const shape = shapes[laneName];
  console.log(`==> Lane ${laneName}: ${config.description}`);

  if (config.parallelFullFiles && shape.fullFiles.length > 0) {
    const batchSize = config.maxFilesPerRun ?? shape.fullFiles.length;
    for (const [index, batch] of chunk(shape.fullFiles, batchSize).entries()) {
      await runDenoTest(
        [...baseTestArgs(config), "--parallel", ...batch],
        `${laneName} full files batch ${index + 1}`,
      );
    }
  } else {
    for (const file of shape.fullFiles) {
      await runDenoTest(
        [...baseTestArgs(config), file],
        `${laneName} full file ${file}`,
      );
    }
  }

  for (const splitFile of shape.splitFiles) {
    for (const testName of splitFile.tests) {
      await runDenoTest(
        [
          ...baseTestArgs(config),
          "--filter",
          testName,
          splitFile.file,
        ],
        `${laneName} split test ${splitFile.file} :: ${testName}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const target = Deno.args[0];
  if (!target) {
    usage();
  }

  const audit = await auditLaneAssignments();
  console.log(
    `==> Lane audit passed: ${audit.discoveredFiles} files, ${audit.discoveredTests} tests annotated`,
  );

  if (target === "lane-audit") {
    return;
  }

  const discovered = await buildDiscoveredTests();
  const shapes = buildLaneRunShapes(discovered);
  for (const laneName of resolveLaneNames(target)) {
    await runLane(laneName, shapes);
  }
}

if (import.meta.main) {
  await main();
}
