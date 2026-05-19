/** Commander registrations for witness hosting and submission commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register witness commands. */
export function registerWitnessCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const witness = program.command("witness").description(
    "Run and interact with witness nodes",
  );

  witness
    .command("start")
    .description("Provision and run one combined witness+mailbox host")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local witness alias")
    .option("-u, --url <url>", "Advertised witness HTTP URL")
    .option("--tcp-url <url>", "Advertised witness TCP URL")
    .option("--datetime <time>", "Authoritative startup timestamp")
    .option("-c, --config-dir <dir>", "Directory override for configuration data")
    .option("--config-file <name>", "Witness startup config file or path")
    .option("-H, --http <port>", "Local HTTP port override")
    .option("-T, --tcp <port>", "Local TCP port override")
    .option("--listen-host <host>", "Local listen host override")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "witness.start",
        args: {
          name: options.name,
          alias: options.alias,
          url: options.url,
          tcpUrl: options.tcpUrl,
          datetime: options.datetime,
          configDir: options.configDir,
          configFile: options.configFile,
          http: options.http,
          tcp: options.tcp,
          listenHost: options.listenHost,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  witness
    .command("submit")
    .description("Submit the current event to witnesses and converge receipts")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .option("--force", "Resubmit even when the current event already has a full witness set", false)
    .option(
      "--receipt-endpoint",
      "Attempt to connect to witness receipt endpoint for witness receipts.",
      false,
    )
    .option(
      "-z, --authenticate",
      "Prompt the controller for authentication codes for each witness",
      false,
    )
    .option(
      "--code <code>",
      "<Witness AID>:<code> formatted witness auth codes",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "witness.submit",
        args: {
          name: options.name,
          alias: options.alias,
          force: options.force || false,
          endpoint: options.receiptEndpoint || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}
