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
        .option("--acdc-v2", "Use retained ACDC v2 views and configured observer standing")
        .option("-a, --alias <alias>", "Local source-query signer for ACDC v2 verification")
        .option("--observer <url>", "Configured HTTPS observer cache URL")
        .option("--observer-ca <file>", "Absolute trusted CA bundle")
        .option("--observer-cert-name <dns>", "Explicit DNS certificate identity for an IP URL")
        .option("--maximum-age-ms <ms>", "Maximum configured-source observation age (default: 15000)")
        .option("--source-timeout-ms <ms>", "Finite source request deadline (default: 5000)")
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
