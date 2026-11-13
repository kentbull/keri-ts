import { assertEquals, assertRejects } from "jsr:@std/assert";
import { unitShards } from "./pr-test-scope.ts";
import {
  compareVersions,
  declaredDependencies,
  gateSupportsEvidence,
  latestTag,
  type Package,
  packages,
  planTrain,
  type Sources,
  stages,
} from "./release-train.ts";

const read = (id: string) =>
  Deno.readTextFileSync(new URL(`../../packages/${id}/scripts/build_npm.ts`, import.meta.url));

/** The real graph, read from the build scripts that produce each published package.json. */
const graph = Object.fromEntries(
  ["cesr", "keri", "hosting", "wallet", "registrar", "verifier", "observer", "tufa"].map((
    id,
  ) => [id, declaredDependencies(read(id))]),
) as Record<Package, Package[]>;

Deno.test("the dependency graph comes from the build scripts", () => {
  assertEquals(graph.cesr, []);
  assertEquals(graph.keri, ["cesr"]);
  assertEquals(graph.hosting, ["cesr", "keri"]);
  assertEquals(graph.registrar, ["cesr", "keri", "hosting"]);
  assertEquals(graph.verifier, ["cesr", "keri", "registrar"]);
  assertEquals(graph.observer, ["cesr", "keri", "hosting", "registrar"]);
  assertEquals(graph.tufa, ["cesr", "keri", "hosting", "wallet", "registrar", "verifier", "observer"]);
});

Deno.test("stages run independent packages together and dependents after their dependencies", () => {
  const all = Object.keys(graph) as Package[];
  assertEquals(stages(all, graph), [
    ["cesr"],
    ["keri"],
    ["hosting", "wallet"],
    ["registrar"],
    ["verifier", "observer"],
    [
      "tufa",
    ],
  ]);
  assertEquals(stages(["tufa", "verifier", "wallet"], graph), [["wallet", "verifier"], ["tufa"]]);
});

Deno.test("versions and tags order semantically", () => {
  assertEquals(compareVersions("2.2.10", "2.2.9"), 1);
  assertEquals(compareVersions("2.2.2-rc.1", "2.2.2"), -1);
  assertEquals(latestTag(["keri-v2.2.9", "keri-v2.2.10", "keri-v2.2.2-rc.1", "cesr-v9.0.0"], "keri"), "keri-v2.2.10");
});

/** Sources where every package sits at one commit and one version. */
function sources(
  overrides: { published?: Record<string, string[]>; latest?: Record<string, string>; master?: boolean } = {},
): Sources {
  const names = Object.keys(graph) as Package[];
  return {
    tags: () => Promise.resolve(names.map((id) => `${id}-v1.0.0`)),
    commit: () => Promise.resolve("c".repeat(40)),
    onMaster: () => Promise.resolve(overrides.master ?? true),
    file: (_tag, path) => {
      const id = path.split("/")[1];
      return Promise.resolve(path.endsWith("package.json") ? JSON.stringify({ version: "1.0.0" }) : read(id));
    },
    registry: (name) =>
      Promise.resolve({
        latest: overrides.latest?.[name] ?? null,
        versions: overrides.published?.[name] ?? [],
      }),
  };
}

Deno.test("the plan resolves latest tags, drops packages already on npm and stages the rest", async () => {
  const plan = await planTrain({}, sources({ published: { "cesr-ts": ["1.0.0"], "keri-ts": ["1.0.0"] } }));
  assertEquals(plan.dropped.map((item) => item.package), ["cesr", "keri"]);
  assertEquals(plan.stages.map((stage) => stage.map((item) => item.package)), [
    ["hosting", "wallet"],
    ["registrar"],
    ["verifier", "observer"],
    ["tufa"],
  ]);
  assertEquals(plan.stages[0][0].waitFor, ["cesr-ts@1.0.0", "keri-ts@1.0.0"]);
});

Deno.test("an explicit tag wins, and everything published yields an empty plan", async () => {
  const named = Object.fromEntries(Object.values(packages).map((name) => [name, ["1.0.0"]]));
  const plan = await planTrain({ cesr: "cesr-v1.0.0" }, sources({ published: named }));
  assertEquals(plan.stages, []);
  assertEquals(plan.dropped.length, 8);
});

Deno.test("unsafe plans are refused: off master, lower than latest, wrong tag", async () => {
  await assertRejects(() => planTrain({}, sources({ master: false })), Error, "not on master");
  await assertRejects(() => planTrain({}, sources({ latest: { "cesr-ts": "2.0.0" } })), Error, "backwards");
  await assertRejects(() => planTrain({ keri: "cesr-v1.0.0" }, sources()), Error, "not a keri-v");
});

Deno.test("a dry run keeps an explicitly named tag that npm already has", async () => {
  const named = Object.fromEntries(Object.values(packages).map((name) => [name, ["1.0.0"]]));
  const plan = await planTrain({ tufa: "tufa-v1.0.0" }, sources({ published: named }), true);
  assertEquals(plan.resolved.map((item) => item.package), ["tufa"]);
  assertEquals((await planTrain({ tufa: "tufa-v1.0.0" }, sources({ published: named }), false)).resolved, []);
});

Deno.test("a tag's stage gate counts as evidence only when it is dispatchable and uses the current shards", async () => {
  const scope = Object.keys(unitShards).join(" ");
  const files: Record<string, string> = {
    ".github/workflows/pr-stage-gate.yml": "on: workflow_dispatch\nunit_shards",
    "scripts/ci/pr-test-scope.ts": scope,
  };
  const withFiles = (overrides: Record<string, string>): Sources => ({
    ...sources(),
    file: (_tag, path) => {
      const all = { ...files, ...overrides };
      return path in all ? Promise.resolve(all[path]) : Promise.reject(new Error("missing"));
    },
  });
  assertEquals(await gateSupportsEvidence(withFiles({}), "t"), true);
  assertEquals(await gateSupportsEvidence(withFiles({ "scripts/ci/pr-test-scope.ts": "keri-app" }), "t"), false);
  assertEquals(
    await gateSupportsEvidence(withFiles({ ".github/workflows/pr-stage-gate.yml": "on: pull_request" }), "t"),
    false,
  );
  const missing = withFiles({});
  missing.file = () => Promise.reject(new Error("missing"));
  assertEquals(await gateSupportsEvidence(missing, "t"), false);
});
