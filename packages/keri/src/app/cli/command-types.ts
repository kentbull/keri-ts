import type { Operation } from "npm:effection@^3.6.0";

export type CommandArgs = Record<string, unknown>;

export interface CommandSelection {
  name: string;
  args: CommandArgs;
}

export type CommandDispatch = (selection: CommandSelection) => void;

export type CommandHandler = (args: CommandArgs) => Operation<void>;
