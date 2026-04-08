import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";
import {
  loadRotateFileOptions,
  parseDataItems,
  parseThresholdOption,
  type RotateFileOptions,
} from "./common/parsing.ts";

interface RotateArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
  file?: string;
  nextCount?: number;
  endpoint?: boolean;
  authenticate?: boolean;
  code?: string[];
  codeTime?: string;
  proxy?: string;
  isith?: string;
  nsith?: string;
  toad?: number;
  witnesses?: string[];
  cuts?: string[];
  witnessAdd?: string[];
  data?: string[];
}

function emptyRotateOptions(): RotateFileOptions {
  return {};
}

/**
 * Merge CLI arguments over file-backed rotation options with KLI-compatible precedence.
 *
 * KLI quirk preserved intentionally:
 * - absent CLI `--nsith` still forces `'1'`
 * - absent CLI `--next-count` still forces `1`
 */
function mergeWithFile(args: RotateArgs): RotateFileOptions {
  const options = args.file && args.file !== ""
    ? loadRotateFileOptions(args.file)
    : emptyRotateOptions();

  if (args.isith !== undefined) {
    options.isith = parseThresholdOption(args.isith);
  }
  if (args.nsith !== undefined) {
    options.nsith = parseThresholdOption(args.nsith);
  } else {
    options.nsith = "1";
  }
  if (args.nextCount !== undefined) {
    options.ncount = Number(args.nextCount);
  } else {
    options.ncount = 1;
  }
  if (args.toad !== undefined) {
    options.toad = Number(args.toad);
  }
  if ((args.witnesses?.length ?? 0) > 0) {
    options.wits = [...args.witnesses!];
  }
  if ((args.cuts?.length ?? 0) > 0) {
    options.witsCut = [...args.cuts!];
  }
  if ((args.witnessAdd?.length ?? 0) > 0) {
    options.witsAdd = [...args.witnessAdd!];
  }
  if (args.data !== undefined) {
    options.data = parseDataItems(args.data);
  }

  return options;
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function assertUnsupportedAdvancedFlows(args: RotateArgs, delegated: boolean): void {
  if (args.endpoint) {
    throw new ValidationError(
      "Witness receipt-endpoint rotation flow is not yet available in tufa.",
    );
  }
  if (args.authenticate || (args.code?.length ?? 0) > 0 || args.codeTime) {
    throw new ValidationError(
      "Witness authentication-code rotation flow is not yet available in tufa.",
    );
  }
  if (args.proxy || delegated) {
    throw new ValidationError(
      "Delegation-assisted rotation flow is not yet available in tufa.",
    );
  }
}

/** Implements `tufa rotate`. */
export function* rotateCommand(args: Record<string, unknown>): Operation<void> {
  const rotateArgs: RotateArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    file: args.file as string | undefined,
    nextCount: args.nextCount as number | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
    proxy: args.proxy as string | undefined,
    isith: args.isith as string | undefined,
    nsith: args.nsith as string | undefined,
    toad: args.toad as number | undefined,
    witnesses: args.witnesses as string[] | undefined,
    cuts: args.cuts as string[] | undefined,
    witnessAdd: args.witnessAdd as string[] | undefined,
    data: args.data as string[] | undefined,
  };

  if (!rotateArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!rotateArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  const options = mergeWithFile(rotateArgs);

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      rotateArgs.name!,
      rotateArgs.base ?? "",
      rotateArgs.passcode,
      false,
      rotateArgs.headDirPath,
      {
        compat: rotateArgs.compat ?? false,
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
      const hab = hby.habByName(rotateArgs.alias!);
      if (!hab) {
        throw new ValidationError(`Alias ${rotateArgs.alias!} is invalid`);
      }
      const kever = hab.kever;
      if (!kever) {
        throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
      }

      assertUnsupportedAdvancedFlows(rotateArgs, kever.delpre !== null);

      let cuts = [...(options.witsCut ?? [])];
      let adds = [...(options.witsAdd ?? [])];
      if ((options.wits?.length ?? 0) > 0) {
        if (cuts.length > 0 || adds.length > 0) {
          throw new ValidationError(
            "you can only specify witnesses or cuts and add",
          );
        }
        cuts = difference(kever.wits, options.wits ?? []);
        adds = difference(options.wits ?? [], kever.wits);
      }

      hab.rotate({
        isith: options.isith,
        nsith: options.nsith,
        ncount: options.ncount,
        toad: options.toad,
        cuts,
        adds,
        data: options.data ?? [],
      });

      const state = hby.db.getState(hab.pre);
      console.log(`Prefix  ${hab.pre}`);
      console.log(`New Sequence No.  ${hab.kever?.sn ?? state?.s ?? ""}`);
      for (const [idx, key] of (state?.k ?? []).entries()) {
        console.log(`\tPublic key ${idx + 1}:  ${key}`);
      }
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
}
