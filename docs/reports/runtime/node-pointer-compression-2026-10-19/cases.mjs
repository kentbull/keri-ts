/** Reproduce the recorded installed-CLI cases inside the named-volume experiment layout. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const round = Number(process.argv[2]);
const variant = process.argv[3];
const root = "/profile";
mkdirSync(root + "/results", { recursive: true });
const unit = readFileSync("/workspace/keri-ts/samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr");
const input = Buffer.concat(Array(256).fill(unit));
writeFileSync(root + "/corpus.cesr", input);
const tufa = root + "/node_modules/.bin/tufa";
const tephra = root + "/node_modules/.bin/tephra";
const name = `memory-${variant}-${round}`;
const head = `/profile/stores/${round}`;
// Prepare a fresh, deterministic fixture store outside the measured inception process.
const init = spawnSync(process.execPath, [
  tufa,
  "init",
  "--name",
  name,
  "--head-dir",
  head,
  "--nopasscode",
  "--salt",
  "0ADHFiisJ7FnfWkPl4YfX6AK",
], { encoding: "utf8" });
if (init.status !== 0) throw new Error(init.stderr + init.stdout);
const cases = [
  ["tufa-version", tufa, ["version"]],
  ["tephra-bench", tephra, ["bench", "--in", root + "/corpus.cesr", "--iterations", "5", "--warmup", "1", "--json"]],
  ["tufa-incept", tufa, [
    "incept",
    "--name",
    name,
    "--head-dir",
    head,
    "--alias",
    "memory",
    "--file",
    "/workspace/keri-ts/samples/incept-config/single-sig-incept.json",
    "--transferable",
  ]],
];
for (const [label, executable, args] of cases) {
  const resultFile = `${root}/results/${round}-${label}.json`;
  // Use this parent's exact runtime build for both the CLI and its identical exit probe.
  const child = spawnSync(process.execPath, ["--import", root + "/observer.mjs", executable, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      RUNTIME_MEMORY_RESULT: resultFile,
      RUNTIME_MEMORY_CASE: label,
      RUNTIME_MEMORY_ROUND: String(round),
      RUNTIME_MEMORY_VARIANT: variant,
    },
  });
  if (child.status !== 0) throw new Error(child.stderr + child.stdout);
  const result = JSON.parse(readFileSync(resultFile, "utf8"));
  if (label === "tephra-bench") {
    const parsed = JSON.parse(child.stdout);
    if (!(parsed.totalFrames > 0)) throw new Error("benchmark produced no frames");
    result.benchmark = parsed;
    result.corpusSha256 = createHash("sha256").update(input).digest("hex");
  }
  writeFileSync(resultFile, JSON.stringify(result) + "\n");
  console.log(JSON.stringify(result));
}
