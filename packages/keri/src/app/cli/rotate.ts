/**
 * `tufa rotate` command implementation.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig `kli rotate` command surface and merge semantics
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
import { createAgentRuntime, processRuntimeUntil } from "../agent-runtime.ts";
import { resolveDelegationCommunicationHab } from "../delegating.ts";
import { queryTransportSink } from "../query-transport.ts";
import { Receiptor, WitnessReceiptor } from "../witnessing.ts";
import { withExistingHab } from "./common/context.ts";
import {
  loadRotateFileOptions,
  parseDataItems,
  parseThresholdOption,
  type RotateFileOptions,
} from "./common/parsing.ts";
import { resolveWitnessAuths } from "./common/witness-auth.ts";

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
  const options = args.file && args.file !== "" ? loadRotateFileOptions(args.file) : emptyRotateOptions();

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
      const kever = hab.kever;
      if (!kever) {
        throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
      }

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
          {
            codeTime: rotateArgs.codeTime,
            promptMissing: rotateArgs.authenticate ?? false,
          },
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

      let delegationPhase: string | null = null;
      if (kever.delpre !== null && hab.kever) {
        const communicationHab = resolveDelegationCommunicationHab(
          hby,
          rotateArgs.proxy,
        );
        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        try {
          runtime.delegating.beginLatest(hab.pre, hab.kever.sn, {
            communicationHab,
          });
          const snh = hab.kever.sn.toString(16);
          const sink = queryTransportSink(
            runtime,
            hby,
            communicationHab ?? hab,
          );
          yield* processRuntimeUntil(
            runtime,
            () => runtime.delegating.complete(hab.pre, hab.kever!.sn),
            { hab, sink, maxTurns: 512, pollMailbox: true },
          );
          delegationPhase = runtime.delegating.workflowStatus(hab.pre, snh).phase;
        } finally {
          yield* runtime.close();
        }
      }

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
