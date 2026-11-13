#!/usr/bin/env -S deno run -A
/**
 * Plan and support the whole-train npm release workflow (`release-train.yml`).
 *
 * Modes (first argument):
 *   plan     resolve each package's tag, drop what npm already has, order the rest by dependency stage
 *   qualify  run the stage gate for commits that have no recorded green run, and wait for it
 *   visible  wait until `name@version` entries (env WAIT_FOR, a JSON array) are visible on the registry
 *   verify   check a built package's internal dependencies against the planned graph (argument: package)
 *
 * The dependency graph is read from each package's `scripts/build_npm.ts`, whose `dependencies` object
 * becomes the published package.json, and every release re-checks the built package against it (`verify`),
 * so the graph cannot drift from what is published. Evidence rules for `qualify` are release-plan.ts's.
 */
import { decide, githubApi, matchingRuns } from "./release-plan.ts";
import type { Api } from "./release-plan.ts";

/** Release packages in train order of the hand procedure, with their npm names and tag prefixes. */
export const packages = {
  cesr: "cesr-ts",
  keri: "keri-ts",
  hosting: "@keri-ts/hosting",
  wallet: "@keri-ts/wallet",
  registrar: "@keri-ts/registrar",
  verifier: "@keri-ts/verifier",
  observer: "@keri-ts/observer",
  tufa: "@keri-ts/tufa",
} as const;
export type Package = keyof typeof packages;
const order = Object.keys(packages) as Package[];
/** Stage jobs `release-train.yml` defines; a deeper graph must add a stage there. */
export const maxStages = 6;

/** The package id for an npm name, or undefined for third-party dependencies. */
export function packageOf(npmName: string): Package | undefined {
  return order.find((id) => packages[id] === npmName);
}

/** Internal packages named in the first `dependencies: { ... }` object of a build script. */
export function declaredDependencies(buildScript: string): Package[] {
  const start = buildScript.search(/\bdependencies:\s*\{/);
  if (start < 0) return [];
  let depth = 0, end = start;
  for (let i = buildScript.indexOf("{", start); i < buildScript.length; i++) {
    if (buildScript[i] === "{") depth++;
    if (buildScript[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const names = [...buildScript.slice(start, end).matchAll(/"((?:@keri-ts\/)?[a-z-]+)"\s*:/g)].map((m) => m[1]);
  return order.filter((id) => names.includes(packages[id]));
}

/** Compare semantic versions; a prerelease sorts below its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split("-", 2);
    return { nums: core.split(".").map(Number), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The highest `<package>-v<semver>` tag, or undefined when there is none. */
export function latestTag(tags: readonly string[], id: Package): string | undefined {
  const prefix = `${id}-v`;
  const versions = tags.filter((tag) =>
    tag.startsWith(prefix) && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag.slice(prefix.length))
  );
  return versions.sort((a, b) => compareVersions(a.slice(prefix.length), b.slice(prefix.length))).at(-1);
}

/** Dependency stage of each package: 1 plus its deepest selected dependency. */
export function stages(selected: readonly Package[], graph: Record<Package, readonly Package[]>): Package[][] {
  const level = new Map<Package, number>();
  const visit = (id: Package, trail: Package[]): number => {
    if (trail.includes(id)) throw new Error(`Dependency cycle: ${[...trail, id].join(" -> ")}`);
    const known = level.get(id);
    if (known !== undefined) return known;
    const depth = 1
      + Math.max(0, ...graph[id].filter((dep) => selected.includes(dep)).map((dep) => visit(dep, [...trail, id])));
    level.set(id, depth);
    return depth;
  };
  const result: Package[][] = [];
  for (const id of order.filter((candidate) => selected.includes(candidate))) {
    (result[visit(id, []) - 1] ??= []).push(id);
  }
  return result.map((stage) => stage ?? []);
}

/** One resolved package of the train. */
export interface Resolved {
  package: Package;
  tag: string;
  commit: string;
  version: string;
  dependencies: Package[];
  /** `name@version` of each internal dependency at this tag, which must be visible before this release builds. */
  waitFor: string[];
}

/** The git and registry facts the plan reads; replaced in tests. */
export interface Sources {
  tags(): Promise<string[]>;
  commit(tag: string): Promise<string>;
  onMaster(commit: string): Promise<boolean>;
  file(tag: string, path: string): Promise<string>;
  registry(npmName: string): Promise<{ latest: string | null; versions: string[] }>;
}

/** Result of planning: packages to release in stage order, and packages dropped with reasons. */
export interface TrainPlan {
  resolved: Resolved[];
  stages: Resolved[][];
  dropped: { package: Package; reason: string }[];
}

/** Resolve tags, versions and registry state. Throws on anything unsafe to publish. */
export async function planTrain(
  requested: Partial<Record<Package, string>>,
  sources: Sources,
  /** Dry runs keep explicitly named tags even when npm has them, so the build path can be exercised. */
  keepPublished = false,
): Promise<TrainPlan> {
  const tags = await sources.tags();
  const graph = {} as Record<Package, Package[]>;
  const candidates: Resolved[] = [];
  const dropped: TrainPlan["dropped"] = [];
  for (const id of order) {
    const tag = requested[id]?.trim() || latestTag(tags, id);
    if (!tag) throw new Error(`No ${id}-v* tag exists and none was given.`);
    if (!tags.includes(tag) || !tag.startsWith(`${id}-v`)) throw new Error(`${tag} is not a ${id}-v<version> tag.`);
    const commit = await sources.commit(tag);
    const version = (JSON.parse(await sources.file(tag, `packages/${id}/package.json`)) as { version: string }).version;
    if (tag.slice(`${id}-v`.length) !== version) {
      throw new Error(`${tag} does not match ${id} package.json ${version}.`);
    }
    if (!(await sources.onMaster(commit))) throw new Error(`${tag} (${commit}) is not on master.`);
    const dependencies = declaredDependencies(await sources.file(tag, `packages/${id}/scripts/build_npm.ts`));
    graph[id] = dependencies;
    const waitFor = await Promise.all(dependencies.map(async (dep) => {
      const depVersion = (JSON.parse(await sources.file(tag, `packages/${dep}/package.json`)) as { version: string })
        .version;
      return `${packages[dep]}@${depVersion}`;
    }));
    const published = await sources.registry(packages[id]);
    if (published.versions.includes(version) && !(keepPublished && requested[id]?.trim())) {
      dropped.push({ package: id, reason: `${packages[id]}@${version} is already on npm` });
      continue;
    }
    if (!published.versions.includes(version) && published.latest && compareVersions(version, published.latest) < 0) {
      throw new Error(
        `${packages[id]}@${version} is below npm latest ${published.latest}; refusing to move latest backwards.`,
      );
    }
    candidates.push({ package: id, tag, commit, version, dependencies, waitFor });
  }
  const layered = stages(candidates.map((c) => c.package), graph);
  if (layered.length > maxStages) {
    throw new Error(`The graph needs ${layered.length} stages; release-train.yml has ${maxStages}.`);
  }
  const byId = new Map(candidates.map((c) => [c.package, c]));
  return { resolved: candidates, stages: layered.map((stage) => stage.map((id) => byId.get(id)!)), dropped };
}

/** Commits the plan will publish from that have no recorded green run covering a selected package. */
export async function commitsToQualify(
  plan: TrainPlan,
  api: Api,
  repo: string,
): Promise<{ commit: string; tag: string }[]> {
  const needs = new Map<string, string>();
  for (const item of plan.resolved) {
    if (needs.has(item.commit)) continue;
    try {
      const tree = ((await api.get(`repos/${repo}/git/commits/${item.commit}`)) as { tree: { sha: string } }).tree.sha;
      const runs = await matchingRuns(api, repo, item.commit, tree);
      const covered = plan.resolved.filter((other) => other.commit === item.commit)
        .every((other) => !decide(other.package, runs).runCheck);
      if (!covered) needs.set(item.commit, item.tag);
    } catch {
      needs.set(item.commit, item.tag); // fail closed: qualify when the evidence cannot be read
    }
  }
  return [...needs].map(([commit, tag]) => ({ commit, tag }));
}

/** Registry metadata over HTTPS; a 404 means never published. */
async function registry(npmName: string): Promise<{ latest: string | null; versions: string[] }> {
  const response = await fetch(`https://registry.npmjs.org/${npmName.replace("/", "%2F")}`);
  if (response.status === 404) return { latest: null, versions: [] };
  if (!response.ok) throw new Error(`npm registry ${npmName}: HTTP ${response.status}`);
  const body = await response.json() as { "dist-tags"?: { latest?: string }; versions?: Record<string, unknown> };
  return { latest: body["dist-tags"]?.latest ?? null, versions: Object.keys(body.versions ?? {}) };
}

/** Run git and return trimmed stdout. */
async function git(...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr).trim()}`);
  return new TextDecoder().decode(out.stdout).trim();
}

/** Sources backed by the checkout (full history and tags) and the npm registry. */
export const liveSources: Sources = {
  tags: async () => (await git("tag", "--list")).split("\n").filter(Boolean),
  commit: (tag) => git("rev-list", "-n", "1", tag),
  onMaster: async (commit) => {
    try {
      await git("merge-base", "--is-ancestor", commit, "origin/master");
      return true;
    } catch {
      return false;
    }
  },
  file: (tag, path) => git("show", `${tag}:${path}`),
  registry,
};

/** Append `key=value` lines to the step outputs, or print them outside Actions. */
async function output(lines: Record<string, string>): Promise<void> {
  const text = Object.entries(lines).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  const target = Deno.env.get("GITHUB_OUTPUT");
  if (target) await Deno.writeTextFile(target, text, { append: true });
  else console.log(text);
}

/** Append markdown to the job summary. */
async function summarize(markdown: string): Promise<void> {
  const target = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (target) await Deno.writeTextFile(target, markdown + "\n", { append: true });
  console.log(markdown);
}

async function runPlan(): Promise<void> {
  const requested: Partial<Record<Package, string>> = {};
  for (const id of order) requested[id] = Deno.env.get(`TAG_${id.toUpperCase()}`) ?? "";
  const plan = await planTrain(requested, liveSources, Deno.env.get("PUBLISH") !== "true");
  const repo = Deno.env.get("GITHUB_REPOSITORY");
  const token = Deno.env.get("GH_TOKEN");
  const qualify = repo && token ? await commitsToQualify(plan, githubApi(token), repo) : plan.resolved
    .map((item) => ({ commit: item.commit, tag: item.tag }))
    .filter((item, index, all) => all.findIndex((other) => other.commit === item.commit) === index);
  const lines: Record<string, string> = {
    packages: JSON.stringify(plan.resolved.map((item) => item.package)),
    qualify: JSON.stringify(qualify),
  };
  for (let n = 1; n <= maxStages; n++) {
    lines[`stage${n}`] = JSON.stringify((plan.stages[n - 1] ?? []).map((item) => ({
      package: item.package,
      tag: item.tag,
      wait_for: JSON.stringify(item.waitFor),
    })));
  }
  await output(lines);
  const rows = plan.resolved.map((item, index) =>
    `| ${packages[item.package]} | ${item.version} | ${item.tag} | ${item.commit.slice(0, 8)} | stage ${
      plan.stages.findIndex((stage) => stage.includes(item)) + 1
    } |`
  );
  await summarize(
    [
      "## Release train plan",
      "",
      rows.length
        ? "| package | version | tag | commit | stage |\n|---|---|---|---|---|\n" + rows.join("\n")
        : "Nothing to publish.",
      "",
      ...plan.dropped.map((item) => `- dropped ${item.package}: ${item.reason}`),
      qualify.length
        ? `- stage gate will run first for: ${
          qualify.map((item) => `${item.tag} (${item.commit.slice(0, 8)})`).join(", ")
        }`
        : "- every commit already has a recorded green stage-gate run",
    ].join("\n"),
  );
}

async function runQualify(): Promise<void> {
  const repo = Deno.env.get("GITHUB_REPOSITORY")!, token = Deno.env.get("GH_TOKEN")!;
  const items = JSON.parse(Deno.env.get("QUALIFY") ?? "[]") as { commit: string; tag: string }[];
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const api = githubApi(token);
  await Promise.all(items.map(async ({ commit, tag }) => {
    const since = Date.now() - 60_000;
    const dispatch = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/pr-stage-gate.yml/dispatches`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ref: `refs/tags/${tag}` }),
      },
    );
    if (dispatch.status !== 204) throw new Error(`Cannot dispatch the stage gate at ${tag}: HTTP ${dispatch.status}`);
    for (let attempt = 0; attempt < 360; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      const list = await api.get(
        `repos/${repo}/actions/workflows/pr-stage-gate.yml/runs?event=workflow_dispatch&head_sha=${commit}&per_page=20`,
      ) as { workflow_runs: { id: number; created_at: string; status: string; conclusion: string | null }[] };
      const run = list.workflow_runs.filter((item) => Date.parse(item.created_at) >= since)
        .sort((a, b) => b.id - a.id)[0];
      if (run?.status === "completed") {
        if (run.conclusion !== "success") {
          throw new Error(`Stage gate run ${run.id} for ${tag} ended ${run.conclusion}.`);
        }
        await summarize(`Stage gate for ${tag} (${commit.slice(0, 8)}) passed: run ${run.id}.`);
        return;
      }
    }
    throw new Error(`Timed out waiting for the stage gate at ${tag}.`);
  }));
}

async function runVisible(): Promise<void> {
  const wanted = JSON.parse(Deno.env.get("WAIT_FOR") || "[]") as string[];
  for (const entry of wanted) {
    const at = entry.lastIndexOf("@");
    const name = entry.slice(0, at), version = entry.slice(at + 1);
    for (let attempt = 0;; attempt++) {
      if ((await registry(name)).versions.includes(version)) break;
      if (attempt >= 60) throw new Error(`${entry} is not visible on the npm registry.`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    console.log(`${entry} is visible on npm`);
  }
}

async function runVerify(id: string): Promise<void> {
  if (!order.includes(id as Package)) throw new Error(`Unknown package ${id}.`);
  const planned = declaredDependencies(await Deno.readTextFile(`packages/${id}/scripts/build_npm.ts`));
  const built = JSON.parse(await Deno.readTextFile(`packages/${id}/npm/package.json`)) as {
    dependencies?: Record<string, string>;
  };
  const actual = order.filter((dep) => packages[dep] in (built.dependencies ?? {}));
  if (planned.join() !== actual.join()) {
    throw new Error(`${id} was built with internal dependencies [${actual}] but the train plans [${planned}].`);
  }
  console.log(`${id}: built internal dependencies match the planned graph [${actual}]`);
}

if (import.meta.main) {
  const [mode, argument] = Deno.args;
  if (mode === "plan") await runPlan();
  else if (mode === "qualify") await runQualify();
  else if (mode === "visible") await runVisible();
  else if (mode === "verify") await runVerify(argument);
  else throw new Error("Usage: release-train.ts plan|qualify|visible|verify <package>");
}
