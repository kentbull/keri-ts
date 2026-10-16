import { assertEquals, assertThrows } from "jsr:@std/assert";
import { interop, required } from "./keri-test-suites.ts";
import { requestedScope, selectScope } from "./pr-test-scope.ts";

const head = "a".repeat(40);
const block = (value: unknown) => `\`\`\`keri-ci\n${JSON.stringify(value)}\n\`\`\``;

Deno.test("PR scope preserves path and release defaults without an override", () => {
  const input = { body: "", head, sameRepository: true, release: false };
  assertEquals(selectScope({ ...input, files: ["docs/README.md"] }), {
    unit: { kind: "ci", targets: [] },
    interop: [],
    packageSmoke: false,
  });
  const source = selectScope({ ...input, files: ["packages/keri/src/core/routing.ts"] });
  assertEquals(source.unit, { kind: "ci", targets: ["ci", "tufa", "cesr", "ci-tools"] });
  assertEquals(source.interop, ["interop-parity"]);
  assertEquals(source.packageSmoke, true);
  assertEquals(selectScope({ ...input, release: true, files: ["packages/keri/deno.json"] }), {
    unit: { kind: "ci", targets: [] },
    interop: [],
    packageSmoke: true,
  });
});

Deno.test("PR scope credits local units only for the exact head and retains selected interop", () => {
  const body = block({
    unit: { local: head },
    interop: ["interop-delegation", "interop-ipex-disclosure"],
    package: false,
  });
  assertEquals(requestedScope(body, head), {
    unit: { kind: "local", head },
    interop: ["interop-delegation", "interop-ipex-disclosure"],
    packageSmoke: false,
  });
  assertThrows(() => requestedScope(body, "b".repeat(40)), Error, "exact head");
  assertThrows(() => requestedScope(block({ unit: { local: head, context: {} }, interop: [], package: false }), head));
});

Deno.test("PR scope uses existing owners and full mode covers the maintained battery", () => {
  assertEquals(requestedScope(block({ unit: [required[0], "tufa"], interop: [], package: false }), head)?.unit, {
    kind: "ci",
    targets: [required[0], "tufa"],
  });
  assertEquals(requestedScope(block({ full: true }), head), {
    unit: { kind: "ci", targets: ["ci", "tufa", "cesr", "ci-tools"] },
    interop,
    packageSmoke: true,
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
  assertEquals(result.unit, { kind: "ci", targets: ["ci", "tufa", "cesr", "ci-tools"] });
  assertEquals(result.interop, ["interop-parity"]);
  assertEquals(result.packageSmoke, true);
});
