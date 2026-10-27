/** Select PR checks from explicit maintainer scope, reusing the maintained suite inventory. */
import { interop as interopOwners, required } from "./keri-test-suites.ts";

const allUnits = ["ci", "tufa", "verifier", "cesr", "ci-tools"] as const;
const unitOwners = [...allUnits, ...required] as const;
type UnitTarget = typeof unitOwners[number];
type InteropTarget = typeof interopOwners[number];

/** Local credit is tied to source; CI targets retain the existing runner's isolation policy. */
export interface PrTestScope {
  unit: { kind: "local"; head: string } | { kind: "ci"; targets: readonly UnitTarget[] };
  interop: readonly InteropTarget[];
  packageSmoke: boolean;
}

/** Validate selectors against existing owners, never shell commands or arbitrary paths. */
function targets<Owner extends string>(value: unknown, owners: readonly Owner[]): Owner[] {
  if (!Array.isArray(value)) throw new Error("Test targets must be an array.");
  const result: Owner[] = [];
  const items: unknown[] = value;
  for (const item of items) {
    const owner = owners.find((name) => name === item);
    if (owner === undefined || result.includes(owner)) {
      throw new Error(`Unknown or duplicate test target: ${String(item)}`);
    }
    result.push(owner);
  }
  return result;
}

/** A broad KERI group cannot run alongside one of its own owners. */
function unitTargets(value: unknown): UnitTarget[] {
  const result = targets(value, unitOwners);
  if (result.includes("ci") && result.some((name) => required.some((owner) => owner === name))) {
    throw new Error("The ci group already includes its unit owners.");
  }
  return result;
}

/** Decode the single closed PR-body directive; unknown fields and stale local credit fail fast. */
export function requestedScope(body: string, head: string): PrTestScope | null {
  const blocks = [...body.matchAll(/^```keri-ci[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (!blocks.length) {
    if (body.includes("```keri-ci")) throw new Error("Malformed keri-ci block.");
    return null;
  }
  if (blocks.length !== 1) throw new Error("Use exactly one keri-ci block.");
  const value: unknown = JSON.parse(blocks[0][1]);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CI scope.");
  if ("full" in value && value.full === true && Object.keys(value).length === 1) {
    return {
      unit: { kind: "ci", targets: allUnits },
      interop: [...interopOwners],
      packageSmoke: true,
    };
  }
  if (
    Object.keys(value).length !== 3 || !("unit" in value) || !("interop" in value) || !("package" in value)
    || typeof value.package !== "boolean"
  ) throw new Error("CI scope requires unit, interop and package, or full:true.");
  const selectedInterop = targets(value.interop, interopOwners);
  if (Array.isArray(value.unit)) {
    return {
      unit: { kind: "ci", targets: unitTargets(value.unit) },
      interop: selectedInterop,
      packageSmoke: value.package,
    };
  }
  const local = value.unit;
  if (
    !local || typeof local !== "object" || !("local" in local) || Object.keys(local).length !== 1
    || typeof local.local !== "string" || !/^[a-f0-9]{40}$/.test(local.local) || local.local !== head
  ) throw new Error("Local unit credit must name this PR's exact head SHA.");
  return { unit: { kind: "local", head: local.local }, interop: selectedInterop, packageSmoke: value.package };
}

/** Preserve path-based defaults and bot release packaging when no eligible override is supplied. */
export function selectScope(args: {
  body: string;
  head: string;
  files: readonly string[];
  sameRepository: boolean;
  release: boolean;
}): PrTestScope {
  const override = args.sameRepository ? requestedScope(args.body, args.head) : null;
  if (override) return override;
  if (args.release) return { unit: { kind: "ci", targets: [] }, interop: [], packageSmoke: true };
  const infrastructure = args.files.some((file) =>
    [".github/workflows/pr-stage-gate.yml", "deno.json", "deno.lock", "package.json", "package-lock.json"].includes(
      file,
    )
    || file.startsWith(".github/actions/common-release-setup/")
  );
  const unit = infrastructure
    || args.files.some((file) =>
      file.startsWith("packages/") || file.startsWith("scripts/ci/") || file.startsWith("scripts/bench/")
    );
  const interop = infrastructure
    || args.files.some((file) =>
      file.startsWith("packages/cesr/") || file.startsWith("packages/keri/") || file.startsWith("scripts/ci/")
      || file === ".github/workflows/keri-extended-interop.yml"
    );
  const packageSmoke = infrastructure
    || args.files.some((file) =>
      file.startsWith("packages/") || file.startsWith("scripts/npm/") || file.startsWith("scripts/smoke-test-")
      || file.startsWith("scripts/build-") || file === ".github/workflows/npm-release.yml"
    );
  return {
    unit: { kind: "ci", targets: unit ? allUnits : [] },
    interop: interop ? ["interop-parity"] : [],
    packageSmoke,
  };
}

/** Read only the PR fields needed here; API JSON is unknown until these checks pass. */
function currentBody(value: unknown, head: string): string {
  if (!value || typeof value !== "object" || !("body" in value) || !("head" in value)) {
    throw new Error("Missing PR metadata.");
  }
  const source = value.head;
  if (!source || typeof source !== "object" || !("sha" in source) || source.sha !== head) {
    throw new Error("PR head changed; use the current source run.");
  }
  if (value.body !== null && typeof value.body !== "string") throw new Error("Invalid PR body.");
  return value.body ?? "";
}

/** Execute selected unit owners through existing commands, without shell interpretation. */
async function runUnit(): Promise<void> {
  const selected = unitTargets(JSON.parse(Deno.env.get("UNIT_TARGETS") ?? "[]"));
  for (const target of selected) {
    const args = target === "tufa" ? ["task", "test:quality:tufa"] : target === "verifier"
      ? ["task", "test:verifier"]
      : target === "cesr"
      ? ["task", "test:cesr"]
      : target === "ci-tools"
      ? ["task", "test:ci-tools"]
      : ["run", "-A", "scripts/ci/run-keri-test-group.ts", target];
    const status = await new Deno.Command(Deno.execPath(), {
      args,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    if (!status.success) Deno.exit(status.code);
  }
}

/** Emit the selected contract as job outputs and reviewable evidence. */
async function main(): Promise<void> {
  if (Deno.args[0] === "run-unit") return await runUnit();
  const head = Deno.env.get("HEAD_SHA")!;
  const body = currentBody(JSON.parse(await Deno.readTextFile(Deno.env.get("PR_METADATA")!)), head);
  const diff = await new Deno.Command("git", {
    args: ["diff", "--name-only", Deno.env.get("BASE_SHA")!, head],
  }).output();
  if (!diff.success) throw new Error("Cannot inspect changed paths.");
  const scope = selectScope({
    body,
    head,
    files: new TextDecoder().decode(diff.stdout).trim().split("\n"),
    sameRepository: Deno.env.get("SAME_REPOSITORY") === "true",
    release: Deno.env.get("HEAD_REF") === "changeset-release/master"
      && Deno.env.get("HEAD_AUTHOR") === "github-actions[bot]",
  });
  const unit = scope.unit.kind === "ci" ? scope.unit.targets : [];
  const output = [
    `run_unit=${unit.length > 0}`,
    `run_interop=${scope.interop.length > 0}`,
    `run_package=${scope.packageSmoke}`,
    `unit_targets=${JSON.stringify(unit)}`,
    `interop_targets=${JSON.stringify(scope.interop)}`,
  ].join("\n");
  await Deno.writeTextFile(Deno.env.get("GITHUB_OUTPUT")!, output + "\n", { append: true });
  await Deno.writeTextFile(
    Deno.env.get("GITHUB_STEP_SUMMARY")!,
    `## Selected PR checks\n\nSource: ${head}\n\n\`\`\`json\n${JSON.stringify(scope, null, 2)}\n\`\`\`\n`,
    { append: true },
  );
  console.log(JSON.stringify(scope));
}

if (import.meta.main) await main();
