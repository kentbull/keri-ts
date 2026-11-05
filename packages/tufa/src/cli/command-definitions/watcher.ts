/** Commander registration for a hosted watcher and its private provisioning listener. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { dispatchArgs } from "./options.ts";
import { registerDispatchedCommand } from "./shared.ts";

/** Keep public watcher service binding distinct from loopback-only provisioning. */
export function registerWatcherCmds(program: Command, dispatch: CommandDispatch): void {
  const watcher = program.command("watcher").description("Run a hosted key-state watcher");
  registerDispatchedCommand(
    watcher.command("backend")
      .description("Run a hosted-watcher backend with loopback-only provisioning")
      .requiredOption("-n, --name <name>", "Backend keystore name")
      .requiredOption("-u, --url <url>", "Advertised public HTTP(S) origin")
      .option("-H, --http <port>", "Public observation listener port", "5642")
      .option("--boot-port <port>", "Private loopback provisioning port", "5641")
      .option("--listen-host <host>", "Public observation listener bind host", "127.0.0.1")
      .option("--poll-interval <seconds>", "Positive key-state polling interval in seconds", "30")
      .option("-b, --base <base>", "Optional base path prefix")
      .option("--head-dir <dir>", "Directory override for database and keystore root")
      .option("-p, --passcode <passcode>", "Encryption passcode for keystore"),
    dispatch,
    {
      name: "watcher.backend",
      load: () => import("../commands/hosted-watcher.ts"),
      exportName: "hostedWatcherCommand",
      args: dispatchArgs,
    },
  );
}
