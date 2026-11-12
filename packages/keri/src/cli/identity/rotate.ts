import type { ThresholdSith, Versionage } from "cesr-ts";
import type { Hab } from "../../app/identity/habbing.ts";
import { NodeHttpClient } from "../../app/transport/node-http-client.ts";
import type { WitnessAuthMap } from "../../app/witness/receipting.ts";

/**
 * `tufa rotate` command implementation.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig `kli rotate` command surface
 * - keeps the CLI/output mental model aligned while preserving explicit
 *   TypeScript-native orchestration instead of KERIpy's doer stack
 *
 * Current scope:
 * - local rotation event construction and acceptance
 * - witness replacement/cut/add math plus witness-auth/receipt convergence
 * - KLI-compatible success output
 */
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";

import { resolveDelegationCommunicationHab } from "../../app/identity/delegating.ts";
import { isLocalGroupHab } from "../../app/multisig/group-members.ts";
import { withExistingHab } from "../common/context.ts";
import { cliEventCompletionDeps, completeEventOrThrow } from "../common/event-completion.ts";
import {
  loadRotateFileOptions,
  parseBooleanOption,
  parseCountOption,
  parseDataItems,
  parseKeriVersionOption,
  parseStringListOption,
  parseStringOption,
  parseThresholdOption,
  type RotateFileOptions,
} from "../common/parsing.ts";
import { resolveWitnessAuths } from "../common/witness-auth.ts";

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
  isith?: ThresholdSith;
  nsith?: ThresholdSith;
  toad?: number;
  witnesses?: string[];
  cuts?: string[];
  witnessAdd?: string[];
  data?: string[];
  /** Must match the identifier's accepted KEL version (KLI `--version`). */
  version?: Versionage;
}

/** Empty baseline used before CLI/file precedence is applied. */
function emptyRotateOptions(): RotateFileOptions {
  return {};
}

/** Overlay supplied CLI values; defaults apply only after file precedence is resolved. */
function mergeWithFile(args: RotateArgs): RotateFileOptions {
  const options = args.file && args.file !== "" ? loadRotateFileOptions(args.file) : emptyRotateOptions();

  if (args.isith !== undefined) {
    options.isith = args.isith;
  }
  if (args.nsith !== undefined) {
    options.nsith = args.nsith;
  }
  if (args.nextCount !== undefined) {
    options.ncount = args.nextCount;
  }
  if (args.toad !== undefined) {
    options.toad = args.toad;
  }
  if (args.witnesses !== undefined) {
    options.wits = [...args.witnesses];
  }
  if (args.cuts !== undefined) {
    options.witsCut = [...args.cuts];
  }
  if (args.witnessAdd !== undefined) {
    options.witsAdd = [...args.witnessAdd];
  }
  if (args.data !== undefined) {
    options.data = parseDataItems(args.data);
  }

  return options;
}

/** Return items present in `left` but absent from `right` while preserving order. */
function difference(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

/**
 * Rotate one local habitat and print the newly accepted public key state.
 *
 * Maintainer boundary:
 * - CLI concerns stop at option merge/validation and success output
 * - habitat/key-state mutation lives in `Hab.rotate(...)`
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 * @param options Optional application-owned authorization resolver, evaluated against prospective witnesses before rotation.
 */
export function* rotateCommand(
  args: Record<string, unknown>,
  { witnessAuths }: { witnessAuths?: (hab: Hab, witnesses: readonly string[]) => WitnessAuthMap } = {},
): Operation<void> {
  // Select one HTTP implementation for all work owned by this command.
  const http = new NodeHttpClient();
  const rotateArgs: RotateArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    compat: parseBooleanOption(args.compat, "compat"),
    file: parseStringOption(args.file, "file"),
    nextCount: parseCountOption(args.nextCount, "nextCount"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
    proxy: parseStringOption(args.proxy, "proxy"),
    isith: parseThresholdOption(args.isith),
    nsith: parseThresholdOption(args.nsith),
    toad: parseCountOption(args.toad, "toad"),
    witnesses: parseStringListOption(args.witnesses, "witnesses"),
    cuts: parseStringListOption(args.cuts, "cuts"),
    witnessAdd: parseStringListOption(args.witnessAdd, "witnessAdd"),
    data: parseStringListOption(args.data, "data"),
    version: parseKeriVersionOption(args.version),
  };

  if (!rotateArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!rotateArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  const options = mergeWithFile(rotateArgs);

  yield* withExistingHab(
    rotateArgs,
    rotateArgs.alias,
    {
      compat: rotateArgs.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: true,
    },
    function*({ hby, hab }) {
      if (isLocalGroupHab(hby, hab)) {
        throw new ValidationError(
          "Group aliases require tufa multisig rotate so member approval and fanout are coordinated.",
        );
      }
      const kever = hab.kever;
      if (!kever) {
        throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
      }

      let cuts = [...(options.witsCut ?? [])];
      let adds = [...(options.witsAdd ?? [])];
      if (options.wits !== undefined) {
        if (cuts.length > 0 || adds.length > 0) {
          throw new ValidationError(
            "you can only specify witnesses or cuts and add",
          );
        }
        cuts = difference(kever.wits, options.wits ?? []);
        adds = difference(options.wits ?? [], kever.wits);
      }

      const witnesses = [...kever.wits.filter(witness => !cuts.includes(witness)), ...adds];
      const auths = witnessAuths ? witnessAuths(hab, witnesses) : resolveWitnessAuths(
        witnesses,
        rotateArgs.code ?? [],
        {
          codeTime: rotateArgs.codeTime,
          promptMissing: rotateArgs.authenticate ?? false,
        },
      );
      hab.rotate({
        isith: options.isith,
        nsith: options.nsith ?? "1",
        ncount: options.ncount ?? 1,
        toad: options.toad,
        cuts,
        adds,
        data: options.data ?? [],
        version: rotateArgs.version,
      });

      const { delegationPhase } = yield* completeEventOrThrow(
        cliEventCompletionDeps(hby, http),
        hab,
        hab.kever!.sn,
        {
          auths,
          endpoint: rotateArgs.endpoint,
          delegation: kever.delpre !== null && hab.kever
            ? { communicationHab: () => resolveDelegationCommunicationHab(hby, rotateArgs.proxy) }
            : undefined,
        },
      );

      const state = hby.db.getState(hab.pre);
      console.log(`Prefix  ${hab.pre}`);
      console.log(`New Sequence No.  ${hab.kever?.sn ?? state?.s ?? ""}`);
      for (const [idx, key] of (state?.k ?? []).entries()) {
        console.log(`\tPublic key ${idx + 1}:  ${key}`);
      }
      if (delegationPhase) {
        console.log(`Delegation status  ${delegationPhase}`);
      }
    },
  );
}
