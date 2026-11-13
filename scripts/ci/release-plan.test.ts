import { assertEquals } from "jsr:@std/assert";
import { type Api, checkShards, decide, type GateRun, matchingRuns, plan, requiredJobs } from "./release-plan.ts";

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

Deno.test("any API failure fails closed", async () => {
  const broken: Api = { get: () => Promise.reject(new Error("HTTP 500")) };
  const decision = await plan("tufa", "o/r", "d".repeat(40), "t", broken);
  assertEquals(decision.runCheck, true);
  assertEquals(decision.shards.length, 2);
});
