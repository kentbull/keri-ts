import { join, relative } from "jsr:@std/path";

const ROOT = new URL("../", import.meta.url);
const SOURCE_ROOTS = [
  new URL("../packages/keri/src/", import.meta.url),
  new URL("../packages/cesr/src/", import.meta.url),
];

const CLASS_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/;

interface MissingDoc {
  path: string;
  line: number;
  className: string;
}

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkTsFiles(path);
      continue;
    }
    if (entry.isFile && path.endsWith(".ts")) {
      yield path;
    }
  }
}

function hasImmediateJsDoc(lines: string[], classLineIndex: number): boolean {
  let index = classLineIndex - 1;
  while (index >= 0 && lines[index].trim() === "") {
    index--;
  }
  if (index < 0) {
    return false;
  }

  const endLine = lines[index]!.trim();
  if (!endLine.endsWith("*/")) {
    return false;
  }
  if (endLine.startsWith("/**")) {
    return true;
  }

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const line = lines[cursor]!.trim();
    if (line === "") {
      return false;
    }
    if (line.startsWith("/**")) {
      return true;
    }
    if (line.startsWith("*")) {
      continue;
    }
    return false;
  }

  return false;
}

function collectMissingDocs(filePath: string): MissingDoc[] {
  const source = Deno.readTextFileSync(filePath);
  const lines = source.split(/\r?\n/);
  const missing: MissingDoc[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = line.match(CLASS_RE);
    if (!match) {
      continue;
    }

    const className = match[1]!;
    if (hasImmediateJsDoc(lines, index)) {
      continue;
    }

    missing.push({
      path: relative(ROOT.pathname, filePath),
      line: index + 1,
      className,
    });
  }

  return missing;
}

const missing = SOURCE_ROOTS.flatMap((root) =>
  [...walkTsFiles(root.pathname)].flatMap((filePath) =>
    collectMissingDocs(filePath)
  )
);

if (missing.length === 0) {
  console.log(
    "docs:check passed: every class declaration has a preceding JSDoc block.",
  );
  Deno.exit(0);
}

console.error("docs:check failed: undocumented class declarations found:");
for (const item of missing) {
  console.error(`- ${item.path}:${item.line} ${item.className}`);
}
Deno.exit(1);
