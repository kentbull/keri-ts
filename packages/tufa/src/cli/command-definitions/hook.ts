/** Commander registrations for hook operations; command adapters own effects. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { registerDispatchedCommand } from "./shared.ts";

/** Register the webhook demo utility; execution remains with its lazily loaded command adapter. */
export function registerHookCmds(program: Command, dispatch: CommandDispatch): void {
  const hook = program.command("hook").description("Webhook target utilities");

  registerDispatchedCommand(
    hook
      .command("demo")
      .description("Launch a sample verifier webhook target")
      .option(
        "-p, --http <port>",
        "Port on which to listen for webhook events",
        "9923",
      ),
    dispatch,
    {
      name: "hook.demo",
      load: () => import("../commands/hook.ts"),
      exportName: "hookDemoCommand",
      args: (options: Record<string, unknown>) => ({ http: options.http }),
    },
  );
}
