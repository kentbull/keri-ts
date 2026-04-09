/**
 * Tufa-owned lazy command-dispatch registry.
 *
 * Stage 6 ownership rule:
 * - parse-time command registration and run-time dispatch both now live in
 *   `tufa`
 * - non-host commands may still delegate to reusable `keri` operation modules
 *   for now
 */
import { lazyCommand } from "./command-definitions/shared.ts";
import type { CommandHandler } from "./command-types.ts";

/** Build the canonical command-dispatch map used by the Tufa CLI runtime. */
export function createCmdHandlers(): Map<string, CommandHandler> {
  return new Map([
    ["init", lazyCommand(() => import("keri-ts/runtime"), "initCommand")],
    ["incept", lazyCommand(() => import("keri-ts/runtime"), "inceptCommand")],
    ["rotate", lazyCommand(() => import("keri-ts/runtime"), "rotateCommand")],
    ["sign", lazyCommand(() => import("keri-ts/runtime"), "signCommand")],
    ["verify", lazyCommand(() => import("keri-ts/runtime"), "verifyCommand")],
    ["query", lazyCommand(() => import("keri-ts/runtime"), "queryCommand")],
    ["interact", lazyCommand(() => import("keri-ts/runtime"), "interactCommand")],
    [
      "challenge.generate",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "challengeGenerateCommand",
      ),
    ],
    [
      "challenge.respond",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "challengeRespondCommand",
      ),
    ],
    [
      "challenge.verify",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "challengeVerifyCommand",
      ),
    ],
    [
      "exchange.send",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "exchangeSendCommand",
      ),
    ],
    [
      "exn.send",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "exchangeSendCommand",
      ),
    ],
    ["export", lazyCommand(() => import("keri-ts/runtime"), "exportCommand")],
    ["list", lazyCommand(() => import("keri-ts/runtime"), "listCommand")],
    ["aid", lazyCommand(() => import("keri-ts/runtime"), "aidCommand")],
    ["ends.add", lazyCommand(() => import("keri-ts/runtime"), "endsAddCommand")],
    ["loc.add", lazyCommand(() => import("keri-ts/runtime"), "locAddCommand")],
    [
      "oobi.generate",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "oobiGenerateCommand",
      ),
    ],
    [
      "oobi.resolve",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "oobiResolveCommand",
      ),
    ],
    ["annotate", lazyCommand(() => import("keri-ts/runtime"), "annotateCommand")],
    [
      "benchmark.cesr",
      lazyCommand(
        () => import("keri-ts/runtime"),
        "benchmarkCommand",
      ),
    ],
    ["db.dump", lazyCommand(() => import("keri-ts/runtime"), "dumpEvts")],
    ["agent", lazyCommand(() => import("./agent.ts"), "agentCommand")],
    ["mailbox.start", lazyCommand(() => import("./mailbox.ts"), "mailboxStartCommand")],
    ["mailbox.add", lazyCommand(() => import("./mailbox.ts"), "mailboxAddCommand")],
    ["mailbox.remove", lazyCommand(() => import("./mailbox.ts"), "mailboxRemoveCommand")],
    ["mailbox.list", lazyCommand(() => import("./mailbox.ts"), "mailboxListCommand")],
    ["mailbox.update", lazyCommand(() => import("./mailbox.ts"), "mailboxUpdateCommand")],
    ["mailbox.debug", lazyCommand(() => import("./mailbox.ts"), "mailboxDebugCommand")],
    ["witness.start", lazyCommand(() => import("./witness.ts"), "witnessStartCommand")],
    ["witness.submit", lazyCommand(() => import("./witness.ts"), "witnessSubmitCommand")],
  ]);
}
