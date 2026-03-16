import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";

interface ListArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
}

/** Implements `tufa list`. */
export function* listCommand(args: Record<string, unknown>): Operation<void> {
  const listArgs: ListArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
  };

  if (!listArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }

  const doer = yield* spawn(function* () {
    const hby = yield* setupHby(
      listArgs.name!,
      listArgs.base ?? "",
      listArgs.passcode,
      false,
      listArgs.headDirPath,
    );
    try {
      for (const hab of hby.habs.values()) {
        console.log(`${hab.name} (${hab.pre})`);
      }
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
}
