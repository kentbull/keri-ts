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
  // Lazy imports keep the runnable `tufa` package as the dispatch owner while
  // still allowing reusable library CLI operations to live in `keri-ts/cli`.
  return new Map([
    ["init", lazyCommand(() => import("keri-ts/cli"), "initCommand")],
    ["incept", lazyCommand(() => import("keri-ts/cli"), "inceptCommand")],
    ["rotate", lazyCommand(() => import("keri-ts/cli"), "rotateCommand")],
    [
      "delegate.confirm",
      lazyCommand(() => import("keri-ts/cli"), "delegateConfirmCommand"),
    ],
    ["sign", lazyCommand(() => import("keri-ts/cli"), "signCommand")],
    ["verify", lazyCommand(() => import("keri-ts/cli"), "verifyCommand")],
    ["query", lazyCommand(() => import("keri-ts/cli"), "queryCommand")],
    [
      "interact",
      lazyCommand(() => import("keri-ts/cli"), "interactCommand"),
    ],
    [
      "challenge.generate",
      lazyCommand(
        () => import("keri-ts/cli"),
        "challengeGenerateCommand",
      ),
    ],
    [
      "challenge.respond",
      lazyCommand(
        () => import("keri-ts/cli"),
        "challengeRespondCommand",
      ),
    ],
    [
      "challenge.verify",
      lazyCommand(
        () => import("keri-ts/cli"),
        "challengeVerifyCommand",
      ),
    ],
    [
      "exchange.send",
      lazyCommand(
        () => import("keri-ts/cli"),
        "exchangeSendCommand",
      ),
    ],
    [
      "exn.send",
      lazyCommand(
        () => import("keri-ts/cli"),
        "exchangeSendCommand",
      ),
    ],
    ["export", lazyCommand(() => import("keri-ts/cli"), "exportCommand")],
    ["list", lazyCommand(() => import("keri-ts/cli"), "listCommand")],
    ["aid", lazyCommand(() => import("keri-ts/cli"), "aidCommand")],
    [
      "ends.add",
      lazyCommand(() => import("keri-ts/cli"), "endsAddCommand"),
    ],
    ["loc.add", lazyCommand(() => import("keri-ts/cli"), "locAddCommand")],
    [
      "oobi.generate",
      lazyCommand(
        () => import("keri-ts/cli"),
        "oobiGenerateCommand",
      ),
    ],
    [
      "oobi.resolve",
      lazyCommand(
        () => import("keri-ts/cli"),
        "oobiResolveCommand",
      ),
    ],
    [
      "oobi.request",
      lazyCommand(
        () => import("keri-ts/cli"),
        "oobiRequestCommand",
      ),
    ],
    [
      "notifications.list",
      lazyCommand(
        () => import("keri-ts/cli"),
        "notificationsListCommand",
      ),
    ],
    [
      "notifications.mark-read",
      lazyCommand(
        () => import("keri-ts/cli"),
        "notificationsMarkReadCommand",
      ),
    ],
    [
      "notifications.remove",
      lazyCommand(
        () => import("keri-ts/cli"),
        "notificationsRemoveCommand",
      ),
    ],
    [
      "annotate",
      lazyCommand(() => import("keri-ts/cli"), "annotateCommand"),
    ],
    [
      "benchmark.cesr",
      lazyCommand(
        () => import("keri-ts/cli"),
        "benchmarkCommand",
      ),
    ],
    ["db.dump", lazyCommand(() => import("keri-ts/cli"), "dumpEvts")],
    [
      "vc.schema.import",
      lazyCommand(() => import("keri-ts/cli"), "vcSchemaImportCommand"),
    ],
    [
      "vc.registry.incept",
      lazyCommand(() => import("keri-ts/cli"), "vcRegistryInceptCommand"),
    ],
    [
      "vc.registry.list",
      lazyCommand(() => import("keri-ts/cli"), "vcRegistryListCommand"),
    ],
    [
      "vc.registry.status",
      lazyCommand(() => import("keri-ts/cli"), "vcRegistryStatusCommand"),
    ],
    ["vc.create", lazyCommand(() => import("keri-ts/cli"), "vcCreateCommand")],
    ["vc.list", lazyCommand(() => import("keri-ts/cli"), "vcListCommand")],
    ["vc.export", lazyCommand(() => import("keri-ts/cli"), "vcExportCommand")],
    ["vc.import", lazyCommand(() => import("keri-ts/cli"), "vcImportCommand")],
    ["vc.revoke", lazyCommand(() => import("keri-ts/cli"), "vcRevokeCommand")],
    ["ipex.apply", lazyCommand(() => import("keri-ts/cli"), "ipexApplyCommand")],
    ["ipex.offer", lazyCommand(() => import("keri-ts/cli"), "ipexOfferCommand")],
    ["ipex.agree", lazyCommand(() => import("keri-ts/cli"), "ipexAgreeCommand")],
    ["ipex.grant", lazyCommand(() => import("keri-ts/cli"), "ipexGrantCommand")],
    ["ipex.admit", lazyCommand(() => import("keri-ts/cli"), "ipexAdmitCommand")],
    ["ipex.spurn", lazyCommand(() => import("keri-ts/cli"), "ipexSpurnCommand")],
    ["ipex.list", lazyCommand(() => import("keri-ts/cli"), "ipexListCommand")],
    ["ipex.join", lazyCommand(() => import("keri-ts/cli"), "ipexJoinCommand")],
    ["agent", lazyCommand(() => import("./agent.ts"), "agentCommand")],
    [
      "mailbox.start",
      lazyCommand(() => import("./mailbox.ts"), "mailboxStartCommand"),
    ],
    [
      "mailbox.add",
      lazyCommand(() => import("./mailbox.ts"), "mailboxAddCommand"),
    ],
    [
      "mailbox.remove",
      lazyCommand(() => import("./mailbox.ts"), "mailboxRemoveCommand"),
    ],
    [
      "mailbox.list",
      lazyCommand(() => import("./mailbox.ts"), "mailboxListCommand"),
    ],
    [
      "mailbox.update",
      lazyCommand(() => import("./mailbox.ts"), "mailboxUpdateCommand"),
    ],
    [
      "mailbox.debug",
      lazyCommand(() => import("./mailbox.ts"), "mailboxDebugCommand"),
    ],
    [
      "witness.start",
      lazyCommand(() => import("./witness.ts"), "witnessStartCommand"),
    ],
    [
      "witness.submit",
      lazyCommand(() => import("./witness.ts"), "witnessSubmitCommand"),
    ],
  ]);
}
