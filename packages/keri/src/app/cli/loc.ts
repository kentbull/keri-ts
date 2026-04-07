import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../agent-runtime.ts";
import { setupHby } from "./common/existing.ts";

/** Parsed arguments for `tufa loc add`. */
interface LocAddArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  url?: string;
  eid?: string;
  time?: string;
  compat?: boolean;
}

/**
 * Implement `tufa loc add` through the shared local runtime.
 *
 * This mirrors KERIpy's `kli loc add` flow:
 * - reopen one local habery
 * - build a signed `/loc/scheme` reply from the selected habitat
 * - feed it back through parser -> routing -> reply acceptance
 * - confirm accepted `locs.` / `lans.` state before returning
 */
export function* locAddCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: LocAddArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    url: args.url as string | undefined,
    eid: args.eid as string | undefined,
    time: args.time as string | undefined,
    compat: args.compat as boolean | undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!commandArgs.url) {
    throw new ValidationError("URL is required and cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(commandArgs.url);
  } catch {
    throw new ValidationError(`Invalid URL ${commandArgs.url}`);
  }
  const scheme = parsed.protocol.replace(/:$/, "");
  if (!scheme) {
    throw new ValidationError(`URL ${commandArgs.url} is missing a scheme.`);
  }

  const hby = yield* setupHby(
    commandArgs.name,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
    },
  );

  try {
    const hab = hby.habByName(commandArgs.alias);
    if (!hab) {
      throw new ValidationError(`No local AID found for alias ${commandArgs.alias}`);
    }

    const eid = commandArgs.eid ?? hab.pre;
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    ingestKeriBytes(
      runtime,
      hab.makeLocScheme(commandArgs.url, eid, scheme, commandArgs.time),
    );

    for (let i = 0; i < 4; i += 1) {
      yield* processRuntimeTurn(runtime, { hab });
      if (
        hby.db.locs.get([eid, scheme])?.url === commandArgs.url
        && !!hby.db.lans.get([eid, scheme])
        && hab.loadLocScheme(eid, scheme).length > 0
      ) {
        console.log(
          `Location ${commandArgs.url} added for aid ${eid} with scheme ${scheme}`,
        );
        return;
      }
    }

    throw new ValidationError(
      `Location ${commandArgs.url} for ${eid} was not accepted into local state.`,
    );
  } finally {
    yield* hby.close();
  }
}
