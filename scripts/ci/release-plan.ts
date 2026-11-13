#!/usr/bin/env -S deno run -A
/**
 * Decide, before a package release builds anything, whether its release check must run.
 *
 * A release commit is already tested by CI. The check is skipped when a recorded green stage-gate run
 * covers this package's tests on the exact content being released, and otherwise runs sharded with the
 * same unit shards the PR gate uses (`unitShards` in pr-test-scope.ts), so no second shard list exists.
 *
 * "Recorded green run" means a `PR Stage Gate` run that
 *   - ran on `push` or `workflow_dispatch`, which check out exactly the run's `head_sha` (a pull_request
 *     run tests a synthetic merge commit, so it never counts), and
 *   - ran on the release commit itself, or on a commit with the identical git tree, and
 *   - finished green: its `stage-gate` job and every `unit (<shard>)` job covering this package succeeded.
 * The scope the run covered is read from its job names, which the plan job fixes from the selected scope.
 * Any API error or ambiguity runs the check.
 */
import { suites } from "./keri-test-suites.ts";
import { selectUnitShards, type UnitShard, type UnitTarget } from "./pr-test-scope.ts";

/** The unit targets each package's release check runs. */
export const releaseTargets: Record<string, readonly UnitTarget[]> = {
  cesr: ["cesr"],
  keri: ["ci"],
  tufa: ["tufa", "verifier", "hosting"],
  verifier: ["verifier"],
  hosting: ["hosting"],
  wallet: ["wallet"],
  registrar: ["registrar"],
  observer: ["observer"],
  multisync: ["multisync"],
};

/** The PR gate suite that owns multisync's single test, so a gate run that passed it covers multisync. */
function multisyncCoverage(): UnitTarget[] {
  const owner = Object.entries(suites).find(([, suite]) => suite.files.includes("test/unit/acdc/dhking.test.ts"));
  if (!owner) throw new Error("No suite owns test/unit/acdc/dhking.test.ts.");
  return [owner[0] as UnitTarget];
}

/** Gate unit jobs whose success proves this package's tests passed. */
export function requiredJobs(pkg: string): string[] {
  const targets = pkg === "multisync" ? multisyncCoverage() : releaseTargets[pkg];
  if (!targets) throw new Error(`Unknown package ${pkg}.`);
  return selectUnitShards(targets).map((shard) => `unit (${shard.name})`);
}

/** Shards the release check runs when no green run covers the package. */
export function checkShards(pkg: string): UnitShard[] {
  const targets = releaseTargets[pkg];
  if (!targets) throw new Error(`Unknown package ${pkg}.`);
  return selectUnitShards(targets);
}

/** One finished stage-gate run and the conclusion of each of its latest-attempt jobs. */
export interface GateRun {
  id: number;
  headSha: string;
  event: string;
  conclusion: string | null;
  jobs: readonly { name: string; conclusion: string | null }[];
}

/** The release check decision and the reason recorded in the job summary. */
export interface Decision {
  runCheck: boolean;
  reason: string;
  shards: UnitShard[];
}

/** Pure decision over runs already matched to the release content. */
export function decide(pkg: string, runs: readonly GateRun[]): Decision {
  const needed = requiredJobs(pkg);
  for (const run of runs) {
    if (run.conclusion !== "success" || !["push", "workflow_dispatch"].includes(run.event)) continue;
    const green = new Set(run.jobs.filter((job) => job.conclusion === "success").map((job) => job.name));
    if (green.has("stage-gate") && needed.every((name) => green.has(name))) {
      return { runCheck: false, reason: `green stage-gate run ${run.id} covered ${needed.join(", ")}`, shards: [] };
    }
  }
  return {
    runCheck: true,
    reason: runs.length
      ? `${runs.length} stage-gate run(s) on this content did not cover ${needed.join(", ")} with a green stage gate`
      : `no recorded green stage-gate run on this content for ${needed.join(", ")}`,
    shards: checkShards(pkg),
  };
}

/** Read-only GitHub API access the lookup needs; replaced in tests. */
export interface Api {
  get(path: string): Promise<unknown>;
}

/** Real API over fetch; any non-2xx status throws, so the caller fails closed. */
export function githubApi(token: string): Api {
  return {
    async get(path: string): Promise<unknown> {
      const response = await fetch(`https://api.github.com/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
      return await response.json();
    },
  };
}

interface RunRecord {
  id: number;
  head_sha: string;
  event: string;
  conclusion: string | null;
}

/** Successful gate runs on the exact commit or on any commit with the identical tree. */
export async function matchingRuns(api: Api, repo: string, sha: string, tree: string): Promise<GateRun[]> {
  const base = `repos/${repo}/actions/workflows/pr-stage-gate.yml/runs?status=success&per_page=100`;
  const lists = await Promise.all([
    api.get(`${base}&head_sha=${sha}`),
    api.get(`${base}&event=workflow_dispatch`),
    api.get(`${base}&event=push`),
  ]);
  const seen = new Map<number, RunRecord>();
  for (const list of lists) {
    for (const run of (list as { workflow_runs: RunRecord[] }).workflow_runs) {
      if (["push", "workflow_dispatch"].includes(run.event)) seen.set(run.id, run);
    }
  }
  const trees = new Map<string, string>([[sha, tree]]);
  for (const sha of new Set([...seen.values()].map((run) => run.head_sha))) {
    if (trees.has(sha)) continue;
    const commit = await api.get(`repos/${repo}/git/commits/${sha}`) as { tree: { sha: string } };
    trees.set(sha, commit.tree.sha);
  }
  const matches: GateRun[] = [];
  for (const run of seen.values()) {
    if (run.head_sha !== sha && trees.get(run.head_sha) !== tree) continue;
    const jobs = await api.get(`repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`) as {
      jobs: { name: string; conclusion: string | null }[];
    };
    matches.push({
      id: run.id,
      headSha: run.head_sha,
      event: run.event,
      conclusion: run.conclusion,
      jobs: jobs.jobs.map(({ name, conclusion }) => ({ name, conclusion })),
    });
  }
  return matches;
}

/** Look the content up and decide; any failure runs the full sharded check. */
export async function plan(pkg: string, repo: string, sha: string, tree: string, api: Api): Promise<Decision> {
  try {
    return decide(pkg, await matchingRuns(api, repo, sha, tree));
  } catch (error) {
    return {
      runCheck: true,
      reason: `could not read recorded runs (${
        error instanceof Error ? error.message : String(error)
      }); running the check`,
      shards: checkShards(pkg),
    };
  }
}

/** Run a git command in the checkout and return its trimmed output. */
async function git(...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`git ${args.join(" ")} failed`);
  return new TextDecoder().decode(out.stdout).trim();
}

/** Publish the decision as job outputs and a reviewable summary. */
async function main(): Promise<void> {
  const pkg = Deno.env.get("PACKAGE") ?? Deno.args[0];
  const repo = Deno.env.get("GITHUB_REPOSITORY");
  const token = Deno.env.get("GH_TOKEN");
  if (!pkg) throw new Error("Usage: PACKAGE=<package> release-plan.ts");
  const sha = await git("rev-parse", "HEAD");
  const tree = await git("rev-parse", "HEAD^{tree}");
  const decision = repo && token
    ? await plan(pkg, repo, sha, tree, githubApi(token))
    : { runCheck: true, reason: "no GitHub credentials; running the check", shards: checkShards(pkg) };
  const summary = `## Release check for ${pkg}\n\nCommit ${sha} (tree ${tree}): ${
    decision.runCheck ? "run the sharded check" : "skip the check"
  } because ${decision.reason}.\n`;
  console.log(JSON.stringify({ pkg, sha, tree, ...decision }));
  const output = Deno.env.get("GITHUB_OUTPUT");
  if (output) {
    await Deno.writeTextFile(
      output,
      `check_needed=${decision.runCheck}\ncheck_shards=${JSON.stringify(decision.shards)}\n`,
      { append: true },
    );
  }
  const stepSummary = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (stepSummary) await Deno.writeTextFile(stepSummary, summary, { append: true });
}

if (import.meta.main) await main();
