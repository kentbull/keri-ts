import type { Operation } from "npm:effection@^3.6.0";
import type { CommandArgs, CommandHandler } from "../command-types.ts";
import { lazyCommand } from "./shared.ts";

/**
 * Build the canonical command-dispatch map used by CLI execution and tests.
 *
 * Keys must stay aligned with the names registered in `registerCmds()` so the
 * command parser and dispatch layer continue to agree on routing.
 */
export function createCmdHandlers(): Map<string, CommandHandler> {
  return new Map([
    ["init", lazyCommand(() => import("../init.ts"), "initCommand")],
    ["incept", lazyCommand(() => import("../incept.ts"), "inceptCommand")],
    ["rotate", lazyCommand(() => import("../rotate.ts"), "rotateCommand")],
    ["sign", lazyCommand(() => import("../sign.ts"), "signCommand")],
    ["verify", lazyCommand(() => import("../verify.ts"), "verifyCommand")],
    ["query", lazyCommand(() => import("../query.ts"), "queryCommand")],
    [
      "challenge.generate",
      lazyCommand(() => import("../challenge.ts"), "challengeGenerateCommand"),
    ],
    [
      "challenge.respond",
      lazyCommand(() => import("../challenge.ts"), "challengeRespondCommand"),
    ],
    [
      "challenge.verify",
      lazyCommand(() => import("../challenge.ts"), "challengeVerifyCommand"),
    ],
    [
      "exchange.send",
      lazyCommand(() => import("../exchange.ts"), "exchangeSendCommand"),
    ],
    [
      "exn.send",
      lazyCommand(() => import("../exchange.ts"), "exchangeSendCommand"),
    ],
    [
      "mailbox.start",
      lazyCommand(() => import("../mailbox.ts"), "mailboxStartCommand"),
    ],
    [
      "mailbox.add",
      lazyCommand(() => import("../mailbox.ts"), "mailboxAddCommand"),
    ],
    [
      "mailbox.remove",
      lazyCommand(() => import("../mailbox.ts"), "mailboxRemoveCommand"),
    ],
    [
      "mailbox.list",
      lazyCommand(() => import("../mailbox.ts"), "mailboxListCommand"),
    ],
    [
      "mailbox.update",
      lazyCommand(() => import("../mailbox.ts"), "mailboxUpdateCommand"),
    ],
    [
      "mailbox.debug",
      lazyCommand(() => import("../mailbox.ts"), "mailboxDebugCommand"),
    ],
    ["export", lazyCommand(() => import("../export.ts"), "exportCommand")],
    ["list", lazyCommand(() => import("../list.ts"), "listCommand")],
    ["aid", lazyCommand(() => import("../aid.ts"), "aidCommand")],
    ["agent", lazyCommand(() => import("../agent.ts"), "agentCommand")],
    ["ends.add", lazyCommand(() => import("../ends.ts"), "endsAddCommand")],
    ["loc.add", lazyCommand(() => import("../loc.ts"), "locAddCommand")],
    [
      "oobi.generate",
      lazyCommand(() => import("../oobi.ts"), "oobiGenerateCommand"),
    ],
    [
      "oobi.resolve",
      lazyCommand(() => import("../oobi.ts"), "oobiResolveCommand"),
    ],
    ["annotate", lazyCommand(() => import("../annotate.ts"), "annotateCommand")],
    [
      "benchmark.cesr",
      lazyCommand(() => import("../benchmark.ts"), "benchmarkCommand"),
    ],
    ["db.dump", lazyCommand(() => import("../db-dump.ts"), "dumpEvts")],
    ["interact", interactCommand],
    ["witness", witnessCommand],
  ]);
}

/** Placeholder handler for the future experimental interact command surface. */
// deno-lint-ignore require-yield
function* interactCommand(_args: CommandArgs): Operation<void> {
  console.log("tufa experimental interact command - coming soon!");
}

/** Placeholder handler for the future experimental witness command surface. */
// deno-lint-ignore require-yield
function* witnessCommand(_args: CommandArgs): Operation<void> {
  console.log("tufa experimental witness command - coming soon!");
}
