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
    ["init", lazyCommand(() => import("../../../keri/src/app/cli/init.ts"), "initCommand")],
    ["incept", lazyCommand(() => import("../../../keri/src/app/cli/incept.ts"), "inceptCommand")],
    ["rotate", lazyCommand(() => import("../../../keri/src/app/cli/rotate.ts"), "rotateCommand")],
    ["sign", lazyCommand(() => import("../../../keri/src/app/cli/sign.ts"), "signCommand")],
    ["verify", lazyCommand(() => import("../../../keri/src/app/cli/verify.ts"), "verifyCommand")],
    ["query", lazyCommand(() => import("../../../keri/src/app/cli/query.ts"), "queryCommand")],
    ["interact", lazyCommand(() => import("../../../keri/src/app/cli/interact.ts"), "interactCommand")],
    [
      "challenge.generate",
      lazyCommand(
        () => import("../../../keri/src/app/cli/challenge.ts"),
        "challengeGenerateCommand",
      ),
    ],
    [
      "challenge.respond",
      lazyCommand(
        () => import("../../../keri/src/app/cli/challenge.ts"),
        "challengeRespondCommand",
      ),
    ],
    [
      "challenge.verify",
      lazyCommand(
        () => import("../../../keri/src/app/cli/challenge.ts"),
        "challengeVerifyCommand",
      ),
    ],
    [
      "exchange.send",
      lazyCommand(
        () => import("../../../keri/src/app/cli/exchange.ts"),
        "exchangeSendCommand",
      ),
    ],
    [
      "exn.send",
      lazyCommand(
        () => import("../../../keri/src/app/cli/exchange.ts"),
        "exchangeSendCommand",
      ),
    ],
    ["export", lazyCommand(() => import("../../../keri/src/app/cli/export.ts"), "exportCommand")],
    ["list", lazyCommand(() => import("../../../keri/src/app/cli/list.ts"), "listCommand")],
    ["aid", lazyCommand(() => import("../../../keri/src/app/cli/aid.ts"), "aidCommand")],
    ["ends.add", lazyCommand(() => import("../../../keri/src/app/cli/ends.ts"), "endsAddCommand")],
    ["loc.add", lazyCommand(() => import("../../../keri/src/app/cli/loc.ts"), "locAddCommand")],
    [
      "oobi.generate",
      lazyCommand(
        () => import("../../../keri/src/app/cli/oobi.ts"),
        "oobiGenerateCommand",
      ),
    ],
    [
      "oobi.resolve",
      lazyCommand(
        () => import("../../../keri/src/app/cli/oobi.ts"),
        "oobiResolveCommand",
      ),
    ],
    ["annotate", lazyCommand(() => import("../../../keri/src/app/cli/annotate.ts"), "annotateCommand")],
    [
      "benchmark.cesr",
      lazyCommand(
        () => import("../../../keri/src/app/cli/benchmark.ts"),
        "benchmarkCommand",
      ),
    ],
    ["db.dump", lazyCommand(() => import("../../../keri/src/app/cli/db-dump.ts"), "dumpEvts")],
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
