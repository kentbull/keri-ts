import { discardFrame } from "../../core/frame.ts";
import { parse } from "../../parser/progressive.ts";
import type { CliIo } from "../types.ts";

/** Input selection and report format for streaming validation. */
interface ValidateCliOptions {
  /** Stream source file; omission selects stdin. */
  inPath?: string;
  /** Select machine-readable validation results. */
  json: boolean;
}

/** Public diagnostic fields from the first parser or storage failure. */
interface ValidationErrorReport {
  /** Error class name. */
  name: string;
  /** Human-readable failure reason. */
  message: string;
  /** Byte offset when supplied by the parser. */
  offset?: number;
  /** Parser-provided context when available. */
  context?: string;
}

/** Counts for delivered complete frames and actually pulled source bytes. */
interface ValidationReport {
  /** True only for a nonempty stream with no failure. */
  ok: boolean;
  /** Input path or stdin label. */
  source: string;
  /** Actually pulled input bytes, including failing read-ahead. */
  bytes: number;
  /** Complete frames delivered before termination. */
  frameCount: number;
  /** Hydrated leaf groups plus one aggregate ESSR entry per frame. */
  attachmentGroupCount: number;
  /** Zero or one terminal failure. */
  errorCount: number;
  /** First parser, source, or cleanup failure. */
  errors: ValidationErrorReport[];
}

/** Supported streaming validation flags. */
const VALIDATE_USAGE = "Usage: tephra validate [--in <path>] [--json]";

/** Parse `tephra validate` command-line flags without performing IO. */
function parseArgs(args: string[]): ValidateCliOptions {
  const out: ValidateCliOptions = {
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
 * Malformed attachments fail under the selected genus, including wrapper tails.
 *
 * Empty input is reported as a validation failure even though the parser has no
 * malformed bytes to diagnose. A zero-frame stream is not useful evidence that a
 * CESR payload is valid.
 */
async function validateSource(source: AsyncIterable<Uint8Array>, label: string): Promise<ValidationReport> {
  let bytes = 0;
  let frameCount = 0;
  let attachmentGroupCount = 0;
  const errors: ValidationErrorReport[] = [];
  /** Count only bytes actually pulled; a parser failure may stop before source EOF. */
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      bytes += chunk.length;
      yield chunk;
    }
  }
  try {
    for await (const frame of parse(counted())) {
      try {
        frameCount++;
        attachmentGroupCount += frame.attachments.length + (frame.essr ? 1 : 0);
      } finally {
        await discardFrame(frame);
      }
    }
  } catch (error) {
    errors.push(describeError(error instanceof Error ? error : new Error(String(error))));
  }
  if (frameCount === 0 && errors.length === 0) errors.push({ name: "NoFramesError", message: "No CESR frames parsed" });
  return {
    ok: errors.length === 0,
    source: label,
    bytes,
    frameCount,
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
    const report = await validateSource(io.read(options.inPath), source);

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
