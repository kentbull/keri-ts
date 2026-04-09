/**
 * `tufa rotate` command implementation.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig `kli rotate` command surface and merge semantics
 * - keeps the CLI/output mental model aligned even though `keri-ts` does not
 *   yet implement KERIpy's advanced witness-auth and delegation follow-on flows
 *
 * Current scope:
 * - local rotation event construction and acceptance
 * - witness replacement/cut/add math
 * - KLI-compatible success output
 */
import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import { Receiptor, type WitnessAuthMap, WitnessReceiptor } from "../witnessing.ts";
import { setupHby } from "./common/existing.ts";
import {
  loadRotateFileOptions,
  parseDataItems,
  parseThresholdOption,
  type RotateFileOptions,
} from "./common/parsing.ts";

/** Parsed command arguments for one `tufa rotate` invocation. */
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

/** Empty baseline used before CLI/file precedence is applied. */
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

/** Return items present in `left` but absent from `right` while preserving order. */
function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

/**
 * Reject KERIpy rotate flows that `keri-ts` has not ported yet.
 *
 * This guard is intentionally front-loaded so the command does not imply full
 * parity in cases where the underlying runtime orchestration is still absent.
 */
function assertUnsupportedAdvancedFlows(args: RotateArgs, delegated: boolean): void {
  if (args.proxy || delegated) {
    throw new ValidationError(
      "Delegation-assisted rotation flow is not yet available in tufa.",
    );
  }
}

function resolveWitnessAuths(
  witnesses: readonly string[],
  codes: readonly string[],
  codeTime?: string,
  promptMissing = false,
): WitnessAuthMap {
  const timestamp = codeTime ?? makeNowIso8601();
  const auths: WitnessAuthMap = {};
  for (const entry of codes) {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator >= entry.length - 1) {
      throw new ValidationError(
        `Invalid witness code '${entry}'. Expected <Witness AID>:<code>.`,
      );
    }
    const witness = entry.slice(0, separator);
    const code = entry.slice(separator + 1);
    auths[witness] = `${code}#${timestamp}`;
  }
  if (promptMissing) {
    for (const witness of witnesses) {
      if (auths[witness]) {
        continue;
      }
      const code = prompt(`Entire code for ${witness}: `);
      if (!code) {
        throw new ValidationError(`Missing witness code for ${witness}.`);
      }
      auths[witness] = `${code}#${makeNowIso8601()}`;
    }
  }
  return auths;
}

/**
 * Rotate one local habitat and print the newly accepted public key state.
 *
 * Maintainer boundary:
 * - CLI concerns stop at option merge/validation and success output
 * - habitat/key-state mutation lives in `Hab.rotate(...)`
 */
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

      if (hab.kever?.wits.length) {
        const auths = resolveWitnessAuths(
          hab.kever.wits,
          rotateArgs.code ?? [],
          rotateArgs.codeTime,
          rotateArgs.authenticate ?? false,
        );
        if (rotateArgs.endpoint) {
          const receiptor = new Receiptor(hby);
          yield* receiptor.receipt(hab.pre, {
            sn: hab.kever.sn,
            auths,
          });
        } else {
          const witDoer = new WitnessReceiptor(hby);
          yield* witDoer.submit(hab.pre, {
            sn: hab.kever.sn,
            auths,
          });
        }
      }

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
