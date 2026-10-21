import type { ThresholdSith } from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import {
  createAgentRuntime,
  runAgentRuntimeUntil,
} from "../agent-runtime.ts";
import { resolveBootstrap } from "../bootstrapping.ts";
import { FetchHttpClient } from "../http-client.ts";
import { createProtocolProcessor } from "../protocol-processing.ts";
import { systemClock } from "../runtime-clock.ts";
import { assertBootstrapComplete } from "./common/bootstrap.ts";

import { type Configer, createConfiger } from "../configing.ts";
import { resolveDelegationCommunicationHab } from "../delegating.ts";
import { Receiptor, WitnessReceiptor } from "../witnessing.ts";
import { setupHby } from "./common/existing.ts";
import {
  InceptFileOptions,
  loadInceptFileOptions,
  parseBooleanOption,
  parseCountOption,
  parseDataItems,
  parseStringListOption,
  parseStringOption,
  parseThresholdOption,
} from "./common/parsing.ts";

interface InceptArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  temp?: boolean;
  passcode?: string;
  alias?: string;
  configDir?: string;
  configFile?: string;
  endpoint?: boolean;
  proxy?: string;
  file?: string;
  transferable?: boolean;
  wits?: string[];
  toad?: number;
  icount?: number;
  isith?: ThresholdSith;
  ncount?: number;
  nsith?: ThresholdSith;
  estOnly?: boolean;
  data?: string[];
  delpre?: string;
}

/**
 * Loads incept options from a file and overlays explicit CLI values.
 */
function mergeWithFile(args: InceptArgs): InceptFileOptions {
  let opts: InceptFileOptions = {};
  if (args.file && args.file !== "") {
    opts = loadInceptFileOptions(args.file);
  }

  if (args.transferable !== undefined) opts.transferable = args.transferable;
  if (args.wits !== undefined) opts.wits = args.wits;
  if (args.icount !== undefined) opts.icount = args.icount;
  if (args.isith !== undefined) opts.isith = args.isith;
  if (args.ncount !== undefined) opts.ncount = args.ncount;
  if (args.nsith !== undefined) opts.nsith = args.nsith;
  if (args.toad !== undefined) opts.toad = args.toad;
  if (args.estOnly !== undefined) opts.estOnly = args.estOnly;
  if (args.delpre !== undefined) opts.delpre = args.delpre;
  if (args.data !== undefined) opts.data = parseDataItems(args.data);

  return opts;
}

/**
 * Implements `tufa incept`.
 *
 * Creates a single-sig identifier locally.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* inceptCommand(args: Record<string, unknown>): Operation<void> {
  // Select one HTTP implementation for all work owned by this command.
  const http = new FetchHttpClient();
  const inceptArgs: InceptArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    temp: parseBooleanOption(args.temp, "temp"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    configDir: parseStringOption(args.configDir, "configDir"),
    configFile: parseStringOption(args.configFile, "configFile"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    proxy: parseStringOption(args.proxy, "proxy"),
    file: parseStringOption(args.file, "file"),
    transferable: parseBooleanOption(args.transferable, "transferable"),
    wits: parseStringListOption(args.wits, "wits"),
    toad: parseCountOption(args.toad, "toad"),
    icount: parseCountOption(args.icount, "icount"),
    isith: parseThresholdOption(args.isith),
    ncount: parseCountOption(args.ncount, "ncount"),
    nsith: parseThresholdOption(args.nsith),
    estOnly: parseBooleanOption(args.estOnly, "estOnly"),
    data: parseStringListOption(args.data, "data"),
    delpre: parseStringOption(args.delpre, "delpre"),
  };

  if (!inceptArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!inceptArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  const opts = mergeWithFile(inceptArgs);
  if (opts.icount === 0) throw new ValidationError("icount must be positive");

  // A command-local scope owns acquisition and teardown; there is no independent child consumer.
  const result = yield* call(function*() {
    const cf: Configer | undefined = inceptArgs.configFile
      ? (yield* createConfiger({
        name: inceptArgs.configFile,
        base: "",
        temp: false,
        headDirPath: inceptArgs.configDir,
        reopen: true,
        clear: false,
      }))
      : undefined;
    const hby = yield* setupHby(
      inceptArgs.name!,
      inceptArgs.base ?? "",
      inceptArgs.passcode,
      inceptArgs.temp ?? false,
      inceptArgs.headDirPath,
      {
        readonly: false,
        cf,
        skipConfig: !cf,
        skipSignator: true,
      },
    );
    let failure: { error: unknown } | undefined;
    try {
      if (hby.habByName(inceptArgs.alias!)) {
        throw new ValidationError(`Alias ${inceptArgs.alias} already exists; inception requires an unused alias.`);
      }
      assertBootstrapComplete(yield* resolveBootstrap(hby, http));

      const hab = hby.makeHab(inceptArgs.alias!, undefined, {
        transferable: opts.transferable ?? false,
        wits: opts.wits ?? [],
        toad: opts.toad ?? 0,
        icount: opts.icount ?? 1,
        isith: opts.isith,
        ncount: opts.ncount ?? 1,
        nsith: opts.nsith,
        estOnly: opts.estOnly ?? false,
        data: opts.data ?? [],
        delpre: opts.delpre,
      });

      if (hab.kever?.wits.length) {
        if (inceptArgs.endpoint) {
          const receiptor = new Receiptor(
            hby,
            createProtocolProcessor(hby),
            http,
            systemClock,
          );
          yield* receiptor.receipt(hab.pre, { sn: 0 });
        } else {
          const witDoer = new WitnessReceiptor(
            hby,
            createProtocolProcessor(hby),
            http,
            systemClock,
          );
          yield* witDoer.submit(hab.pre, { sn: 0 });
        }
      }

      let delegationPhase: string | null = null;
      if (opts.delpre) {
        const communicationHab = resolveDelegationCommunicationHab(
          hby,
          inceptArgs.proxy,
        );
        if (!communicationHab) {
          throw new ValidationError(
            `Delegated inception for ${hab.pre} requires --proxy <alias>.`,
          );
        }
        const runtime = yield* createAgentRuntime(hby, http, systemClock);
        try {
          runtime.delegating.beginLatest(hab.pre, 0, {
            communicationHab,
          });

          yield* runAgentRuntimeUntil(
            runtime,
            () => runtime.delegating.complete(hab.pre, 0),
            { hab, timeoutMs: 120_000, pollMailbox: true },
          );
          delegationPhase = runtime.delegating.workflowStatus(hab.pre, "0").phase;
        } finally {
          yield* runtime.close();
        }
      }

      const state = hby.db.getState(hab.pre);

      return { prefix: hab.pre, keys: state?.k ?? [], delegationPhase };
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      try {
        yield* hby.close();
      } catch (error) {
        if (failure) {
          // deno-lint-ignore no-unsafe-finally -- Preserve inception and shutdown failures.
          throw new AggregateError([failure.error, error], "Inception and database close failed", {
            cause: failure.error,
          });
        }
        // deno-lint-ignore no-unsafe-finally -- Final success requires resource closure.
        throw error;
      }
    }
  });
  console.log(`Prefix  ${result.prefix}`);
  for (const [idx, key] of result.keys.entries()) console.log(`\tPublic key ${idx + 1}:  ${key}`);
  if (result.delegationPhase) console.log(`Delegation status  ${result.delegationPhase}`);
  console.log("");
}
