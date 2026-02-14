const SCOPE = ["src", "packages/cesr/src"];

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCommand(
  cmd: string,
  args: string[],
  allowNonZero = false,
): Promise<CmdResult> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR"]) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }

  const out = await new Deno.Command(cmd, {
    args,
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);

  if (!allowNonZero && out.code !== 0) {
    throw new Error(`${cmd} failed (${out.code}): ${stderr || stdout}`);
  }

  return { code: out.code, stdout, stderr };
}

function printHeader(title: string): void {
  console.log(`\n## ${title}`);
}

function printCount(label: string, value: number): void {
  console.log(`- ${label}: ${value}`);
}

function countMatches(output: string): number {
  return output.trim() === "" ? 0 : output.trim().split("\n").length;
}

function printSample(output: string, limit = 12): void {
  const lines = output.trim() === "" ? [] : output.trim().split("\n");
  for (const line of lines.slice(0, limit)) {
    console.log(`  ${line}`);
  }
  if (lines.length > limit) {
    console.log(`  ... (${lines.length - limit} more)`);
  }
}

async function rg(pattern: string): Promise<CmdResult> {
  return await runCommand("rg", ["-n", pattern, ...SCOPE], true);
}

async function printRipgrepSection(
  title: string,
  label: string,
  pattern: string,
): Promise<void> {
  const result = await rg(pattern);
  const count = result.code === 1 ? 0 : countMatches(result.stdout);

  printHeader(title);
  printCount(label, count);
  if (count > 0) {
    printSample(result.stdout);
  }
}

async function printSccSection(): Promise<void> {
  printHeader("Complexity/Size Hotspots");

  let sccTotal: CmdResult;
  let sccByFile: CmdResult;
  try {
    sccTotal = await runCommand("scc", ["--format=tabular", ...SCOPE]);
    sccByFile = await runCommand("scc", [
      "--by-file",
      "--format=tabular",
      ...SCOPE,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`- scc unavailable: ${message}`);
    return;
  }

  const totals = sccTotal.stdout
    .split("\n")
    .find((line) => line.trimStart().startsWith("TypeScript"));
  console.log(`- TS totals: ${totals?.trim() ?? "unavailable"}`);

  const hotspotLines = sccByFile.stdout
    .split("\n")
    .filter((line) => line.includes(".ts"))
    .slice(0, 12);

  if (hotspotLines.length === 0) {
    console.log("- top files: unavailable");
    return;
  }

  console.log("- top TS files by code:");
  for (const line of hotspotLines) {
    console.log(`  ${line.trim()}`);
  }
}

async function main(): Promise<void> {
  console.log("# keri-ts Static Quality Report");
  console.log(`Scope: ${SCOPE.join(", ")}`);

  await printRipgrepSection("Debt Markers", "TODO/FIXME/XXX", "TODO|FIXME|XXX");
  await printRipgrepSection(
    "Logging Surface",
    "console.* calls",
    "console\\.(log|warn|error)",
  );
  await printRipgrepSection(
    "Typing Surface",
    "explicit any usage",
    ":\\s*any\\b|<\\s*any\\s*[,>\\]]|\\bany\\[]|as\\s+any\\b",
  );
  await printRipgrepSection(
    "Error/Catch Patterns",
    "throw/catch occurrences",
    "throw new Error\\(|catch \\(_?error\\)|catch \\{\\}",
  );

  await printSccSection();
}

if (import.meta.main) {
  await main();
}
