import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { dgKey } from "../../db/core/keys.ts";
import { withExistingHab } from "./common/context.ts";
import { parseBooleanOption, parseStringOption } from "./common/parsing.ts";

interface ExportArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  files?: boolean;
  ends?: boolean;
}

/**
 * Implements `tufa export`.
 *
 * Exports CESR-formatted KEL events for a named local AID.
 */
export function* exportCommand(args: Record<string, unknown>): Operation<void> {
  const exportArgs: ExportArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    files: parseBooleanOption(args.files, "files"),
    ends: parseBooleanOption(args.ends, "ends"),
  };

  if (!exportArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!exportArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  yield* withExistingHab(
    exportArgs,
    exportArgs.alias,
    {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    },
    function*({ hby, hab }) {
      const decoder = new TextDecoder();
      const kever = hby.db.getKever(hab.pre);
      if (kever?.delegated) {
        const estSaid = kever.lastEst.d || kever.said;
        const chain = [...hby.db.cloneDelegation(kever)];
        if (
          !estSaid || !hby.db.aess.get(dgKey(hab.pre, estSaid))
          || chain.length === 0
        ) {
          throw new ValidationError(
            `Delegated export for ${hab.pre} requires a locally known approving delegation chain.`,
          );
        }
        for (const msg of chain) {
          console.log(decoder.decode(msg));
        }
      }
      for (const msg of hby.db.clonePreIter(hab.pre)) {
        console.log(decoder.decode(msg));
      }
    },
  );
}
