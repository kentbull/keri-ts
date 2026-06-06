import { parseBytes } from "../../core/parser-engine.ts";
import type { CliIo } from "../types.ts";

interface ValidateCliOptions {
  inPath?: string;
  framed: boolean;
  attachmentDispatchMode: "strict" | "compat";
  json: boolean;
}

interface ValidationErrorReport {
  name: string;
  message: string;
  offset?: number;
  context?: string;
}

interface ValidationReport {
  ok: boolean;
  source: string;
  bytes: number;
  frameCount: number;
  attachmentGroupCount: number;
  errorCount: number;
  errors: ValidationErrorReport[];
}

const VALIDATE_USAGE = "Usage: tephra validate [--in <path>] [--framed] [--compat] [--json]";

/** Parse `tephra validate` command-line flags without performing IO. */
function parseArgs(args: string[]): ValidateCliOptions {
  const out: ValidateCliOptions = {
    framed: false,
    attachmentDispatchMode: "strict",
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--in") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --in");
      out.inPath = next;
      i++;
      continue;
    }
    if (arg === "--framed") {
      out.framed = true;
      continue;
    }
    if (arg === "--compat") {
      out.attachmentDispatchMode = "compat";
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

/**
 * Convert parser errors into stable validation report entries.
 *
 * Parser error classes may carry useful location fields, but the CLI should not
 * expose entire internal error objects as JSON. This function keeps the stable
 * public fields and includes offset/context only when the parser supplied them.
 */
function describeError(error: Error): ValidationErrorReport {
  const detail: ValidationErrorReport = {
    name: error.name || "Error",
    message: error.message,
  };
  const maybeParserError = error as Error & {
    offset?: unknown;
    context?: unknown;
  };
  if (typeof maybeParserError.offset === "number") {
    detail.offset = maybeParserError.offset;
  }
  if (typeof maybeParserError.context === "string") {
    detail.context = maybeParserError.context;
  }
  return detail;
}

/**
 * Count frames, attachment groups, and parser errors for one input stream.
 *
 * `tephra validate` is strict by default because a validation command should fail
 * on ambiguous attachment dispatch. `--compat` intentionally relaxes that mode
 * for streams that still rely on legacy mixed-major attachment behavior.
 *
 * Empty input is reported as a validation failure even though the parser has no
 * malformed bytes to diagnose. A zero-frame stream is not useful evidence that a
 * CESR payload is valid.
 */
function validateBytes(
  bytes: Uint8Array,
  source: string,
  options: ValidateCliOptions,
): ValidationReport {
  const events = parseBytes(bytes, {
    framed: options.framed,
    attachmentDispatchMode: options.attachmentDispatchMode,
  });
  const frames = events.filter((event) => event.type === "frame");
  const errors = events
    .filter((event) => event.type === "error")
    .map((event) => describeError(event.error));
  const attachmentGroupCount = frames.reduce(
    (count, event) => count + event.frame.attachments.length,
    0,
  );

  if (frames.length === 0 && errors.length === 0) {
    errors.push({
      name: "NoFramesError",
      message: "No CESR frames parsed",
    });
  }

  return {
    ok: errors.length === 0,
    source,
    bytes: bytes.length,
    frameCount: frames.length,
    attachmentGroupCount,
    errorCount: errors.length,
    errors,
  };
}

/** Render successful human-readable validation output. */
function formatSuccess(report: ValidationReport): string {
  return [
    "CESR validation passed",
    `source: ${report.source}`,
    `bytes: ${report.bytes}`,
    `frames: ${report.frameCount}`,
    `attachment groups: ${report.attachmentGroupCount}`,
  ].join("\n");
}

/** Render human-readable validation failure output with per-error details. */
function formatFailure(report: ValidationReport): string {
  const lines = [
    "CESR validation failed",
    `source: ${report.source}`,
    `bytes: ${report.bytes}`,
    `frames: ${report.frameCount}`,
    `attachment groups: ${report.attachmentGroupCount}`,
    `errors: ${report.errorCount}`,
  ];
  for (const error of report.errors) {
    lines.push(`- ${error.name}: ${error.message}`);
    if (error.offset !== undefined) {
      lines.push(`  offset: ${error.offset}`);
    }
    if (error.context) {
      lines.push(`  context: ${error.context}`);
    }
  }
  return lines.join("\n");
}

/** Execute `tephra validate` against file input or stdin. */
export async function validateCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    await io.writeStdout(`${VALIDATE_USAGE}\n`);
    return 0;
  }

  try {
    const options = parseArgs(args);
    const source = options.inPath ? options.inPath : "stdin";
    const inputBytes = options.inPath
      ? await io.readFile(options.inPath)
      : await io.readStdin();
    const report = validateBytes(inputBytes, source, options);

    if (options.json) {
      await io.writeStdout(`${JSON.stringify(report)}\n`);
    } else if (report.ok) {
      await io.writeStdout(`${formatSuccess(report)}\n`);
    } else {
      await io.writeStderr(`${formatFailure(report)}\n`);
    }

    return report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await io.writeStderr(`tephra validate error: ${message}\n`);
    return 1;
  }
}
