/** Explicit KERI Foundation provider allocation commands; account activation stays separate. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addHabOption, addStoreOptions, dispatchArgs } from "./options.ts";
import { registerDispatchedCommand } from "./shared.ts";

/** Register public discovery and signed operations using an existing local onboarding signer. */
export function registerKfBootCmds(program: Command, dispatch: CommandDispatch): void {
  const infra = program.command("infra").description("Infrastructure provider operations");
  const kf = infra.command("kf").description("KERI Foundation discovery and hosted-resource allocation");
  registerDispatchedCommand(
    kf.command("discover")
      .description("Read provider discovery and allocation profiles")
      .requiredOption("--url <url>", "Base provider URL")
      .option("--timeout <seconds>", "Request deadline in seconds", "60"),
    dispatch,
    {
      name: "infra.kf.discover",
      load: () => import("../commands/kfboot.ts"),
      exportName: "kfBootDiscoverCommand",
      args: dispatchArgs,
    },
  );
  for (const operation of ["start", "status", "cancel"] as const) {
    const command = addHabOption(addStoreOptions(kf.command(operation)))
      .requiredOption("--url <url>", "Base provider URL")
      .option("--server-aid <aid>", "Expected provider signing AID")
      .option("--timeout <seconds>", "Request deadline in seconds", "60");
    command.options.find(option => option.long === "--alias")!.description =
      "Existing local onboarding signer alias; account authority remains separate";
    if (operation === "start") {
      command.description("Allocate an onboarding session; account activation remains a separate action")
        .requiredOption("--account <aid>", "Intended account AID; allocation does not activate it")
        .option("--account-alias <alias>", "Provider account display alias")
        .option("--profile <profile>", "Advertised witness allocation profile", "3-of-4");
    } else if (operation === "status") {
      command.description("Read signed facts for exactly one session or operation")
        .option("--session <id>", "Onboarding session ID; select this or --operation")
        .option("--operation <id>", "Allocation operation ID; select this or --session");
    } else {
      command.description("Cancel one onboarding session and report signed provider facts")
        .requiredOption("--session <id>", "Onboarding session ID")
        .option("--reason <text>", "Explicit cancellation reason");
    }
    registerDispatchedCommand(command, dispatch, {
      name: `infra.kf.${operation}`,
      load: () => import("../commands/kfboot.ts"),
      exportName: operation === "start"
        ? "kfBootStartCommand"
        : operation === "status"
        ? "kfBootStatusCommand"
        : "kfBootCancelCommand",
      args: dispatchArgs,
    });
  }
}
