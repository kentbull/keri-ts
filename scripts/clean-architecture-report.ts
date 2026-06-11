type Scope = {
  name: string;
  root: string;
  exclude?: (path: string) => boolean;
};

type FileMetrics = {
  path: string;
  lines: number;
  codeLines: number;
};

type SymbolMetrics = {
  name: string;
  kind: string;
  path: string;
  startLine: number;
  lines: number;
};

type ScopeMetrics = {
  name: string;
  root: string;
  files: FileMetrics[];
  symbols: SymbolMetrics[];
  sideEffects: Map<string, number>;
  repeatedHelpers: Map<string, Set<string>>;
};

const CHECK_MODE = Deno.args.includes("--check");
const CLI_TEST_PATH = "packages/tufa/test/cli.test.ts";
const CLI_DEFINITION_ROOT = "packages/tufa/src/cli/command-definitions";

const scopes: Scope[] = [
  { name: "tufa cli", root: "packages/tufa/src/cli" },
  { name: "keri cli operations", root: "packages/keri/src/app/cli" },
  {
    name: "keri app services",
    root: "packages/keri/src/app",
    exclude: (path) => path.startsWith("packages/keri/src/app/cli/"),
  },
  { name: "keri core", root: "packages/keri/src/core" },
  { name: "keri database", root: "packages/keri/src/db" },
  { name: "keri vdr", root: "packages/keri/src/vdr" },
  { name: "keri acdc", root: "packages/keri/src/acdc" },
  { name: "cesr", root: "packages/cesr/src" },
];

const sideEffectPatterns = new Map<string, RegExp>([
  ["console output", /\bconsole\.(log|error|warn|info)\b/g],
  ["sync file read", /\bDeno\.readFileSync\b/g],
  ["sync file write", /\bDeno\.writeFileSync\b/g],
  ["prompt", /\bprompt\s*\(/g],
  ["habery setup", /\bsetupHby\s*\(/g],
  ["agent runtime", /\bcreateAgentRuntime\s*\(/g],
  ["runtime loop", /\bprocessRuntimeUntil\s*\(/g],
  ["mailbox turn", /\bprocessMailboxTurn\s*\(/g],
]);

const methodKeywords = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "yield",
]);

function isSourceFile(path: string): boolean {
  return path.endsWith(".ts")
    && !path.endsWith(".d.ts")
    && !path.includes("/npm/")
    && !path.endsWith(".generated.ts");
}

async function listSourceFiles(scope: Scope): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if ([".deno-cache", "node_modules", "npm", "dist", "build", "coverage"].includes(entry.name)) {
          continue;
        }
        await walk(path);
      } else if (entry.isFile && isSourceFile(path) && !scope.exclude?.(path)) {
        files.push(path);
      }
    }
  }

  await walk(scope.root);
  return files.sort();
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function countCodeLines(lines: string[]): number {
  let inBlock = false;
  let count = 0;

  for (const original of lines) {
    let line = original.trim();
    if (!line) {
      continue;
    }

    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        continue;
      }
      line = line.slice(end + 2).trim();
      inBlock = false;
      if (!line) {
        continue;
      }
    }

    while (line.includes("/*")) {
      const start = line.indexOf("/*");
      const end = line.indexOf("*/", start + 2);
      if (end === -1) {
        line = line.slice(0, start).trim();
        inBlock = true;
        break;
      }
      line = `${line.slice(0, start)} ${line.slice(end + 2)}`.trim();
    }

    if (!line || line.startsWith("//")) {
      continue;
    }
    count++;
  }

  return count;
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === "{") {
      delta++;
    } else if (char === "}") {
      delta--;
    }
  }
  return delta;
}

function detectSymbol(trimmed: string): { name: string; kind: string } | undefined {
  const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/);
  if (functionMatch) {
    return { name: functionMatch[1], kind: "function" };
  }

  const constArrowMatch = trimmed.match(
    /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  );
  if (constArrowMatch) {
    return { name: constArrowMatch[1], kind: "arrow function" };
  }

  const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/);
  if (classMatch) {
    return { name: classMatch[1], kind: "class" };
  }

  const methodMatch = trimmed.match(
    /^(?:public\s+|private\s+|protected\s+|static\s+|async\s+|override\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:A-Za-z0-9_<>,\s[\].|?]*\{/,
  );
  if (methodMatch && !methodKeywords.has(methodMatch[1])) {
    return { name: methodMatch[1], kind: "method" };
  }

  return undefined;
}

function measureSymbols(path: string, lines: string[]): SymbolMetrics[] {
  const symbols: SymbolMetrics[] = [];
  let active: { name: string; kind: string; startLine: number; balance: number; opened: boolean } | undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (!active) {
      const detected = detectSymbol(trimmed);
      if (!detected) {
        return;
      }
      const delta = braceDelta(line);
      active = {
        ...detected,
        startLine: lineNumber,
        balance: delta,
        opened: line.includes("{"),
      };
      if (active.opened && active.balance <= 0) {
        symbols.push({
          name: active.name,
          kind: active.kind,
          path,
          startLine: active.startLine,
          lines: lineNumber - active.startLine + 1,
        });
        active = undefined;
      }
      return;
    }

    const delta = braceDelta(line);
    active.balance += delta;
    active.opened = active.opened || line.includes("{");
    if (active.opened && active.balance <= 0) {
      symbols.push({
        name: active.name,
        kind: active.kind,
        path,
        startLine: active.startLine,
        lines: lineNumber - active.startLine + 1,
      });
      active = undefined;
    }
  });

  return symbols;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return "";
    }
    throw error;
  }
}

async function measureScope(scope: Scope): Promise<ScopeMetrics> {
  const paths = await listSourceFiles(scope);
  const files: FileMetrics[] = [];
  const symbols: SymbolMetrics[] = [];
  const sideEffects = new Map<string, number>();
  const repeatedHelpers = new Map<string, Set<string>>();

  for (const [name] of sideEffectPatterns) {
    sideEffects.set(name, 0);
  }

  for (const path of paths) {
    const text = await Deno.readTextFile(path);
    const lines = text.split(/\r?\n/);
    files.push({
      path,
      lines: lines.length,
      codeLines: countCodeLines(lines),
    });

    for (const [name, pattern] of sideEffectPatterns) {
      sideEffects.set(name, (sideEffects.get(name) ?? 0) + countMatches(text, pattern));
    }

    for (const symbol of measureSymbols(path, lines)) {
      symbols.push(symbol);
      if (symbol.kind === "function") {
        const pathsForName = repeatedHelpers.get(symbol.name) ?? new Set<string>();
        pathsForName.add(path);
        repeatedHelpers.set(symbol.name, pathsForName);
      }
    }
  }

  return { name: scope.name, root: scope.root, files, symbols, sideEffects, repeatedHelpers };
}

async function sourceCommandRegistrySnapshot(): Promise<{
  assertedDispatchedCount: number | undefined;
  exampleCount: number;
  importsCreateCmdHandlers: boolean;
  assertsHandlerParity: boolean;
  staticRegistrationNames: string[];
}> {
  const testText = await readIfExists(CLI_TEST_PATH);
  const assertedMatch = testText.match(/assertEquals\(dispatchedNames\.length,\s*(\d+)\)/);
  const examplesMatch = testText.match(/const CLI_COMMAND_EXAMPLES: string\[\]\[\] = \[([\s\S]*?)\];/);
  const exampleCount = examplesMatch ? countMatches(examplesMatch[1], /^\s+\[/gm) : 0;

  const definitionFiles = await listSourceFiles({ name: "command definitions", root: CLI_DEFINITION_ROOT });
  const registrationNames: string[] = [];

  for (const path of definitionFiles) {
    const text = await Deno.readTextFile(path);
    for (const match of text.matchAll(/registerKeriCliCommand\([\s\S]*?,\s*dispatch,\s*"([^"]+)"/g)) {
      registrationNames.push(match[1]);
    }
    for (const match of text.matchAll(/\bname:\s*"([^"]+)"/g)) {
      registrationNames.push(match[1]);
    }
  }

  return {
    assertedDispatchedCount: assertedMatch ? Number(assertedMatch[1]) : undefined,
    exampleCount,
    importsCreateCmdHandlers: testText.includes("createCmdHandlers"),
    assertsHandlerParity: testText.includes("assertEquals(handlerNames, dispatchedNames)"),
    staticRegistrationNames: uniqueSorted(registrationNames),
  };
}

function topFiles(scopes: ScopeMetrics[], limit: number): FileMetrics[] {
  return scopes
    .flatMap((scope) => scope.files)
    .sort((left, right) => right.lines - left.lines)
    .slice(0, limit);
}

function topSymbols(scopes: ScopeMetrics[], limit: number): SymbolMetrics[] {
  return scopes
    .flatMap((scope) => scope.symbols)
    .sort((left, right) => right.lines - left.lines)
    .slice(0, limit);
}

function formatTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function fileLink(path: string, line?: number): string {
  return line ? `${path}:${line}` : path;
}

const metrics = await Promise.all(scopes.map(measureScope));
const registry = await sourceCommandRegistrySnapshot();

const totalFiles = metrics.reduce((sum, scope) => sum + scope.files.length, 0);
const totalLines = metrics.reduce((sum, scope) => sum + scope.files.reduce((inner, file) => inner + file.lines, 0), 0);
const totalCodeLines = metrics.reduce(
  (sum, scope) => sum + scope.files.reduce((inner, file) => inner + file.codeLines, 0),
  0,
);

const cliScopes = metrics.filter((scope) => scope.name.includes("cli"));
const cliSideEffects = new Map<string, number>();
for (const [name] of sideEffectPatterns) {
  cliSideEffects.set(
    name,
    cliScopes.reduce((sum, scope) => sum + (scope.sideEffects.get(name) ?? 0), 0),
  );
}

const repeatedCliHelpers = cliScopes
  .flatMap((scope) =>
    [...scope.repeatedHelpers.entries()]
      .filter(([, paths]) => paths.size > 1)
      .map(([name, paths]) => ({ name, paths: [...paths].sort() }))
  )
  .sort((left, right) => right.paths.length - left.paths.length || left.name.localeCompare(right.name))
  .slice(0, 20);

const report = [
  "# keri-ts Clean Architecture Baseline Report",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Summary",
  "",
  `- Source files measured: ${formatCount(totalFiles)}`,
  `- Total lines measured: ${formatCount(totalLines)}`,
  `- Estimated code lines measured: ${formatCount(totalCodeLines)}`,
  `- Dispatched CLI leaf commands asserted by test: ${
    registry.assertedDispatchedCount === undefined ? "unknown" : formatCount(registry.assertedDispatchedCount)
  }`,
  `- CLI parse examples in test: ${formatCount(registry.exampleCount)}`,
  `- Static command registration names found: ${formatCount(registry.staticRegistrationNames.length)}`,
  "",
  "## Scope Totals",
  "",
  formatTable(
    ["Scope", "Root", "Files", "Lines", "Code Lines", "Symbols Measured"],
    metrics.map((scope) => [
      scope.name,
      scope.root,
      formatCount(scope.files.length),
      formatCount(scope.files.reduce((sum, file) => sum + file.lines, 0)),
      formatCount(scope.files.reduce((sum, file) => sum + file.codeLines, 0)),
      formatCount(scope.symbols.length),
    ]),
  ),
  "",
  "## Largest Files",
  "",
  formatTable(
    ["Path", "Lines", "Code Lines"],
    topFiles(metrics, 25).map((file) => [
      file.path,
      formatCount(file.lines),
      formatCount(file.codeLines),
    ]),
  ),
  "",
  "## Largest Rough Symbols",
  "",
  "This section is a heuristic hotspot finder. It is intentionally conservative enough for trend tracking, not a TypeScript AST replacement.",
  "",
  formatTable(
    ["Symbol", "Kind", "Location", "Lines"],
    topSymbols(metrics, 30).map((symbol) => [
      symbol.name,
      symbol.kind,
      fileLink(symbol.path, symbol.startLine),
      formatCount(symbol.lines),
    ]),
  ),
  "",
  "## CLI Boundary Side-Effect Signals",
  "",
  formatTable(
    ["Signal", "Occurrences in CLI Scopes"],
    [...cliSideEffects.entries()].map(([name, count]) => [name, formatCount(count)]),
  ),
  "",
  "## Repeated CLI Helper Names",
  "",
  repeatedCliHelpers.length === 0
    ? "No repeated function-declaration helper names were found across CLI files."
    : formatTable(
      ["Helper", "Files"],
      repeatedCliHelpers.map((helper) => [helper.name, helper.paths.join("<br>")]),
    ),
  "",
  "## CLI Command Registry Guardrail",
  "",
  "The authoritative registry parity guardrail is the existing `tufa/cli - parsed command names all have registered handlers` test in `packages/tufa/test/cli.test.ts`.",
  "",
  `- Test imports runtime handler registry: ${registry.importsCreateCmdHandlers ? "yes" : "no"}`,
  `- Test asserts handler names equal parsed command leaves: ${registry.assertsHandlerParity ? "yes" : "no"}`,
  `- Test asserted dispatched leaf count: ${
    registry.assertedDispatchedCount === undefined ? "unknown" : formatCount(registry.assertedDispatchedCount)
  }`,
  `- Test parse example count: ${formatCount(registry.exampleCount)}`,
  `- Static literal registration names found in command definitions: ${
    formatCount(registry.staticRegistrationNames.length)
  }`,
  "",
  registry.staticRegistrationNames.length === 0
    ? "- Static registration names: none found"
    : `- Static registration names: ${registry.staticRegistrationNames.join(", ")}`,
  "",
].join("\n");

console.log(report);

if (
  CHECK_MODE
  && (!registry.importsCreateCmdHandlers || !registry.assertsHandlerParity || !registry.assertedDispatchedCount)
) {
  Deno.exitCode = 1;
}
