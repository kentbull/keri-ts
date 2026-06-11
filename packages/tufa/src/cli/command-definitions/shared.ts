/**
 * Shared lazy-load plumbing for CLI command execution.
 *
 * `tufa` keeps help/version startup light by delaying heavy imports until one
 * command is actually selected.
 */
import { action, type Operation } from "effection";
import { type Command } from "npm:commander@^10.0.1";
import type { CommandArgs, CommandDispatch, CommandHandler } from "../command-types.ts";
import { dispatchArgs } from "./options.ts";

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

type DispatchedCommandOptions = CommandHandlerEntry & {
  args: (...actionArgs: any[]) => CommandArgs;
};

const commandHandlerEntries = new Map<string, CommandHandlerEntry>();

/**
 * Register a command name to its lazy-loaded handler.
 *
 * Called from command definition sites so that parse-time registration
 * (Commander) and runtime dispatch share a single source of command names.
 * This eliminates the previous hand-maintained duplicate tree in handlers.ts.
 */
function registerCommandHandler(
  name: string,
  load: () => Promise<any>,
  exportName: string,
): void {
  commandHandlerEntries.set(name, { name, load, exportName });
}

/** Bind one Commander command to both parse-time dispatch and lazy runtime handling. */
export function registerDispatchedCommand(
  command: Command,
  dispatch: CommandDispatch,
  options: DispatchedCommandOptions,
): Command {
  command.action((...actionArgs: any[]) => {
    dispatch({
      name: options.name,
      args: options.args(...actionArgs),
    });
  });
  registerCommandHandler(options.name, options.load, options.exportName);
  return command;
}

/** Bind a Commander command to a lazy handler exported by `keri-ts/cli`. */
export function registerKeriCliCommand(
  command: Command,
  dispatch: CommandDispatch,
  name: string,
  exportName: string,
  args: (...actionArgs: any[]) => CommandArgs = dispatchArgs,
): Command {
  return registerDispatchedCommand(command, dispatch, {
    name,
    load: () => import("keri-ts/cli"),
    exportName,
    args,
  });
}

/** Build the canonical command-dispatch map used by the Tufa CLI runtime. */
export function createCmdHandlers(): Map<string, CommandHandler> {
  // Lazy imports keep the runnable `tufa` package as the dispatch owner while
  // still allowing reusable library CLI operations to live in `keri-ts/cli`.
  const map = new Map<string, CommandHandler>();
  for (const entry of commandHandlerEntries.values()) {
    map.set(entry.name, lazyCommand(entry.load, entry.exportName));
  }
  return map;
}
