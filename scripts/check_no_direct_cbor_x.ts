const repoRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const allowlist = new Set([
  "packages/cesr/src/core/cbor.ts",
]);
const roots = [
  `${repoRoot}/packages/cesr/src`,
  `${repoRoot}/packages/keri/src`,
];

const offenders: string[] = [];

for (const root of roots) {
  await walk(root);
}

if (offenders.length > 0) {
  offenders.sort();
  console.error(
    [
      "Direct cbor-x imports are forbidden in KERI/CESR source.",
      "Use packages/cesr/src/core/cbor.ts instead.",
      ...offenders.map((path) => `- ${path}`),
    ].join("\n"),
  );
  Deno.exit(1);
}

async function walk(path: string): Promise<void> {
  for await (const entry of Deno.readDir(path)) {
    const childPath = `${path}/${entry.name}`;
    if (entry.isDirectory) {
      await walk(childPath);
      continue;
    }
    if (!entry.isFile || !childPath.endsWith(".ts")) {
      continue;
    }

    const relativePath = childPath.replace(`${repoRoot}/`, "");
    if (allowlist.has(relativePath)) {
      continue;
    }

    const text = await Deno.readTextFile(childPath);
    if (text.includes('"cbor-x"') || text.includes('"cbor-x/')) {
      offenders.push(relativePath);
    }
  }
}
