const encoder = new TextEncoder();
const decoder = new TextDecoder();

const LEGACY_V1_COUNTER_NAME_ALIASES: Record<string, string> = {
  "-J": "SadPathSig",
  "-K": "SadPathSigGroup",
};

const LEGACY_V1_COUNTER_SIZE_ALIASES: Record<
  string,
  { hs: number; ss: number; fs: number }
> = {
  "-J": { hs: 2, ss: 2, fs: 4 },
  "-K": { hs: 2, ss: 2, fs: 4 },
};

const COMPAT_V2_COUNTER_SIZE_ALIASES: Record<
  string,
  { hs: number; ss: number; fs: number }
> = {
  "-J": { hs: 2, ss: 2, fs: 4 },
};

type StringCodexSpec = {
  className: string;
  instanceName: string;
  constName: string;
};

type CanonicalCodexSpec = {
  className: string;
  instanceName: string;
  source: "coring" | "mapping" | "signing" | "indexing" | "kering";
};

const MATTER_CODEX_SPECS: readonly StringCodexSpec[] = [
  { className: "BextCodex", instanceName: "BexDex", constName: "BEXTER_CODES" },
  { className: "TextCodex", instanceName: "TexDex", constName: "TEXTER_CODES" },
  {
    className: "DecimalCodex",
    instanceName: "DecDex",
    constName: "DECIMAL_CODES",
  },
  { className: "DigCodex", instanceName: "DigDex", constName: "DIGEST_CODES" },
  {
    className: "NonceCodex",
    instanceName: "NonceDex",
    constName: "NONCE_CODES",
  },
  { className: "NumCodex", instanceName: "NumDex", constName: "NUMBER_CODES" },
  { className: "TagCodex", instanceName: "TagDex", constName: "TAG_CODES" },
  {
    className: "LabelCodex",
    instanceName: "LabelDex",
    constName: "LABELER_CODES",
  },
  { className: "PreCodex", instanceName: "PreDex", constName: "PREFIX_CODES" },
  {
    className: "NonTransCodex",
    instanceName: "NonTransDex",
    constName: "NON_TRANSFERABLE_PREFIX_CODES",
  },
  {
    className: "PreNonDigCodex",
    instanceName: "PreNonDigDex",
    constName: "NON_DIGEST_PREFIX_CODES",
  },
] as const;

const MAPPING_CODEX_SPECS: readonly StringCodexSpec[] = [
  {
    className: "EscapeCodex",
    instanceName: "EscapeDex",
    constName: "ESCAPE_CODES",
  },
] as const;

const SIGNING_CODEX_SPECS: readonly StringCodexSpec[] = [
  {
    className: "CipherX25519VarStrmCodex",
    instanceName: "CiXVarStrmDex",
    constName: "CIPHER_X25519_VARIABLE_STREAM_CODES",
  },
  {
    className: "CipherX25519VarQB64Codex",
    instanceName: "CiXVarQB64Dex",
    constName: "CIPHER_X25519_QB64_VARIABLE_CODES",
  },
  {
    className: "CipherX25519FixQB64Codex",
    instanceName: "CiXFixQB64Dex",
    constName: "CIPHER_X25519_FIXED_QB64_CODES",
  },
  {
    className: "CipherX25519AllQB64Codex",
    instanceName: "CiXAllQB64Dex",
    constName: "CIPHER_X25519_ALL_QB64_CODES",
  },
  {
    className: "CipherX25519QB2VarCodex",
    instanceName: "CiXVarQB2Dex",
    constName: "CIPHER_X25519_QB2_VARIABLE_CODES",
  },
  {
    className: "CipherX25519AllVarCodex",
    instanceName: "CiXVarDex",
    constName: "CIPHER_X25519_ALL_VARIABLE_CODES",
  },
  {
    className: "CipherX25519AllCodex",
    instanceName: "CiXDex",
    constName: "CIPHER_X25519_ALL_CODES",
  },
] as const;

const INDEXER_CODEX_SPECS: readonly StringCodexSpec[] = [
  {
    className: "IndexerCodex",
    instanceName: "IdrDex",
    constName: "INDEXER_CODES",
  },
  {
    className: "IndexedSigCodex",
    instanceName: "IdxSigDex",
    constName: "INDEXED_SIG_CODES",
  },
  {
    className: "IndexedCurrentSigCodex",
    instanceName: "IdxCrtSigDex",
    constName: "INDEXED_CURRENT_SIG_CODES",
  },
  {
    className: "IndexedBothSigCodex",
    instanceName: "IdxBthSigDex",
    constName: "INDEXED_BOTH_SIG_CODES",
  },
] as const;

const CANONICAL_MATTER_CODEX_SPECS: readonly CanonicalCodexSpec[] = [
  {
    className: "MatterCodex",
    instanceName: "MtrDex",
    source: "coring",
  },
  {
    className: "SmallVarRawSizeCodex",
    instanceName: "SmallVrzDex",
    source: "coring",
  },
  {
    className: "LargeVarRawSizeCodex",
    instanceName: "LargeVrzDex",
    source: "coring",
  },
  ...MATTER_CODEX_SPECS.map(({ className, instanceName }) => ({
    className,
    instanceName,
    source: "coring" as const,
  })),
  ...MAPPING_CODEX_SPECS.map(({ className, instanceName }) => ({
    className,
    instanceName,
    source: "mapping" as const,
  })),
  ...SIGNING_CODEX_SPECS.map(({ className, instanceName }) => ({
    className,
    instanceName,
    source: "signing" as const,
  })),
] as const;

const CANONICAL_INDEXER_CODEX_SPECS: readonly CanonicalCodexSpec[] = [
  ...INDEXER_CODEX_SPECS.map(({ className, instanceName }) => ({
    className,
    instanceName,
    source: "indexing" as const,
  })),
] as const;

const CANONICAL_TRAIT_CODEX_SPECS: readonly CanonicalCodexSpec[] = [
  {
    className: "TraitCodex",
    instanceName: "TraitDex",
    source: "kering",
  },
] as const;

function resolveKeripyPath(): string {
  const env = Deno.env.get("KERIPY_PATH");
  if (env) return env;
  return "/Users/kbull/code/keri/kentbull/keripy";
}

async function readFile(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

async function formatTypeScript(source: string): Promise<string> {
  const tempPath = await Deno.makeTempFile({ suffix: ".ts" });
  try {
    await Deno.writeTextFile(tempPath, source);
    const configPath = new URL("../../../dprint.json", import.meta.url);
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "npm:dprint@0.49.0",
        "fmt",
        "--config",
        configPath.pathname,
        tempPath,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stderr } = await command.output();
    if (code !== 0) {
      throw new Error(
        `dprint failed while formatting generated artifact: ${decoder.decode(stderr)}`,
      );
    }

    return await Deno.readTextFile(tempPath);
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

function parseNamedStringCodex(
  text: string,
  { className, instanceName }: { className: string; instanceName: string },
): Record<string, string> {
  const start = text.indexOf(`class ${className}`);
  if (start < 0) throw new Error(`${className} class not found`);
  const end = text.indexOf(`${instanceName} = ${className}()`, start);
  if (end < 0) throw new Error(`${instanceName} instance not found`);
  const chunk = text.slice(start, end);
  const regex = /^\s+([A-Za-z0-9_]+):\s+str\s*=\s*['"]([^'"]+)['"]/gm;
  const out: Record<string, string> = {};
  for (const match of chunk.matchAll(regex)) {
    out[match[1]] = match[2];
  }
  return out;
}

function parseStringCodex(
  text: string,
  { className, instanceName }: { className: string; instanceName: string },
): Record<string, string> {
  const named = parseNamedStringCodex(text, { className, instanceName });
  const out: Record<string, string> = {};
  for (const [name, code] of Object.entries(named)) {
    out[code] = name;
  }
  return out;
}

function parseMatterCodex(text: string): Record<string, string> {
  return parseStringCodex(text, {
    className: "MatterCodex",
    instanceName: "MtrDex",
  });
}

function parseMatterSizes(
  text: string,
): Record<
  string,
  { hs: number; ss: number; xs: number; fs: number | null; ls: number }
> {
  const start = text.indexOf("Sizes = {");
  if (start < 0) throw new Error("Matter Sizes table not found");
  const end = text.indexOf("\n\n    Codes = asdict(MtrDex)", start);
  const chunk = text.slice(start, end);
  const regex = /'([^']+)':\s+Sizage\(hs=(\d+),\s*ss=(\d+),\s*xs=(\d+),\s*fs=(None|\d+),\s*ls=(\d+)\)/g;
  const out: Record<
    string,
    { hs: number; ss: number; xs: number; fs: number | null; ls: number }
  > = {};
  for (const match of chunk.matchAll(regex)) {
    out[match[1]] = {
      hs: Number.parseInt(match[2], 10),
      ss: Number.parseInt(match[3], 10),
      xs: Number.parseInt(match[4], 10),
      fs: match[5] === "None" ? null : Number.parseInt(match[5], 10),
      ls: Number.parseInt(match[6], 10),
    };
  }
  return out;
}

function parseIndexerCodex(text: string): Record<string, string> {
  return parseStringCodex(text, {
    className: "IndexerCodex",
    instanceName: "IdrDex",
  });
}

function parseIndexerSizes(
  text: string,
): Record<
  string,
  { hs: number; ss: number; os: number; fs: number | null; ls: number }
> {
  const start = text.indexOf("Sizes = {");
  if (start < 0) throw new Error("Indexer Sizes table not found");
  const end = text.indexOf("\n    # Bards table", start);
  if (end < 0) throw new Error("Indexer Sizes block terminator not found");
  const chunk = text.slice(start, end);
  const regex = /'([^']+)':\s+Xizage\(hs=(\d+),\s*ss=(\d+),\s*os=(\d+),\s*fs=(None|\d+),\s*ls=(\d+)\)/g;
  const out: Record<
    string,
    { hs: number; ss: number; os: number; fs: number | null; ls: number }
  > = {};
  for (const match of chunk.matchAll(regex)) {
    out[match[1]] = {
      hs: Number.parseInt(match[2], 10),
      ss: Number.parseInt(match[3], 10),
      os: Number.parseInt(match[4], 10),
      fs: match[5] === "None" ? null : Number.parseInt(match[5], 10),
      ls: Number.parseInt(match[6], 10),
    };
  }
  return out;
}

function parseCounterCodexes(
  text: string,
): { v1: Record<string, string>; v2: Record<string, string> } {
  const classV1 = text.slice(
    text.indexOf("class CounterCodex_1_0"),
    text.indexOf("CtrDex_1_0 = CounterCodex_1_0()"),
  );
  const classV2 = text.slice(
    text.indexOf("class CounterCodex_2_0"),
    text.indexOf("CtrDex_2_0 = CounterCodex_2_0()"),
  );

  const regex = /^\s+([A-Za-z0-9_]+):\s+str\s*=\s*'([^']+)'/gm;
  const v1: Record<string, string> = {};
  const v2: Record<string, string> = {};

  for (const match of classV1.matchAll(regex)) v1[match[2]] = match[1];
  for (const match of classV2.matchAll(regex)) v2[match[2]] = match[1];
  return { v1, v2 };
}

function parseCounterSizes(
  text: string,
): {
  v1: Record<string, { hs: number; ss: number; fs: number }>;
  v2: Record<string, { hs: number; ss: number; fs: number }>;
} {
  const start = text.indexOf("Sizes = \\");
  if (start < 0) throw new Error("Counter Sizes block not found");
  const end = text.indexOf("\n\n\n    def __init__", start);
  const chunk = text.slice(start, end);

  const v1Block = chunk.slice(
    chunk.indexOf("Vrsn_1_0.minor:"),
    chunk.indexOf("Vrsn_2_0.major:"),
  );
  const v2Block = chunk.slice(chunk.indexOf("Vrsn_2_0.minor:"));

  const regex = /'([^']+)':\s+Cizage\(hs=(\d+),\s*ss=(\d+),\s*fs=(\d+)\)/g;

  const parseBlock = (
    block: string,
  ): Record<string, { hs: number; ss: number; fs: number }> => {
    const out: Record<string, { hs: number; ss: number; fs: number }> = {};
    for (const match of block.matchAll(regex)) {
      out[match[1]] = {
        hs: Number.parseInt(match[2], 10),
        ss: Number.parseInt(match[3], 10),
        fs: Number.parseInt(match[4], 10),
      };
    }
    return out;
  };

  return { v1: parseBlock(v1Block), v2: parseBlock(v2Block) };
}

function emitMatterTables(
  sizes: Record<
    string,
    { hs: number; ss: number; xs: number; fs: number | null; ls: number }
  >,
  names: Record<string, string>,
): string {
  const entries = Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b));
  const nameEntries = Object.entries(names).sort(([a], [b]) => a.localeCompare(b));
  const inverseEntries = Object.entries(names).sort(([, a], [, b]) => a.localeCompare(b));
  return `// Generated by packages/cesr/scripts/generate-tables.ts\nimport type { Sizage } from './table-types.ts';\n\nexport const MATTER_SIZES = new Map<string, Sizage>([\n${
    entries
      .map(([code, s]) =>
        `  ['${code}', { hs: ${s.hs}, ss: ${s.ss}, xs: ${s.xs}, fs: ${s.fs === null ? "null" : s.fs}, ls: ${s.ls} }],`
      )
      .join("\n")
  }\n]);\n\nexport const MATTER_CODE_NAMES = {\n${
    nameEntries.map(([code, name]) => `  '${code}': '${name}',`).join("\n")
  }\n} as const;\n\nexport const MATTER_CODES_BY_NAME = {\n${
    inverseEntries.map(([code, name]) => `  '${name}': '${code}',`).join("\n")
  }\n} as const;\n\nexport const MATTER_HARDS = new Map<string, number>([\n  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => [c, 1] as [string, number]),\n  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [c, 1] as [string, number]),\n  ['0', 2], ['1', 4], ['2', 4], ['3', 4], ['4', 2], ['5', 2], ['6', 2], ['7', 4], ['8', 4], ['9', 4],\n]);\n`;
}

function emitIndexerTables(
  sizes: Record<
    string,
    { hs: number; ss: number; os: number; fs: number | null; ls: number }
  >,
  names: Record<string, string>,
): string {
  const entries = Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b));
  const nameEntries = Object.entries(names).sort(([a], [b]) => a.localeCompare(b));
  const inverseEntries = Object.entries(names).sort(([, a], [, b]) => a.localeCompare(b));
  return `// Generated by packages/cesr/scripts/generate-tables.ts\nimport type { Xizage } from './table-types.ts';\n\nexport const INDEXER_SIZES = new Map<string, Xizage>([\n${
    entries
      .map(([code, s]) =>
        `  ['${code}', { hs: ${s.hs}, ss: ${s.ss}, os: ${s.os}, fs: ${s.fs === null ? "null" : s.fs}, ls: ${s.ls} }],`
      )
      .join("\n")
  }\n]);\n\nexport const INDEXER_CODE_NAMES = {\n${
    nameEntries.map(([code, name]) => `  '${code}': '${name}',`).join("\n")
  }\n} as const;\n\nexport const INDEXER_CODES_BY_NAME = {\n${
    inverseEntries.map(([code, name]) => `  '${name}': '${code}',`).join("\n")
  }\n} as const;\n\nexport const INDEXER_HARDS = new Map<string, number>([\n  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => [c, 1] as [string, number]),\n  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [c, 1] as [string, number]),\n  ['0', 2], ['1', 2], ['2', 2], ['3', 2], ['4', 2],\n]);\n`;
}

function emitStringCodexes(
  codexes: Array<{ constName: string; entries: Record<string, string> }>,
): string {
  const blocks = codexes.map(({ constName, entries }) => {
    const codes = Object.keys(entries).sort((a, b) => a.localeCompare(b));
    return `export const ${constName} = new Set<string>([\n${codes.map((code) => `  '${code}',`).join("\n")}\n]);`;
  }).join("\n\n");

  return `// Generated by packages/cesr/scripts/generate-tables.ts\n${blocks}\n`;
}

function emitCanonicalCodexModule(
  codexes: Array<{
    className: string;
    instanceName: string;
    entries: Record<string, string>;
  }>,
): string {
  const blocks = codexes.map(({ className, instanceName, entries }) => {
    const namedEntries = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
    return `export const ${className} = Object.freeze(\n  {\n${
      namedEntries.map(([name, code]) => `    ${name}: "${code}",`).join("\n")
    }\n  } as const,\n);\n\nexport const ${instanceName} = ${className};\n\nexport type ${className}Name = keyof typeof ${className};\nexport type ${className}Code = (typeof ${className})[${className}Name];`;
  }).join("\n\n");

  return `// Generated by packages/cesr/scripts/generate-tables.ts\n${blocks}\n`;
}

function emitCounterTables(
  v1: Record<string, { hs: number; ss: number; fs: number }>,
  v2: Record<string, { hs: number; ss: number; fs: number }>,
  namesV1: Record<string, string>,
  namesV2: Record<string, string>,
): string {
  const entriesV1 = Object.entries(v1).sort(([a], [b]) => a.localeCompare(b));
  const entriesV2 = Object.entries(v2).sort(([a], [b]) => a.localeCompare(b));
  const nameEntriesV1 = Object.entries(namesV1).sort(([a], [b]) => a.localeCompare(b));
  const nameEntriesV2 = Object.entries(namesV2).sort(([a], [b]) => a.localeCompare(b));

  return `// Generated by packages/cesr/scripts/generate-tables.ts\nimport type { Cizage } from './table-types.ts';\n\nexport const COUNTER_SIZES_V1 = new Map<string, Cizage>([\n${
    entriesV1
      .map(([code, s]) => `  ['${code}', { hs: ${s.hs}, ss: ${s.ss}, fs: ${s.fs} }],`)
      .join("\n")
  }\n]);\n\nexport const COUNTER_SIZES_V2 = new Map<string, Cizage>([\n${
    entriesV2
      .map(([code, s]) => `  ['${code}', { hs: ${s.hs}, ss: ${s.ss}, fs: ${s.fs} }],`)
      .join("\n")
  }\n]);\n\nexport const COUNTER_HARDS = new Map<string, number>([\n  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('').map((c) => [\`-\${c}\`, 2] as [string, number]),\n  ['--', 3],\n  ['-_', 5],\n]);\n\nexport const COUNTER_CODE_NAMES_V1 = {\n${
    nameEntriesV1.map(([code, name]) => `  '${code}': '${name}',`).join("\n")
  }\n} as const;\n\nexport const COUNTER_CODE_NAMES_V2 = {\n${
    nameEntriesV2.map(([code, name]) => `  '${code}': '${name}',`).join("\n")
  }\n} as const;\n`;
}

function applyLegacyV1CounterAliases(
  sizes: Record<string, { hs: number; ss: number; fs: number }>,
  names: Record<string, string>,
): {
  sizes: Record<string, { hs: number; ss: number; fs: number }>;
  names: Record<string, string>;
} {
  const outSizes = { ...sizes };
  const outNames = { ...names };

  for (const [code, size] of Object.entries(LEGACY_V1_COUNTER_SIZE_ALIASES)) {
    if (!outSizes[code]) {
      outSizes[code] = size;
    }
  }
  for (const [code, name] of Object.entries(LEGACY_V1_COUNTER_NAME_ALIASES)) {
    if (!outNames[code]) {
      outNames[code] = name;
    }
  }

  return { sizes: outSizes, names: outNames };
}

function applyCompatV2CounterSizeAliases(
  sizes: Record<string, { hs: number; ss: number; fs: number }>,
  names: Record<string, string>,
): Record<string, { hs: number; ss: number; fs: number }> {
  const outSizes = { ...sizes };
  for (const [code, size] of Object.entries(COMPAT_V2_COUNTER_SIZE_ALIASES)) {
    if (names[code] && !outSizes[code]) {
      outSizes[code] = size;
    }
  }
  return outSizes;
}

export async function buildGeneratedArtifacts(
  keripyPath = resolveKeripyPath(),
): Promise<Record<string, string>> {
  const coring = await readFile(`${keripyPath}/src/keri/core/coring.py`);
  const mapping = await readFile(`${keripyPath}/src/keri/core/mapping.py`);
  const counting = await readFile(`${keripyPath}/src/keri/core/counting.py`);
  const signing = await readFile(`${keripyPath}/src/keri/core/signing.py`);
  const indexing = await readFile(`${keripyPath}/src/keri/core/indexing.py`);
  const kering = await readFile(`${keripyPath}/src/keri/kering.py`);

  const sourceText = (source: CanonicalCodexSpec["source"]): string => {
    switch (source) {
      case "coring":
        return coring;
      case "mapping":
        return mapping;
      case "signing":
        return signing;
      case "indexing":
        return indexing;
      case "kering":
        return kering;
    }
  };

  const matterSizes = parseMatterSizes(coring);
  const matterNames = parseMatterCodex(coring);
  const matterCodexes = [
    ...MATTER_CODEX_SPECS.map((spec) => ({
      constName: spec.constName,
      entries: parseStringCodex(coring, spec),
    })),
    ...MAPPING_CODEX_SPECS.map((spec) => ({
      constName: spec.constName,
      entries: parseStringCodex(mapping, spec),
    })),
    ...SIGNING_CODEX_SPECS.map((spec) => ({
      constName: spec.constName,
      entries: parseStringCodex(signing, spec),
    })),
  ];
  const canonicalMatterCodexes = CANONICAL_MATTER_CODEX_SPECS.map((spec) => ({
    className: spec.className,
    instanceName: spec.instanceName,
    entries: parseNamedStringCodex(sourceText(spec.source), spec),
  }));
  const indexerSizes = parseIndexerSizes(indexing);
  const indexerNames = parseIndexerCodex(indexing);
  const indexerCodexes = INDEXER_CODEX_SPECS.map((spec) => ({
    constName: spec.constName,
    entries: parseStringCodex(indexing, spec),
  }));
  const canonicalIndexerCodexes = CANONICAL_INDEXER_CODEX_SPECS.map((spec) => ({
    className: spec.className,
    instanceName: spec.instanceName,
    entries: parseNamedStringCodex(indexing, spec),
  }));
  const canonicalTraitCodexes = CANONICAL_TRAIT_CODEX_SPECS.map((spec) => ({
    className: spec.className,
    instanceName: spec.instanceName,
    entries: parseNamedStringCodex(sourceText(spec.source), spec),
  }));
  const counterNames = parseCounterCodexes(counting);
  const counterSizes = parseCounterSizes(counting);
  const compatV1 = applyLegacyV1CounterAliases(
    counterSizes.v1,
    counterNames.v1,
  );
  const compatV2Sizes = applyCompatV2CounterSizeAliases(
    counterSizes.v2,
    counterNames.v2,
  );

  const artifacts = {
    "packages/cesr/src/tables/matter.tables.generated.ts": emitMatterTables(
      matterSizes,
      matterNames,
    ),
    "packages/cesr/src/tables/matter.codexes.generated.ts": emitStringCodexes(
      matterCodexes,
    ),
    "packages/cesr/src/tables/matter.codex.generated.ts": emitCanonicalCodexModule(
      canonicalMatterCodexes,
    ),
    "packages/cesr/src/tables/indexer.tables.generated.ts": emitIndexerTables(
      indexerSizes,
      indexerNames,
    ),
    "packages/cesr/src/tables/indexer.codexes.generated.ts": emitStringCodexes(
      indexerCodexes,
    ),
    "packages/cesr/src/tables/indexer.codex.generated.ts": emitCanonicalCodexModule(
      canonicalIndexerCodexes,
    ),
    "packages/cesr/src/tables/trait.codex.generated.ts": emitCanonicalCodexModule(
      canonicalTraitCodexes,
    ),
    "packages/cesr/src/tables/counter.tables.generated.ts": emitCounterTables(
      compatV1.sizes,
      compatV2Sizes,
      compatV1.names,
      counterNames.v2,
    ),
  };

  const formattedArtifacts: Record<string, string> = {};
  for (const [path, content] of Object.entries(artifacts)) {
    formattedArtifacts[path] = await formatTypeScript(content);
  }

  return formattedArtifacts;
}

async function main(): Promise<void> {
  const artifacts = await buildGeneratedArtifacts();
  for (const [path, content] of Object.entries(artifacts)) {
    await Deno.writeTextFile(path, content);
  }

  await Deno.stdout.write(
    encoder.encode("Generated CESR tables from KERIpy source.\n"),
  );
}

if (import.meta.main) {
  await main();
}
