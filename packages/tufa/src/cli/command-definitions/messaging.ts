/** Commander registrations for EXN and exchange messaging commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register exchange and EXN messaging commands. */
export function registerMessagingCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerExchangeCmds(program, dispatch);
  registerExnCmds(program, dispatch);
}

function registerExchangeCmds(program: Command, dispatch: CommandDispatch): void {
  registerExnSendSubCmd(
    program.command("exchange").description(
      "Send peer-to-peer exchange messages",
    ),
    dispatch,
    "exchange.send",
  );
}

function registerExnCmds(program: Command, dispatch: CommandDispatch): void {
  registerExnSendSubCmd(
    program.command("exn").description("Send peer-to-peer EXN messages"),
    dispatch,
    "exn.send",
  );
}

function registerExnSendSubCmd(
  root: Command,
  dispatch: CommandDispatch,
  name: "exchange.send" | "exn.send",
): void {
  root
    .command("send")
    .description("Send one signed EXN message to a resolved remote identifier")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-s, --sender <alias>", "Local identifier alias (sender)")
    .requiredOption(
      "-r, --recipient <recipient>",
      "Recipient alias/contact or prefix",
    )
    .requiredOption("-R, --route <route>", "Exchange route")
    .option(
      "--topic <topic>",
      "Mailbox forwarding topic; defaults to the first segment of route",
    )
    .option(
      "--data <item>",
      "Payload item: key=value, JSON object string, or @file.json",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
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
        name,
        args: {
          name: options.name,
          sender: options.sender,
          recipient: options.recipient,
          route: options.route,
          topic: options.topic,
          data: options.data,
          base: options.base,
          compat: options.compat || false,
          cesrBodyMode: options.cesrBodyMode,
          outboxer: options.outboxer || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}
