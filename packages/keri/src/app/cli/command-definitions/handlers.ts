/**
 * Lazy command-dispatch registry for the `tufa` CLI.
 *
 * The string keys here are part of the CLI architecture contract: Commander
 * actions emit these names, and the main CLI runtime uses them to resolve the
 * right generator-based command handler.
 */
import type { CommandHandler } from "../command-types.ts";
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
    [
      "interact",
      lazyCommand(() => import("../interact.ts"), "interactCommand"),
    ],
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
    ["export", lazyCommand(() => import("../export.ts"), "exportCommand")],
    ["list", lazyCommand(() => import("../list.ts"), "listCommand")],
    ["aid", lazyCommand(() => import("../aid.ts"), "aidCommand")],
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
    [
      "annotate",
      lazyCommand(() => import("../annotate.ts"), "annotateCommand"),
    ],
    [
      "benchmark.cesr",
      lazyCommand(() => import("../benchmark.ts"), "benchmarkCommand"),
    ],
    ["db.dump", lazyCommand(() => import("../db-dump.ts"), "dumpEvts")],
  ]);
}
