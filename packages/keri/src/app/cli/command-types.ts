import type { Operation } from "npm:effection@^3.6.0";

/**
 * Basic K/V args for command
 */
export type CommandArgs = Record<string, unknown>;

/**
 * Defines dispatch by name data interface
 */
export interface CommandSelection {
  name: string;
  args: CommandArgs;
}

/**
 * dispatches command by name with args
 */
export type CommandDispatch = (selection: CommandSelection) => void;

/**
 * takes command args, returns an Effection operation
 */
export type CommandHandler = (args: CommandArgs) => Operation<void>;
