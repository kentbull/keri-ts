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
}

/**
 * Implements `tufa export`.
 *
 * Exports CESR-formatted KEL events for a named local AID.
 */
export function* exportCommand(args: Record<string, unknown>): Operation<void> {
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
      {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      },
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
