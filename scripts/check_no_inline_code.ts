/**
 * Guardrail for build and workflow files.
 *
 * The project rule is that shell/YAML files orchestrate commands while
 * executable JS/TS/Python/Ruby/Perl lives in source files. This script catches
 * multiline heredocs and stdin execution patterns that would hide source code
 * inside build scripts.
 */
const ROOT = new URL("../", import.meta.url);
const SCANNED_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".yml", ".yaml"]);
const SKIP_DIR_PARTS = new Set([".git", ".deno-cache", "node_modules", "npm", "dist", "build", "coverage"]);

/** One inline-code violation with enough context for a maintainer to fix it. */
interface Offender {
  path: string;
  line: number;
  text: string;
  reason: string;
}

/** Return the filename extension used to decide whether a file is scanned. */
function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index < 0 ? "" : path.slice(index);
}

/** Skip generated, dependency, and package-output directories. */
function shouldSkip(path: string): boolean {
  return path.split("/").some((part) => SKIP_DIR_PARTS.has(part));
}

/** Walk the repository and yield only shell/workflow files. */
async function* walk(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);
    const relativePath = child.pathname.replace(ROOT.pathname, "");
    if (shouldSkip(relativePath)) {
      continue;
    }
    if (entry.isDirectory) {
      yield* walk(child);
      continue;
    }
    if (entry.isFile && SCANNED_EXTENSIONS.has(extension(entry.name))) {
      yield child;
    }
  }
}

/** Classify a single shell/workflow line as allowed or as inline executable code. */
function scanLine(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return null;
  }
  // Matches `deno eval` as a command phrase; the whole point of this guard is
  // to keep executable TypeScript in source files instead of shell strings.
  if (/\bdeno\s+eval\b/.test(trimmed)) {
    return "deno eval hides executable TypeScript in a shell command";
  }
  // Matches language interpreters immediately fed by a named heredoc marker,
  // such as `node <<EOF` or `python3 <<'PY'`.
  if (/\b(node|python|python3|ruby|perl)\b.*<<['"]?[A-Za-z_][A-Za-z0-9_-]*['"]?/.test(trimmed)) {
    return "language heredoc hides executable code in a shell/workflow file";
  }
  // Matches Node reading an ES module program from stdin. The trailing branch
  // catches either `node --input-type=module -` alone or followed by a heredoc.
  if (/\bnode\b.*--input-type=.*\s+-\s*(?:<<|$)/.test(trimmed)) {
    return "node stdin execution hides executable JavaScript in a shell/workflow file";
  }
  return null;
}

const offenders: Offender[] = [];
for await (const file of walk(ROOT)) {
  const relativePath = file.pathname.replace(ROOT.pathname, "");
  // Accept LF and CRLF so checkout/platform differences do not affect the
  // reported line numbers.
  const lines = (await Deno.readTextFile(file)).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const reason = scanLine(line);
    if (reason) {
      offenders.push({ path: relativePath, line: index + 1, text: line.trim(), reason });
    }
  }
}

if (offenders.length > 0) {
  console.error("Inline executable code check failed:");
  for (const offender of offenders) {
    console.error(`  ${offender.path}:${offender.line}: ${offender.reason}`);
    console.error(`    ${offender.text}`);
  }
  Deno.exit(1);
}

console.log("inline-code check passed: no multiline executable JS/TS/Python heredocs in shell/workflow files.");
