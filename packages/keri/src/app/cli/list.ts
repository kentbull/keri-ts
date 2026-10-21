import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { withExistingHabery } from "./common/context.ts";
import { parseBooleanOption, parseStringOption } from "./common/parsing.ts";

interface ListArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
}

/** Implements `tufa list`. */
export function* listCommand(args: Record<string, unknown>): Operation<void> {
  const listArgs: ListArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
  };

  if (!listArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }

  yield* withExistingHabery(
    listArgs,
    {
      compat: listArgs.compat ?? false,
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    },
    function*({ hby }) {
      for (const hab of hby.habs.values()) {
        console.log(`${hab.name} (${hab.pre})`);
      }
    },
  );
}
