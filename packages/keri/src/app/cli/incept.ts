import { createQueue, type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import {
  createAgentRuntime,
  processRuntimeUntil,
  runtimeHasPendingWork,
  runtimeHasWellKnownAuth,
  runtimeOobiTerminalState,
} from "../agent-runtime.ts";
import { type Configer, createConfiger } from "../configing.ts";
import type { Habery } from "../habbing.ts";
import { setupHby } from "./common/existing.ts";
import {
  InceptFileOptions,
  loadInceptFileOptions,
  parseDataItems,
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
  isith?: string;
  ncount?: number;
  nsith?: string;
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
  if (args.wits && args.wits.length > 0) opts.wits = args.wits;
  if (args.icount !== undefined) opts.icount = Number(args.icount);
  if (args.isith !== undefined) opts.isith = parseThresholdOption(args.isith);
  if (args.ncount !== undefined) opts.ncount = Number(args.ncount);
  if (args.nsith !== undefined) opts.nsith = parseThresholdOption(args.nsith);
  if (args.toad !== undefined) opts.toad = Number(args.toad);
  if (args.estOnly !== undefined) opts.estOnly = args.estOnly;
  if (args.delpre !== undefined) opts.delpre = args.delpre;
  if (args.data !== undefined) opts.data = parseDataItems(args.data);

  return opts;
}

/**
 * Implements `tufa incept`.
 *
 * Creates a single-sig identifier locally.
 */
export function* inceptCommand(args: Record<string, unknown>): Operation<void> {
  const inceptArgs: InceptArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    temp: args.temp as boolean | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    configDir: args.configDir as string | undefined,
    configFile: args.configFile as string | undefined,
    endpoint: args.endpoint as boolean | undefined,
    proxy: args.proxy as string | undefined,
    file: args.file as string | undefined,
    transferable: args.transferable as boolean | undefined,
    wits: args.wits as string[] | undefined,
    toad: args.toad as number | undefined,
    icount: args.icount as number | undefined,
    isith: args.isith as string | undefined,
    ncount: args.ncount as number | undefined,
    nsith: args.nsith as string | undefined,
    estOnly: args.estOnly as boolean | undefined,
    data: args.data as string[] | undefined,
    delpre: args.delpre as string | undefined,
  };

  if (!inceptArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!inceptArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  if (inceptArgs.endpoint) {
    throw new ValidationError(
      "Witness endpoint receipting is not available in single-sig local phase",
    );
  }
  if (inceptArgs.proxy) {
    throw new ValidationError(
      "Delegation proxy flow is not available in single-sig local phase",
    );
  }

  const opts = mergeWithFile(inceptArgs);

  const cues = createQueue<{ kin: string; pre?: string; mode: string }, void>();

  const doer = yield* spawn(function* () {
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
    try {
      if (hby.db.oobis.cnt() > 0 || hby.db.woobi.cnt() > 0) {
        const runtime = createAgentRuntime(hby, { mode: "local" });
        yield* processRuntimeUntil(
          runtime,
          () => !runtimeHasPendingWork(runtime),
          { maxTurns: 128 },
        );
        if (hby.db.eoobi.cnt() > 0) {
          throw new ValidationError(
            "Bootstrap OOBI resolution failed before inception.",
          );
        }
        assertConfiguredWellKnownAuth(runtime, hby, "inception");
      }

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
      const state = hby.db.getState(hab.pre);

      console.log(`Prefix  ${hab.pre}`);
      for (const [idx, key] of (state?.k ?? []).entries()) {
        console.log(`\tPublic key ${idx + 1}:  ${key}`);
      }
      console.log("");
      cues.add({ kin: "incept", pre: hab.pre, mode: "native" });
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
  const cue = yield* cues.next();
  if (cue.done) return;
}

function configuredWellKnownUrls(hby: Habery): string[] {
  return Array.isArray(hby.config.wurls)
    ? hby.config.wurls.filter((entry): entry is string =>
      typeof entry === "string"
    )
    : [];
}

function assertConfiguredWellKnownAuth(
  runtime: ReturnType<typeof createAgentRuntime>,
  hby: Habery,
  context: string,
): void {
  const failed = configuredWellKnownUrls(hby).filter((url) =>
    !runtimeHasWellKnownAuth(runtime, url)
  );
  if (failed.length === 0) {
    return;
  }

  const details = failed.map((url) => {
    const terminal = runtimeOobiTerminalState(runtime, url);
    return `${url} (${terminal.record?.state ?? terminal.status})`;
  }).join(", ");
  throw new ValidationError(
    `Bootstrap well-known auth failed before ${context}: ${details}`,
  );
}
