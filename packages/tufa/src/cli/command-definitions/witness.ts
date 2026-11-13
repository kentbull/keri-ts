/** Commander registrations for witness hosting and submission commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addWitnessAuthOptions, dispatchArgs, witnessAuthArgs } from "./options.ts";
import { registerDispatchedCommand } from "./shared.ts";

/**
 * Register witness commands.
 *
 * `witness start` owns host provisioning, while `witness submit` owns
 * controller-to-witness receipt convergence for an existing controller AID.
 */
export function registerWitnessCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const witness = program.command("witness").description(
    "Run and interact with witness nodes",
  );

  registerDispatchedCommand(
    witness.command("backend")
      .description("Run a hosted-witness backend with loopback-only provisioning")
      .requiredOption("-n, --name <name>", "Backend keystore name")
      .requiredOption("-u, --url <url>", "Advertised public HTTP(S) origin")
      .option("-H, --http <port>", "Public receipt listener port", "5632")
      .option("--boot-port <port>", "Private loopback provisioning port", "5631")
      .option("--listen-host <host>", "Public receipt listener bind host", "127.0.0.1")
      .option("-b, --base <base>", "Optional base path prefix")
      .option("--head-dir <dir>", "Directory override for database and keystore root")
      .option("-p, --passcode <passcode>", "Encryption passcode for keystore"),
    dispatch,
    {
      name: "witness.backend",
      load: () => import("../commands/hosted-witness.ts"),
      exportName: "hostedWitnessCommand",
      args: dispatchArgs,
    },
  );

  registerDispatchedCommand(
    witness
      .command("start")
      .description("Provision and run one combined witness+mailbox host")
      .requiredOption("-n, --name <name>", "Keystore name")
      .requiredOption("-a, --alias <alias>", "Local witness alias")
      .option("-u, --url <url>", "Advertised witness HTTP URL")
      .option("--tcp-url <url>", "Advertised witness TCP URL")
      .option("--datetime <time>", "Authoritative startup timestamp")
      .option(
        "-c, --config-dir <dir>",
        "Directory override for configuration data",
      )
      .option("--config-file <name>", "Witness startup config file or path")
      .option("-H, --http <port>", "Local HTTP port override")
      .option("-T, --tcp <port>", "Local TCP port override")
      .option("--listen-host <host>", "Local listen host override")
      .option(
        "--version <version>",
        "KERI protocol version for a newly created witness AID, such as 1.0 or 2.0 (default 2.0)",
      )
      .option("-b, --base <base>", "Optional base path prefix")
      .option("--compat", "Use KERIpy compatibility-mode path layout")
      .option(
        "--head-dir <dir>",
        "Directory override for database and keystore root (default fallback: ~/.tufa)",
      )
      .option("-p, --passcode <passcode>", "Encryption passcode for keystore"),
    dispatch,
    {
      name: "witness.start",
      load: () => import("../commands/witness.ts"),
      exportName: "witnessStartCommand",
      args: (options: Record<string, unknown>) => ({
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
        version: options.version,
        base: options.base,
        compat: options.compat || false,
        headDirPath: options.headDir,
        passcode: options.passcode,
      }),
    },
  );

  registerDispatchedCommand(
    addWitnessAuthOptions(
      witness
        .command("submit")
        .description("Submit the current event to witnesses and converge receipts")
        .requiredOption("-n, --name <name>", "Keystore name")
        .requiredOption("-a, --alias <alias>", "Local identifier alias")
        .option(
          "--force",
          "Resubmit even when the current event already has a full witness set",
          false,
        )
        .option("-b, --base <base>", "Optional base path prefix")
        .option("--compat", "Use KERIpy compatibility-mode path layout")
        .option(
          "--head-dir <dir>",
          "Directory override for database and keystore root (default fallback: ~/.tufa)",
        )
        .option("-p, --passcode <passcode>", "Encryption passcode for keystore"),
      true,
    ),
    dispatch,
    {
      name: "witness.submit",
      load: () => import("../commands/witness.ts"),
      exportName: "witnessSubmitCommand",
      args: (options: Record<string, unknown>) => ({
        name: options.name,
        alias: options.alias,
        force: options.force || false,
        ...witnessAuthArgs(options),
        base: options.base,
        compat: options.compat || false,
        headDirPath: options.headDir,
        passcode: options.passcode,
      }),
    },
  );
}
