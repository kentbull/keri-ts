import { createQueue, type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";

interface ExportArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  files?: boolean;
  ends?: boolean;
  help?: boolean;
}

/** Prints help text for `tufa export`. */
function printExportHelp() {
  console.log(`
tufa export - Export key events in CESR stream format

Usage: tufa export [options]

Options:
  --name, -n <name>           Keystore name
  --base, -b <base>           Optional base path prefix
  --head-dir <dir>            Directory override for database and keystore root (default fallback: ~/.tufa)
  --passcode, -p <passcode>   Keystore encryption passcode
  --alias, -a <alias>         Human readable alias for identifier (required)
  --files                     Export to files (default stdout)
  --ends                      Export service end points
  --help, -h                  Show this help message
`);
}

/**
 * Implements `tufa export`.
 *
 * Exports CESR-formatted KEL events for a named local AID.
 */
export function* exportCommand(args: Record<string, unknown>): Operation<void> {
  if (args.help || args.h) {
    printExportHelp();
    return;
  }

  const exportArgs: ExportArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    files: args.files as boolean | undefined,
    ends: args.ends as boolean | undefined,
  };

  if (!exportArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!exportArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  const cues = createQueue<
    { kin: string; count: number; mode: string },
    void
  >();

  const doer = yield* spawn(function* () {
    const hby = yield* setupHby(
      exportArgs.name!,
      exportArgs.base ?? "",
      exportArgs.passcode,
      false,
      exportArgs.headDirPath,
    );
    try {
      const hab = hby.habByName(exportArgs.alias!);
      if (!hab || !hab.pre) {
        throw new ValidationError(
          `No local AID found for alias ${exportArgs.alias}`,
        );
      }

      const encoder = new TextEncoder();
      const keyPrefix = encoder.encode(`${hab.pre}:`);
      const decoder = new TextDecoder();
      let count = 0;
      for (const [, value] of hby.db.getAllEvtsIter(keyPrefix)) {
        console.log(decoder.decode(value));
        count += 1;
      }
      cues.add({ kin: "export", count, mode: "native" });
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
  const cue = yield* cues.next();
  if (cue.done) return;
}
