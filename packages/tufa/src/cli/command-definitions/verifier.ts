/** Commander registrations for verifier operations; command adapters own effects. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addGvrsnOption, addStoreOptions, dispatchArgs } from "./options.ts";
import { registerDispatchedCommand } from "./shared.ts";

/** Register verifier-agent policy and timing inputs without opening stores while constructing help. */
export function registerVerifierCmds(program: Command, dispatch: CommandDispatch): void {
  const verifier = program.command("verifier").description("Verifier agent operations");

  registerDispatchedCommand(
    addGvrsnOption(addStoreOptions(
      verifier.command("run")
        .description("Process verifier grants, revocations, and webhook delivery")
        .requiredOption("--hook <url>", "Webhook URL")
        .option("--config <file>", "Verifier schema validator config JSON")
        .option("--once", "Process one bounded verifier turn", false)
        .option("--interval-ms <ms>", "Loop interval in milliseconds")
        .option("--timeout-ms <ms>", "Escrow timeout in milliseconds"),
    )),
    dispatch,
    {
      name: "verifier.run",
      load: () => import("../commands/verifier.ts"),
      exportName: "verifierRunCommand",
      args: dispatchArgs,
    },
  );
}
