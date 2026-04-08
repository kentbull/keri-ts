/** Commander registrations for challenge/response commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register challenge-related commands. */
export function registerChallengeCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const challenge = program.command("challenge").description(
    "Generate, respond to, and verify challenge phrases",
  );

  challenge
    .command("generate")
    .description("Generate a cryptographically random challenge phrase")
    .option(
      "-s, --strength <bits>",
      "Approximate challenge entropy strength in bits",
      (value: string) => Number(value),
      128,
    )
    .option(
      "-o, --out <out>",
      "Output mode: json, string, or words",
      "json",
    )
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "challenge.generate",
        args: {
          strength: options.strength,
          out: options.out,
        },
      });
    });

  challenge
    .command("respond")
    .description(
      "Respond to challenge words by signing and sending an exchange message",
    )
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-r, --recipient <prefix>", "Recipient identifier prefix")
    .requiredOption(
      "-w, --words <words>",
      "Challenge words as JSON array or whitespace-separated string",
    )
    .option(
      "-t, --transport <transport>",
      "Transport mode: auto, direct, or indirect",
      "auto",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Use the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "challenge.respond",
        args: {
          name: options.name,
          alias: options.alias,
          recipient: options.recipient,
          words: options.words,
          transport: options.transport,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  challenge
    .command("verify")
    .description(
      "Verify that a signer responded with the expected challenge words",
    )
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-s, --signer <signer>",
      "Signer identifier prefix or exact contact alias",
    )
    .option("-w, --words <words>", "Expected challenge words")
    .option(
      "-g, --generate",
      "Generate challenge words, print them, and wait for a matching response",
      false,
    )
    .option(
      "--strength <bits>",
      "Cryptographic strength in bits when used with --generate",
      (value: string) => Number(value),
      128,
    )
    .option(
      "-o, --out <out>",
      "Generated challenge word output format: json, string, or words",
      "json",
    )
    .option(
      "--timeout <seconds>",
      "How long to wait for a matching response before failing",
      (value: string) => Number(value),
      10,
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Enable the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "challenge.verify",
        args: {
          name: options.name,
          signer: options.signer,
          words: options.words,
          generate: options.generate || false,
          strength: options.strength,
          out: options.out,
          timeout: options.timeout,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}
