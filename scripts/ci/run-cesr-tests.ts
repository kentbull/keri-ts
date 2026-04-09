#!/usr/bin/env -S deno run -A

import { fromFileUrl } from "jsr:@std/path/from-file-url";

const packageDir = new URL("../../packages/cesr/", import.meta.url);

interface ParallelJobResolution {
  available: number;
  cap: number;
  chosen: number;
  source: "CESR_TEST_JOBS" | "DENO_JOBS" | "auto";
}

function parsePositiveIntEnv(key: string): number | null {
  const value = Deno.env.get(key);
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer when set, got "${value}".`);
  }

  return parsed;
}

function resolveParallelJobs(): ParallelJobResolution {
  const available = Math.max(navigator.hardwareConcurrency || 1, 1);
  const cesrJobs = parsePositiveIntEnv("CESR_TEST_JOBS");
  if (cesrJobs !== null) {
    return {
      available,
      cap: 8,
      chosen: cesrJobs,
      source: "CESR_TEST_JOBS",
    };
  }

  const denoJobs = parsePositiveIntEnv("DENO_JOBS");
  if (denoJobs !== null) {
    return {
      available,
      cap: 8,
      chosen: denoJobs,
      source: "DENO_JOBS",
    };
  }

  return {
    available,
    cap: 8,
    chosen: Math.min(available, 8),
    source: "auto",
  };
}

async function main(): Promise<void> {
  const jobs = resolveParallelJobs();
  console.log(
    `==> CESR parallel jobs: available=${jobs.available} chosen=${jobs.chosen} cap=${jobs.cap} source=${jobs.source}`,
  );

  const child = new Deno.Command("deno", {
    args: ["test", "--parallel", ...Deno.args],
    cwd: fromFileUrl(packageDir),
    env: { DENO_JOBS: `${jobs.chosen}` },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const status = await child.status;
  if (!status.success) {
    Deno.exit(status.code);
  }
}

if (import.meta.main) {
  await main();
}
