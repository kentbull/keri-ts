/**
 * Reusable Commander option groups and arg normalizers for Tufa command definitions.
 *
 * These helpers reduce repetitive option boilerplate across lifecycle, credentials,
 * mailbox, and other definition modules while preserving exact KLI-compatible flag
 * names, help text, coercion, and defaults.
 *
 * Part of the P0 clean-architecture work: command definitions should read as specs
 * or use named groups rather than hand-written walls of options.
 */
import { Command } from "npm:commander@^10.0.1";

export function collectOption(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

export function addStoreOptions(cmd: Command): Command {
  return cmd
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore");
}

export function addHabOption(cmd: Command): Command {
  return cmd.requiredOption(
    "-a, --alias <alias>",
    "Human readable alias for the local identifier",
  );
}

export function addDeliveryOptions(cmd: Command): Command {
  return cmd.option("--delivery <mode>", "Delivery mode: auto, direct, or indirect");
}

export function addGvrsnOption(cmd: Command): Command {
  return cmd.option(
    "--gvrsn <version>",
    "Attachment counter genus version: 1.0 or 2.0",
  );
}

/** Normalize common option renames (headDir -> headDirPath, approvalTimeout, etc.). */
export function dispatchArgs(options: Record<string, unknown>): Record<string, unknown> {
  const { headDir, approvalTimeout, ...rest } = options;
  return {
    ...rest,
    headDirPath: headDir,
    ...(approvalTimeout === undefined ? {} : { approvalTimeoutSeconds: approvalTimeout }),
  };
}
