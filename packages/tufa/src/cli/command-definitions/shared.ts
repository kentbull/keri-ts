/**
 * Shared lazy-load plumbing for CLI command execution.
 *
 * `tufa` keeps help/version startup light by delaying heavy imports until one
 * command is actually selected.
 */
import { action, type Operation } from "effection";
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

/** Entry describing a command name to its lazy handler implementation. */
type CommandHandlerEntry = {
  name: string;
  load: () => Promise<any>;
  exportName: string;
};

const commandHandlerEntries: CommandHandlerEntry[] = [];

/**
 * Register a command name to its lazy-loaded handler.
 *
 * Called from command definition sites so that parse-time registration
 * (Commander) and runtime dispatch share a single source of command names.
 * This eliminates the previous hand-maintained duplicate tree in handlers.ts.
 */
export function registerCommandHandler(
  name: string,
  load: () => Promise<any>,
  exportName: string,
): void {
  commandHandlerEntries.push({ name, load, exportName });
}

/** Build the canonical command-dispatch map used by the Tufa CLI runtime. */
export function createCmdHandlers(): Map<string, CommandHandler> {
  // Lazy imports keep the runnable `tufa` package as the dispatch owner while
  // still allowing reusable library CLI operations to live in `keri-ts/cli`.
  const map = new Map<string, CommandHandler>();
  for (const entry of commandHandlerEntries) {
    map.set(entry.name, lazyCommand(entry.load, entry.exportName));
  }
  return map;
}
