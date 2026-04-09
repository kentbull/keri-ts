/**
 * Tufa-owned top-level CLI command-tree coordinator.
 *
 * This file intentionally stays thin: topic modules own the concrete Commander
 * registrations, while `handlers.ts` owns the lazy dispatch map. Keeping the
 * coordinator small makes it easier to verify that parse-time command names and
 * run-time handler keys stay aligned.
 */
import { Command } from "npm:commander@^10.0.1";
import { registerChallengeCmds } from "./command-definitions/challenge.ts";
import { registerEndpointCmds } from "./command-definitions/endpoints.ts";
import { registerIdentityCmds } from "./command-definitions/identity.ts";
import { registerLifecycleCmds } from "./command-definitions/lifecycle.ts";
import { registerMailboxCmds } from "./command-definitions/mailbox.ts";
import { registerMessagingCmds } from "./command-definitions/messaging.ts";
import { registerNotificationCmds } from "./command-definitions/notifications.ts";
import { registerToolingCmds } from "./command-definitions/tooling.ts";
import { registerWitnessCmds } from "./command-definitions/witness.ts";
import type { CommandDispatch } from "./command-types.ts";

/** Register the Tufa CLI command tree on the provided Commander program. */
export function registerCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerLifecycleCmds(program, dispatch);
  registerIdentityCmds(program, dispatch);
  registerChallengeCmds(program, dispatch);
  registerMessagingCmds(program, dispatch);
  registerEndpointCmds(program, dispatch);
  registerNotificationCmds(program, dispatch);
  registerMailboxCmds(program, dispatch);
  registerWitnessCmds(program, dispatch);
  registerToolingCmds(program, dispatch);
}
