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
 *
 * This file runs from the workflow's own commit (the shared workflow checks it out beside the tag), while the
 * package being tested is the tag's content in the working directory. A tag older than the current shard
 * definitions may lack a suite or deno task the shards call; the check then runs the package's historical
 * command list serially with what the tag has ("legacy"), and a tag lacking even that fails the plan.
 */
import { suites } from "./keri-test-suites.ts";
import { multisyncTest, selectUnitShards, type UnitShard, type UnitTarget } from "./pr-test-scope.ts";

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

/** Reads files of the tag's checkout (the working directory); null when the file does not exist. */
export interface Tree {
  read(path: string): Promise<string | null>;
}

/** The checkout in the working directory. */
export const workingTree: Tree = {
  async read(path) {
    try {
      return await Deno.readTextFile(path);
    } catch {
      return null;
    }
  },
};

/** The package's release check as the shared workflow ran it before sharding, as argv lists run in order. */
export function legacyCommands(pkg: string): string[][] {
  const task = (name: string) => ["deno", "task", name];
  const commands: Record<string, string[][]> = {
    cesr: [task("test:cesr")],
    keri: [task("test:quality:keri:fast")],
    tufa: [task("test:quality:tufa"), task("test:verifier"), task("test:hosting")],
    verifier: [task("test:verifier")],
    hosting: [task("test:hosting")],
    wallet: [task("test:wallet")],
    registrar: [task("test:registrar")],
    observer: [task("test:observer")],
    multisync: [[
      "deno",
      "test",
      "-A",
      "--filter",
      multisyncTest.name,
      multisyncTest.file,
    ]],
  };
  const found = commands[pkg];
  if (!found) throw new Error(`Unknown package ${pkg}.`);
  return found;
}

/** Deno tasks the root deno.json of the tag must define for the given argv lists. */
function tasksOf(commands: readonly string[][]): string[] {
  return commands.filter((argv) => argv[1] === "task").map((argv) => argv[2]);
}

/** What the tag's tree lacks for the current shards: suites, runner, or tasks. Empty means shards are supported. */
export async function missingForShards(pkg: string, tree: Tree): Promise<string[]> {
  const missing: string[] = [];
  const suiteFile = await tree.read("scripts/ci/keri-test-suites.ts");
  const denoJson = await tree.read("deno.json");
  const needs = checkShards(pkg).flatMap((shard) => JSON.parse(shard.targets) as string[]);
  const taskFor: Record<string, string> = {
    tufa: "test:quality:tufa",
    verifier: "test:verifier",
    hosting: "test:hosting",
    wallet: "test:wallet",
    registrar: "test:registrar",
    observer: "test:observer",
    cesr: "test:cesr",
  };
  for (const target of needs) {
    if (target === "multisync") {
      if ((await tree.read(multisyncTest.file)) === null) missing.push(multisyncTest.file);
    } else if (taskFor[target]) {
      if (!denoJson?.includes(`"${taskFor[target]}":`)) missing.push(`deno task ${taskFor[target]}`);
    } else if (!suiteFile?.includes(`"${target}": {`)) {
      missing.push(`suite ${target}`);
    }
  }
  if (needs.some((target) => !taskFor[target] && target !== "multisync")) {
    if ((await tree.read("scripts/ci/run-keri-test-group.ts")) === null) {
      missing.push("scripts/ci/run-keri-test-group.ts");
    }
  }
  return missing;
}

/** The shards to run, or the one serial legacy check when the tag's tree cannot run the current shards. */
export async function shardsFor(pkg: string, tree: Tree): Promise<{ shards: UnitShard[]; note: string }> {
  const missing = await missingForShards(pkg, tree);
  if (missing.length === 0) return { shards: checkShards(pkg), note: "" };
  const denoJson = await tree.read("deno.json");
  const absent = tasksOf(legacyCommands(pkg)).filter((name) => !denoJson?.includes(`"${name}":`));
  if (absent.length) {
    throw new Error(
      `The tag lacks ${missing.join(", ")} for sharding and the task(s) ${absent.join(", ")} for the serial check.`,
    );
  }
  return {
    shards: [{ name: "legacy", targets: "[]" }],
    note: ` The tag's tree lacks ${missing.join(", ")}, so the check runs serially with the tag's own tasks.`,
  };
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

/**
 * Green gate runs on the exact commit or on any commit with the identical tree; `decide` judges their jobs.
 *
 * The listing is not filtered by `status=success` on the server: the Actions API omits some completed green
 * runs from that filtered listing (a dispatched gate the release train had just waited for was missing), so
 * the event and conclusion are checked here and the jobs in `decide`.
 */
export async function matchingRuns(api: Api, repo: string, sha: string, tree: string): Promise<GateRun[]> {
  const base = `repos/${repo}/actions/workflows/pr-stage-gate.yml/runs?per_page=100`;
  const lists = await Promise.all([
    api.get(`${base}&head_sha=${sha}`),
    api.get(`${base}&event=workflow_dispatch`),
    api.get(`${base}&event=push`),
  ]);
  const seen = new Map<number, RunRecord>();
  for (const list of lists) {
    for (const run of (list as { workflow_runs: RunRecord[] }).workflow_runs) {
      if (["push", "workflow_dispatch"].includes(run.event) && run.conclusion === "success") seen.set(run.id, run);
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
export async function plan(
  pkg: string,
  repo: string,
  sha: string,
  tree: string,
  api: Api,
  files: Tree = workingTree,
): Promise<Decision> {
  const { shards, note } = await shardsFor(pkg, files);
  try {
    const decision = decide(pkg, await matchingRuns(api, repo, sha, tree));
    return decision.runCheck ? { ...decision, reason: decision.reason + note, shards } : decision;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return { runCheck: true, reason: `could not read recorded runs (${cause}); running the check${note}`, shards };
  }
}

/** The marker line an annotated tag carries when a release-train run, not the tag push, releases it. */
export const trainMarker = /^Release-Train:[ \t]*(yes|true)[ \t]*$/im;

/**
 * Whether a pushed tag is owned by a release train: an annotated tag whose message has the marker line. A
 * lightweight tag has no message of its own (the commit's would be read instead), so it is never train-owned.
 */
export function trainOwned(objectType: string, message: string): boolean {
  return objectType === "tag" && trainMarker.test(message);
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
  const owned = Deno.env.get("GITHUB_EVENT_NAME") === "push" && Deno.env.get("GITHUB_REF_TYPE") === "tag"
    && trainOwned(
      await git("cat-file", "-t", `refs/tags/${Deno.env.get("GITHUB_REF_NAME")}`),
      await git("for-each-ref", "--format=%(contents)", `refs/tags/${Deno.env.get("GITHUB_REF_NAME")}`),
    );
  const sha = await git("rev-parse", "HEAD");
  const tree = await git("rev-parse", "HEAD^{tree}");
  const decision = repo && token
    ? await plan(pkg, repo, sha, tree, githubApi(token))
    : {
      runCheck: true,
      reason: "no GitHub credentials; running the check",
      shards: (await shardsFor(pkg, workingTree)).shards,
    };
  const ownedNote = owned
    ? "\n\nThis tag carries the Release-Train marker, so a release-train run releases it and this run does nothing.\n"
    : "";
  const summary = `${ownedNote}## Release check for ${pkg}\n\nCommit ${sha} (tree ${tree}): ${
    decision.runCheck ? "run the sharded check" : "skip the check"
  } because ${decision.reason}.\n`;
  console.log(JSON.stringify({ pkg, sha, tree, ...decision }));
  const output = Deno.env.get("GITHUB_OUTPUT");
  if (output) {
    await Deno.writeTextFile(
      output,
      `check_needed=${decision.runCheck}\ncheck_shards=${JSON.stringify(decision.shards)}\ntrain_owned=${owned}\n`,
      { append: true },
    );
  }
  const stepSummary = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (stepSummary) await Deno.writeTextFile(stepSummary, summary, { append: true });
}

/** Run one check shard in the tag's checkout: the current shard targets, or the tag's own serial commands. */
async function runCheck(): Promise<void> {
  const pkg = Deno.env.get("PACKAGE");
  if (!pkg) throw new Error("PACKAGE is required.");
  if (Deno.env.get("SHARD_NAME") === "legacy") {
    for (const [command, ...args] of legacyCommands(pkg)) {
      const status = await new Deno.Command(command, { args, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
        .spawn().status;
      if (!status.success) Deno.exit(status.code);
    }
    return;
  }
  const status = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "--no-config",
      "--no-lock",
      new URL("./pr-test-scope.ts", import.meta.url).pathname,
      "run-unit",
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) Deno.exit(status.code);
}

if (import.meta.main) {
  if (Deno.args[0] === "run-check") await runCheck();
  else await main();
}
