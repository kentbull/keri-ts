import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  type Api,
  checkShards,
  decide,
  type GateRun,
  matchingRuns,
  missingForShards,
  plan,
  requiredJobs,
  shardsFor,
  trainOwned,
  type Tree,
} from "./release-plan.ts";

const all = ["keri-app-a", "keri-app-b", "keri-runtime", "keri-stateful", "tufa", "small"];
const jobs = (names: string[], conclusion = "success") => names.map((name) => ({ name, conclusion }));
const run = (id: number, event: string, names: string[], conclusion = "success"): GateRun => ({
  id,
  headSha: "a".repeat(40),
  event,
  conclusion: "success",
  jobs: [...jobs(names, conclusion), { name: "stage-gate", conclusion }],
});

Deno.test("a green dispatch run covering the package's shards skips the check", () => {
  const green = run(1, "workflow_dispatch", all.map((name) => `unit (${name})`));
  for (const pkg of ["cesr", "keri", "tufa", "verifier", "multisync"]) {
    assertEquals(decide(pkg, [green]).runCheck, false, pkg);
  }
});

Deno.test("no run, a pull_request run, a missing shard or a red job all run the sharded check", () => {
  const names = all.map((name) => `unit (${name})`);
  assertEquals(decide("keri", []).runCheck, true);
  assertEquals(decide("keri", [run(2, "pull_request", names)]).runCheck, true);
  assertEquals(
    decide("keri", [run(3, "workflow_dispatch", names.filter((name) => name !== "unit (keri-app-b)"))])
      .runCheck,
    true,
  );
  assertEquals(decide("keri", [run(4, "workflow_dispatch", names, "failure")]).runCheck, true);
  assertEquals(decide("keri", []).shards.map((shard) => shard.name), [
    "keri-app-a",
    "keri-app-b",
    "keri-runtime",
    "keri-stateful",
    "small",
  ]);
});

Deno.test("package coverage is derived from the PR gate shards, not a second list", () => {
  assertEquals(requiredJobs("cesr"), ["unit (small)"]);
  assertEquals(requiredJobs("tufa"), ["unit (tufa)", "unit (small)"]);
  assertEquals(checkShards("tufa").map((shard) => shard.targets), [
    JSON.stringify(["tufa"]),
    JSON.stringify(["verifier", "hosting"]),
  ]);
  assertEquals(requiredJobs("multisync").length, 1);
});

/** An API that serves one dispatch run on `onSha` and trees by commit. */
function fakeApi(trees: Record<string, string>, onSha: string, runJobs: string[]): Api {
  return {
    get(path: string): Promise<unknown> {
      if (path.includes("/actions/workflows/")) {
        return Promise.resolve({
          workflow_runs: path.includes("event=workflow_dispatch")
            ? [{ id: 9, head_sha: onSha, event: "workflow_dispatch", conclusion: "success" }]
            : [],
        });
      }
      if (path.includes("/git/commits/")) return Promise.resolve({ tree: { sha: trees[path.split("/").pop()!] } });
      if (path.includes("/actions/runs/9/jobs")) {
        return Promise.resolve({ jobs: [...jobs(runJobs), { name: "stage-gate", conclusion: "success" }] });
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

Deno.test("a run on a different commit counts only when the git tree is identical", async () => {
  const release = "b".repeat(40), other = "c".repeat(40);
  const names = all.map((name) => `unit (${name})`);
  const same = fakeApi({ [other]: "tree1" }, other, names);
  assertEquals((await plan("keri", "o/r", release, "tree1", same)).runCheck, false);
  const different = fakeApi({ [other]: "tree2" }, other, names);
  assertEquals((await plan("keri", "o/r", release, "tree1", different)).runCheck, true);
  assertEquals((await matchingRuns(different, "o/r", release, "tree1")).length, 0);
});

Deno.test("a green run the status-filtered listing omits is still found", async () => {
  const release = "f".repeat(40);
  const names = all.map((name) => `unit (${name})`);
  // Mirrors the Actions API: run 7 is listed unfiltered (and by head_sha) but missing under status=success.
  const api: Api = {
    get(path: string): Promise<unknown> {
      if (path.includes("/actions/workflows/")) {
        const listed = !path.includes("status=");
        return Promise.resolve({
          workflow_runs: listed
            ? [{ id: 7, head_sha: release, event: "workflow_dispatch", conclusion: "success" }]
            : [],
        });
      }
      if (path.includes("/actions/runs/7/jobs")) {
        return Promise.resolve({ jobs: [...jobs(names), { name: "stage-gate", conclusion: "success" }] });
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  assertEquals((await matchingRuns(api, "o/r", release, "tree")).map((found) => found.id), [7]);
  assertEquals((await plan("keri", "o/r", release, "tree", api)).runCheck, false);
});

Deno.test("any API failure fails closed", async () => {
  const broken: Api = { get: () => Promise.reject(new Error("HTTP 500")) };
  const decision = await plan("tufa", "o/r", "d".repeat(40), "t", broken);
  assertEquals(decision.runCheck, true);
  assertEquals(decision.shards.length, 2);
});

/** A tag tree with the given files only. */
function tree(files: Record<string, string>): Tree {
  return { read: (path) => Promise.resolve(path in files ? files[path] : null) };
}
const currentTree = tree({
  "scripts/ci/run-keri-test-group.ts": "",
  "scripts/ci/keri-test-suites.ts": checkShards("keri").flatMap((shard) => JSON.parse(shard.targets) as string[])
    .map((suite) => `"${suite}": {`).join("\n"),
  "deno.json": "\"test:cesr\": \"x\", \"test:quality:keri:fast\": \"y\"",
});

Deno.test("a tag whose tree has the current suites runs the shards; one missing a suite runs its own serial tasks", async () => {
  assertEquals(await missingForShards("keri", currentTree), []);
  assertEquals((await shardsFor("keri", currentTree)).shards.length, 5);
  const old = tree({
    "scripts/ci/run-keri-test-group.ts": "",
    "scripts/ci/keri-test-suites.ts": "\"app-fast-parallel\": {",
    "deno.json": "\"test:quality:keri:fast\": \"y\"",
  });
  const missing = await missingForShards("keri", old);
  assertEquals(missing.includes("suite app-fast-parallel-a"), true);
  const legacy = await shardsFor("keri", old);
  assertEquals(legacy.shards, [{ name: "legacy", targets: "[]" }]);
  assertEquals(legacy.note.includes("serially"), true);
});

Deno.test("a tag lacking even the serial task fails the plan instead of skipping the check", async () => {
  const bare = tree({ "deno.json": "{}" });
  await assertRejects(() => shardsFor("keri", bare), Error, "test:quality:keri:fast");
});

Deno.test("evidence is still required when the tree needs the serial check", async () => {
  const old = tree({ "scripts/ci/keri-test-suites.ts": "", "deno.json": "\"test:quality:keri:fast\": \"y\"" });
  const decision = await plan(
    "keri",
    "o/r",
    "e".repeat(40),
    "t",
    { get: () => Promise.reject(new Error("down")) },
    old,
  );
  assertEquals(decision.runCheck, true);
  assertEquals(decision.shards[0].name, "legacy");
});

Deno.test("only an annotated tag with the Release-Train marker is train-owned", () => {
  assertEquals(trainOwned("tag", "keri 2.2.3\n\nRelease-Train: yes\n"), true);
  assertEquals(trainOwned("tag", "release-train: TRUE"), true);
  assertEquals(trainOwned("tag", "keri 2.2.3"), false);
  assertEquals(trainOwned("tag", "Release-Train: no"), false);
  // A lightweight tag reads its commit's message, which must never opt a tag into the train.
  assertEquals(trainOwned("commit", "Release-Train: yes"), false);
});
