type AnnotColorKey =
  | "counter"
  | "group"
  | "body"
  | "signature"
  | "said"
  | "opaque"
  | "comment";

type ColorName =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

type AnnotColorConfig = Partial<Record<AnnotColorKey, ColorName>>;

const ANSI_CODES: Record<ColorName, string> = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
};

const RESET = "\x1b[0m";
const COLOR_KEYS: AnnotColorKey[] = [
  "counter",
  "group",
  "body",
  "signature",
  "said",
  "opaque",
  "comment",
];

const DEFAULT_COLORS: Record<AnnotColorKey, ColorName> = {
  counter: "cyan",
  group: "magenta",
  body: "green",
  signature: "yellow",
  said: "brightBlue",
  opaque: "brightRed",
  comment: "brightBlack",
};

const SAID_CAPTURE = /(said=)(\S+)/g;
const COMMENT_DELIM = " # ";

function isColorName(value: unknown): value is ColorName {
  return typeof value === "string" && value in ANSI_CODES;
}

function parseColorConfig(raw: string): AnnotColorConfig | null {
  const parsed: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/.exec(trimmed);
    if (!match) return null;

    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  const config: AnnotColorConfig = {};
  for (const key of COLOR_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!isColorName(value)) return null;
    config[key] = value;
  }
  return config;
}

function resolveConfigPath(homeDir: string): string | null {
  const basePath = `${homeDir}/.tufa`;
  const yamlPath = `${basePath}/annot-color.yaml`;
  const ymlPath = `${basePath}/annot-color.yml`;

  try {
    const stat = Deno.statSync(yamlPath);
    if (stat.isFile) return yamlPath;
  } catch {
    // Continue to .yml fallback
  }
  try {
    const stat = Deno.statSync(ymlPath);
    if (stat.isFile) return ymlPath;
  } catch {
    // No config file, use defaults
  }
  return null;
}

function readUserColorConfig(): AnnotColorConfig | null {
  const homeDir = Deno.env.get("HOME");
  if (!homeDir) return null;

  const configPath = resolveConfigPath(homeDir);
  if (!configPath) return null;

  try {
    return parseColorConfig(Deno.readTextFileSync(configPath));
  } catch {
    return null;
  }
}

function toAnsiColors(userConfig: AnnotColorConfig | null): Record<
  AnnotColorKey,
  string
> {
  const names: Record<AnnotColorKey, ColorName> = { ...DEFAULT_COLORS };
  if (userConfig) {
    for (const key of COLOR_KEYS) {
      const value = userConfig[key];
      if (value) names[key] = value;
    }
  }
  return {
    counter: ANSI_CODES[names.counter],
    group: ANSI_CODES[names.group],
    body: ANSI_CODES[names.body],
    signature: ANSI_CODES[names.signature],
    said: ANSI_CODES[names.said],
    opaque: ANSI_CODES[names.opaque],
    comment: ANSI_CODES[names.comment],
  };
}

function color(text: string, ansiCode: string): string {
  if (!text) return text;
  return `${ansiCode}${text}${RESET}`;
}

function colorizeComment(
  comment: string,
  colors: Record<AnnotColorKey, string>,
) {
  const saidTinted = comment.replace(
    SAID_CAPTURE,
    (_whole, prefix: string, said: string) => `${prefix}${color(said, colors.said)}`,
  );
  return color(saidTinted, colors.comment);
}

function colorizeValue(
  value: string,
  comment: string | null,
  colors: Record<AnnotColorKey, string>,
): string {
  const text = value.trim();
  if (!text) return value;

  if (comment && /opaque/i.test(comment)) {
    return color(value, colors.opaque);
  }
  if (comment && /(Indexer|Sig|Sigs|Signature)/.test(comment)) {
    return color(value, colors.signature);
  }
  if (comment && /(Group|count=|counter)/.test(comment)) {
    return color(value, colors.group);
  }
  if (comment && /SERDER/.test(comment)) {
    return color(value, colors.body);
  }
  if (/^[\[{]/.test(text)) {
    return color(value, colors.body);
  }
  if (/^-[A-Za-z0-9_-]+$/.test(text)) {
    return color(value, colors.counter);
  }

  return value;
}

function colorizeLine(
  line: string,
  colors: Record<AnnotColorKey, string>,
): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return color(line, colors.comment);
  }

  const idx = line.indexOf(COMMENT_DELIM);
  if (idx === -1) {
    return colorizeValue(line, null, colors);
  }

  const value = line.slice(0, idx);
  const comment = line.slice(idx + COMMENT_DELIM.length);
  const valueTinted = colorizeValue(value, comment, colors);
  const commentTinted = colorizeComment(comment, colors);
  return `${valueTinted}${COMMENT_DELIM}${commentTinted}`;
}

/**
 * Apply ANSI styling for CLI-only CESR annotation display.
 * This is intentionally presentation-only and must not alter persisted output.
 */
export function colorizeAnnotatedOutput(annotated: string): string {
  const colors = toAnsiColors(readUserColorConfig());
  const lines = annotated.split("\n");
  const out: string[] = [];
  let inPrettyJsonBody = false;

  // support colorizing lines even with --pretty arg
  for (const line of lines) {
    const idx = line.indexOf(COMMENT_DELIM);
    const value = idx === -1 ? line : line.slice(0, idx);
    const comment = idx === -1 ? null : line.slice(idx + COMMENT_DELIM.length);
    const trimmed = value.trim();

    if (comment && /SERDER/.test(comment)) {
      if (trimmed === "}" || trimmed === "]") {
        const valueTinted = color(value, colors.body);
        const commentTinted = colorizeComment(comment, colors);
        out.push(`${valueTinted}${COMMENT_DELIM}${commentTinted}`);
        inPrettyJsonBody = false;
        continue;
      }
      out.push(colorizeLine(line, colors));
      inPrettyJsonBody = false;
      continue;
    }

    if (inPrettyJsonBody && idx === -1) {
      out.push(color(line, colors.body));
      continue;
    }

    if (idx === -1 && (trimmed === "{" || trimmed === "[")) {
      inPrettyJsonBody = true;
      out.push(color(line, colors.body));
      continue;
    }

    out.push(colorizeLine(line, colors));
  }

  return out.join("\n");
}
