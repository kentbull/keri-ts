import { assertEquals, assertRejects } from "jsr:@std/assert";
import { unitShards } from "./pr-test-scope.ts";
import {
  compareVersions,
  declaredDependencies,
  type Dependencies,
  dispatchAndWait,
  type DispatchApi,
  gateSupportsEvidence,
  internalPins,
  latestTag,
  type Package,
  packages,
  planTrain,
  type Sources,
  stages,
  standIns,
  workflowFile,
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

Deno.test("each package is released by its own workflow file", () => {
  assertEquals(workflowFile("keri"), "keri-ts-npm-release.yml");
  assertEquals(workflowFile("cesr"), "cesr-npm-release.yml");
  assertEquals(workflowFile("tufa"), "tufa-npm-release.yml");
});

/** A fake API that returns the given runs on every poll and records the dispatch. */
function dispatchApi(status: number, runs: Record<string, unknown>[]): DispatchApi & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    dispatch: (path, body) => {
      sent.push({ path, body });
      return Promise.resolve(status);
    },
    get: () => Promise.resolve({ workflow_runs: runs }),
  };
}
const request = (clock: { t: number }) => ({
  repo: "o/r",
  workflow: "keri-ts-npm-release.yml",
  ref: "refs/heads/master",
  inputs: { publish: "false", tag: "keri-v1.0.0", train_id: "7-keri" },
  title: "train 7-keri",
  timeoutMs: 60_000,
  pollMs: 10_000,
  now: () => clock.t,
  sleep: (ms: number) => Promise.resolve(void (clock.t += ms)),
});
const done = (title: string, conclusion: string) => ({
  id: 1,
  display_title: title,
  status: "completed",
  conclusion,
  html_url: "https://example/run/1",
});

Deno.test("dispatch-and-wait returns the url of the one matching successful run", async () => {
  const api = dispatchApi(204, [done("train other", "failure"), done("train 7-keri", "success")]);
  assertEquals(await dispatchAndWait(api, request({ t: 0 })), "https://example/run/1");
  assertEquals((api.sent[0] as { body: { ref: string } }).body.ref, "refs/heads/master");
});

Deno.test("dispatch-and-wait fails on a failed run, a refused dispatch and a timeout", async () => {
  await assertRejects(
    () => dispatchAndWait(dispatchApi(204, [done("train 7-keri", "failure")]), request({ t: 0 })),
    Error,
    "ended failure",
  );
  await assertRejects(() => dispatchAndWait(dispatchApi(422, []), request({ t: 0 })), Error, "HTTP 422");
  // Another run's title never satisfies the wait, and an in-progress run times out.
  await assertRejects(
    () => dispatchAndWait(dispatchApi(204, [done("train 8-keri", "success")]), request({ t: 0 })),
    Error,
    "Timed out",
  );
  const running = { ...done("train 7-keri", "success"), status: "in_progress", conclusion: null };
  await assertRejects(() => dispatchAndWait(dispatchApi(204, [running]), request({ t: 0 })), Error, "Timed out");
});

/** Workspace manifests at one version set, as `packages/<id>/package.json` pins them. */
const manifests: Record<Package, Dependencies> = {
  cesr: {},
  keri: { "cesr-ts": "2.0.0" },
  hosting: { "cesr-ts": "2.0.0", "keri-ts": "2.0.1" },
  wallet: { "cesr-ts": "2.0.0", "keri-ts": "2.0.1" },
  registrar: { "cesr-ts": "2.0.0", "keri-ts": "2.0.1", "@keri-ts/hosting": "2.0.1" },
  verifier: { "cesr-ts": "2.0.0", "keri-ts": "2.0.1", "@keri-ts/registrar": "2.0.1" },
  observer: { "cesr-ts": "2.0.0", "keri-ts": "2.0.1", "@keri-ts/hosting": "2.0.1", "@keri-ts/registrar": "2.0.1" },
  tufa: {},
};
const readManifest = (id: Package) => Promise.resolve(manifests[id]);
const onNpm = (have: string[]) => (name: string, version: string) =>
  Promise.resolve(have.includes(`${name}@${version}`));

Deno.test("a publishing release's smoke needs nothing local; a dry run builds what npm lacks, transitively", async () => {
  const verifier = internalPins(manifests.verifier);
  assertEquals(verifier.map((pin) => pin.package), ["cesr", "keri", "registrar"]);
  // Everything pinned is on npm: the smoke installs only the built tarball.
  const all = ["cesr-ts@2.0.0", "keri-ts@2.0.1", "@keri-ts/hosting@2.0.1", "@keri-ts/registrar@2.0.1"];
  assertEquals(await standIns(verifier, readManifest, onNpm(all)), []);
  // A dry run of a whole version set: registrar is new and so is hosting, which only registrar pins.
  assertEquals(await standIns(verifier, readManifest, onNpm(["cesr-ts@2.0.0", "keri-ts@2.0.1"])), [
    "hosting",
    "registrar",
  ]);
  // Nothing is on npm yet: the stand-ins come back in dependency order.
  assertEquals(await standIns(verifier, readManifest, onNpm([])), ["cesr", "keri", "hosting", "registrar"]);
});
