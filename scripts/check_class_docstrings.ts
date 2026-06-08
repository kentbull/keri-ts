import { join, relative } from "jsr:@std/path";

const ROOT = new URL("../", import.meta.url);
const SOURCE_ROOTS = [
  new URL("../packages/keri/src/", import.meta.url),
  new URL("../packages/cesr/src/", import.meta.url),
];

const CLASS_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/;
const EXPORT_RE = /^\s*export\s+(?:async\s+)?(?:function\*?|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)\b/;

const EXPORT_DOC_FILES = new Set([
  "packages/keri/src/app/cli/ipex.ts",
  "packages/keri/src/app/cli/multisig.ts",
  "packages/keri/src/app/cli/vc.ts",
  "packages/keri/src/app/endpoint-roleing.ts",
  "packages/keri/src/app/ipex-credentialing.ts",
  "packages/keri/src/core/attachment-countering.ts",
  "packages/keri/src/core/protocol-serialization.ts",
]);

interface MissingDoc {
  path: string;
  line: number;
  declaration: string;
  kind: "class" | "export";
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
  const relativePath = relative(ROOT.pathname, filePath);
  const requireExportDocs = EXPORT_DOC_FILES.has(relativePath);
  const checkedExportNames = new Set<string>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      const className = classMatch[1]!;
      if (!hasImmediateJsDoc(lines, index)) {
        missing.push({
          path: relativePath,
          line: index + 1,
          declaration: className,
          kind: "class",
        });
      }
    }

    if (!requireExportDocs) {
      continue;
    }

    const exportMatch = line.match(EXPORT_RE);
    if (!exportMatch) {
      continue;
    }
    const declaration = exportMatch[1]!;
    if (checkedExportNames.has(declaration)) {
      continue;
    }
    checkedExportNames.add(declaration);
    if (!hasImmediateJsDoc(lines, index)) {
      missing.push({
        path: relativePath,
        line: index + 1,
        declaration,
        kind: "export",
      });
    }
  }

  return missing;
}

const missing = SOURCE_ROOTS.flatMap((root) =>
  [...walkTsFiles(root.pathname)].flatMap((filePath) => collectMissingDocs(filePath))
);

if (missing.length === 0) {
  console.log(
    "docs:check passed: every class and ratcheted export declaration has a preceding JSDoc block.",
  );
  Deno.exit(0);
}

console.error("docs:check failed: undocumented declarations found:");
for (const item of missing) {
  console.error(`- ${item.path}:${item.line} ${item.kind} ${item.declaration}`);
}
Deno.exit(1);
