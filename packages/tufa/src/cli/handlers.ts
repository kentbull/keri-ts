/**
 * Tufa-owned lazy command-dispatch registry.
 *
 * Stage 3 ownership rule:
 * - the CLI runtime now lives in `tufa`
 * - long-lived host-serving commands resolve to `tufa` modules
 * - non-host commands may still delegate to `keri` implementations for now
 */
import { createCmdHandlers as createKeriCmdHandlers } from "../../../keri/src/app/cli/command-definitions.ts";
import { lazyCommand } from "../../../keri/src/app/cli/command-definitions/shared.ts";
import type { CommandHandler } from "../../../keri/src/app/cli/command-types.ts";

/** Build the canonical command-dispatch map used by the Tufa CLI runtime. */
export function createCmdHandlers(): Map<string, CommandHandler> {
  const handlers = createKeriCmdHandlers();
  handlers.set("agent", lazyCommand(() => import("./agent.ts"), "agentCommand"));
  handlers.set(
    "mailbox.start",
    lazyCommand(() => import("./mailbox.ts"), "mailboxStartCommand"),
  );
  handlers.set(
    "mailbox.add",
    lazyCommand(() => import("./mailbox.ts"), "mailboxAddCommand"),
  );
  handlers.set(
    "mailbox.remove",
    lazyCommand(() => import("./mailbox.ts"), "mailboxRemoveCommand"),
  );
  handlers.set(
    "mailbox.list",
    lazyCommand(() => import("./mailbox.ts"), "mailboxListCommand"),
  );
  handlers.set(
    "mailbox.update",
    lazyCommand(() => import("./mailbox.ts"), "mailboxUpdateCommand"),
  );
  handlers.set(
    "mailbox.debug",
    lazyCommand(() => import("./mailbox.ts"), "mailboxDebugCommand"),
  );
  handlers.set(
    "witness.start",
    lazyCommand(() => import("./witness.ts"), "witnessStartCommand"),
  );
  handlers.set(
    "witness.submit",
    lazyCommand(() => import("./witness.ts"), "witnessSubmitCommand"),
  );
  return handlers;
}
