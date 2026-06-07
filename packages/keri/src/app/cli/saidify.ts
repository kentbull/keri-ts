import { type Operation } from "npm:effection@^3.6.0";
import { Saider } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";

interface SaidifyArgs {
  file?: string;
  label?: string;
}

/** Implement KLI-compatible `saidify`: mutate one JSON SAD file in place. */
export function* saidifyCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: SaidifyArgs = {
    file: args.file as string | undefined,
    label: args.label as string | undefined,
  };
  if (!commandArgs.file) {
    throw new ValidationError("File is required and cannot be empty.");
  }

  const raw = Deno.readTextFileSync(commandArgs.file);
  const sad = parseSad(raw, commandArgs.file);
  const { sad: saidified } = Saider.saidify(sad, {
    label: commandArgs.label ?? "d",
  });
  Deno.writeTextFileSync(commandArgs.file, keripyJsonDump(saidified));
}

function parseSad(raw: string, file: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ValidationError(
      `Error deserializing JSON file ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new ValidationError("Saidify input must be a JSON object.");
  }
  return parsed;
}

function keripyJsonDump(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return jsonScalar(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => keripyJsonDump(item)).join(", ")}]`;
  }
  return `{${
    Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${keripyJsonDump(item)}`).join(", ")
  }}`;
}

function jsonScalar(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new ValidationError("Saidify input cannot contain undefined values.");
  }
  return encoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
