import type { Operation } from "effection";

/** Basic K/V args for command dispatch. */
export type CommandArgs = Record<string, unknown>;

/** Parsed command selection emitted by Commander registration callbacks. */
export interface CommandSelection {
  name: string;
  args: CommandArgs;
}

/** Dispatch one selected command name with its parsed args. */
export type CommandDispatch = (selection: CommandSelection) => void;

/** Generator-based command handler shape used by the Tufa CLI runtime. */
export type CommandHandler = (args: CommandArgs) => Operation<void>;
