import { createQueue, type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";
import { InceptFileOptions, loadInceptFileOptions, parseDataItems } from "./common/parsing.ts";

interface InceptArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  temp?: boolean;
  passcode?: string;
  alias?: string;
  config?: string;
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
  if (args.isith !== undefined) opts.isith = args.isith;
  if (args.ncount !== undefined) opts.ncount = Number(args.ncount);
  if (args.nsith !== undefined) opts.nsith = args.nsith;
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

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      inceptArgs.name!,
      inceptArgs.base ?? "",
      inceptArgs.passcode,
      inceptArgs.temp ?? false,
      inceptArgs.headDirPath,
      {
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
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
