/**
 * Shared lazy-load plumbing for CLI command execution.
 *
 * KERIpy correspondence:
 * - KERIpy imports most CLI handlers eagerly because argparse/HIO startup
 *   costs differ
 *
 * `keri-ts` difference:
 * - `tufa` keeps help/version startup light by delaying heavy imports until one
 *   command is actually selected
 */
import { action, type Operation } from "npm:effection@^3.6.0";
import type { CommandArgs, CommandHandler } from "../command-types.ts";

/** Shape used for lazily imported command modules before handler extraction. */
type CommandModule = Record<string, unknown>;

/**
 * Bridge a promise-backed dynamic import into an Effection operation.
 *
 * This keeps CLI startup free of eager command-module imports while preserving
 * the existing generator-based handler contract.
 */
function* loadModule<TModule extends CommandModule>(
  load: () => Promise<TModule>,
): Operation<TModule> {
  return yield* action((resolve, reject) => {
    load()
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
    return () => {};
  });
}

/**
 * Lazily resolve a command handler from its module only when selected.
 *
 * This prevents `tufa --help` / `tufa --version` from importing heavy command
 * dependencies like CESR or LMDB on startup.
 */
export function lazyCommand<TModule extends CommandModule>(
  load: () => Promise<TModule>,
  exportName: string,
): CommandHandler {
  return function*(args: CommandArgs): Operation<void> {
    const module = yield* loadModule(load);
    const handler = module[exportName];
    if (typeof handler !== "function") {
      throw new Error(`Expected ${exportName} to be a command handler export`);
    }
    yield* (handler as CommandHandler)(args);
  };
}
