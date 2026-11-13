import { assertEquals, assertThrows } from "jsr:@std/assert";
import { interop, required } from "./keri-test-suites.ts";
import { requestedScope, selectScope, selectUnitShards, unitShards } from "./pr-test-scope.ts";

const head = "a".repeat(40);
const block = (value: unknown) => `\`\`\`keri-ci\n${JSON.stringify(value)}\n\`\`\``;

Deno.test("PR scope preserves path and release defaults without an override", () => {
  const input = { body: "", head, sameRepository: true, release: false };
  assertEquals(selectScope({ ...input, files: ["docs/README.md"] }), {
    unit: { kind: "ci", targets: [] },
    interop: [],
    packageSmoke: false,
    browser: false,
  });
  const source = selectScope({ ...input, files: ["packages/keri/src/core/routing.ts"] });
  assertEquals(source.unit, {
    kind: "ci",
    targets: ["ci", "tufa", "verifier", "hosting", "wallet", "registrar", "observer", "cesr", "ci-tools"],
  });
  assertEquals(source.interop, ["interop-parity"]);
  assertEquals(source.packageSmoke, true);
  for (
    const file of [
      "packages/verifier/src/agent.ts",
      "packages/hosting/src/http/app.ts",
      "packages/wallet/src/wallet.ts",
      "packages/registrar/src/registrar.ts",
      "packages/observer/src/observer.ts",
    ]
  ) {
    assertEquals(selectScope({ ...input, files: [file] }), {
      unit: {
        kind: "ci",
        targets: ["ci", "tufa", "verifier", "hosting", "wallet", "registrar", "observer", "cesr", "ci-tools"],
      },
      interop: [],
      packageSmoke: true,
      browser: false,
    });
  }
  assertEquals(selectScope({ ...input, release: true, files: ["packages/keri/deno.json"] }), {
    unit: { kind: "ci", targets: [] },
    interop: [],
    packageSmoke: true,
    browser: false,
  });
});

Deno.test("PR scope credits local units only for the exact head and retains selected interop", () => {
  const body = block({
    unit: { local: head },
    interop: ["interop-delegation", "interop-v2-registry"],
    package: false,
  });
  assertEquals(requestedScope(body, head), {
    unit: { kind: "local", head },
    interop: ["interop-delegation", "interop-v2-registry"],
    packageSmoke: false,
    browser: false,
  });
  assertThrows(() => requestedScope(body, "b".repeat(40)), Error, "exact head");
  assertThrows(() => requestedScope(block({ unit: { local: head, context: {} }, interop: [], package: false }), head));
});

Deno.test("PR scope uses existing owners and full mode covers the maintained battery", () => {
  assertEquals(
    requestedScope(
      block({
        unit: [required[0], "tufa", "verifier", "hosting", "wallet", "registrar", "observer"],
        interop: [],
        package: false,
      }),
      head,
    )
      ?.unit,
    {
      kind: "ci",
      targets: [required[0], "tufa", "verifier", "hosting", "wallet", "registrar", "observer"],
    },
  );
  assertEquals(requestedScope(block({ full: true }), head), {
    unit: {
      kind: "ci",
      targets: ["ci", "tufa", "verifier", "hosting", "wallet", "registrar", "observer", "cesr", "ci-tools"],
    },
    interop,
    packageSmoke: true,
    browser: true,
  });
});

Deno.test("PR scope rejects malformed, duplicate, overlapping and executable selectors", () => {
  for (
    const value of [
      { unit: ["ci", required[0]], interop: [], package: false },
      { unit: [required[0], required[0]], interop: [], package: false },
      { unit: ["--no-check"], interop: [], package: false },
      { unit: ["tufa; echo unsafe"], interop: [], package: false },
      { unit: [], interop: ["unknown"], package: false },
      { unit: [], interop: [], package: "false" },
      { unit: [], interop: [], package: false, browser: "true" },
      { unit: [], interop: [], package: false, extra: {} },
      { full: true, package: false },
    ]
  ) assertThrows(() => requestedScope(block(value), head));
  assertThrows(() => requestedScope(block({ full: true }) + "\n" + block({ full: true }), head));
  assertThrows(() => requestedScope("```keri-ci\n{broken}\n```", head));
  assertThrows(() => requestedScope("```keri-ci\n{}", head));
});

Deno.test("PR scope cannot downscope fork checks through its description", () => {
  const result = selectScope({
    body: block({ unit: { local: head }, interop: [], package: false }),
    head,
    files: ["packages/keri/src/core/routing.ts"],
    sameRepository: false,
    release: false,
  });
  assertEquals(result.unit, {
    kind: "ci",
    targets: ["ci", "tufa", "verifier", "hosting", "wallet", "registrar", "observer", "cesr", "ci-tools"],
  });
  assertEquals(result.interop, ["interop-parity"]);
  assertEquals(result.packageSmoke, true);
});

Deno.test("PR scope selects the browser lane from an explicit flag or from the paths it can regress", () => {
  const explicit = requestedScope(block({ unit: [], interop: [], package: false, browser: true }), head);
  assertEquals(explicit?.browser, true);
  assertEquals(requestedScope(block({ unit: [], interop: [], package: false }), head)?.browser, false);
  const input = { body: "", head, sameRepository: true, release: false };
  for (
    const file of [
      "packages/keri/src/db/core/indexeddb-persistence.ts",
      "packages/keri/test/browser/engine-cases.ts",
      "packages/keri/scripts/run_browser_tests.ts",
      "packages/keri/scripts/browser_lane.ts",
      "packages/keri/test/browser-transport/probes.ts",
    ]
  ) assertEquals(selectScope({ ...input, files: [file] }).browser, true, file);
  assertEquals(selectScope({ ...input, files: ["packages/keri/src/core/routing.ts"] }).browser, false);
  assertEquals(
    selectScope({ ...input, release: true, files: ["packages/keri/src/db/core/webdber.ts"] }).browser,
    false,
  );
});

Deno.test("unit shards cover every required suite once and list only shards with selected work", () => {
  const members = Object.values(unitShards).flat();
  for (const suite of required) assertEquals(members.filter((member) => member === suite).length, 1, suite);
  assertEquals(selectUnitShards([]), []);
  assertEquals(selectUnitShards(["ci"]).map((shard) => shard.name), ["keri-app", "keri-runtime", "keri-core"]);
  assertEquals(selectUnitShards(["tufa", "core-fast-a"]), [
    { name: "keri-core", targets: JSON.stringify(["core-fast-a"]) },
    { name: "tufa", targets: JSON.stringify(["tufa"]) },
  ]);
});
