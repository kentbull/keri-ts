/**
 * `tufa interact` command implementation.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig `kli interact` command surface
 * - creates one local `ixn`, accepts it locally, then optionally converges
 *   witness receipts using the same receipting helpers already shared by
 *   `incept` and `rotate`
 */
import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import { Receiptor, type WitnessAuthMap, WitnessReceiptor } from "../witnessing.ts";
import { setupHby } from "./common/existing.ts";
import { parseDataItems } from "./common/parsing.ts";

/** Parsed command arguments for one `tufa interact` invocation. */
interface InteractArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
  endpoint?: boolean;
  authenticate?: boolean;
  code?: string[];
  codeTime?: string;
  data?: string[];
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
 * Create one local interaction event and optionally converge witness receipts.
 *
 * Maintainer boundary:
 * - CLI concerns stop at argument parsing, witness-auth capture, and success
 *   output
 * - interaction event authoring and local acceptance live in `Hab.interact(...)`
 */
export function* interactCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const interactArgs: InteractArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
    data: args.data as string[] | undefined,
  };

  if (!interactArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!interactArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  const data = parseDataItems(interactArgs.data);

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      interactArgs.name!,
      interactArgs.base ?? "",
      interactArgs.passcode,
      false,
      interactArgs.headDirPath,
      {
        compat: interactArgs.compat ?? false,
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
      const hab = hby.habByName(interactArgs.alias!);
      if (!hab) {
        throw new ValidationError(`Alias ${interactArgs.alias!} is invalid`);
      }
      if (!hab.kever) {
        throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
      }

      hab.interact({ data });

      if (hab.kever?.wits.length) {
        const auths = resolveWitnessAuths(
          hab.kever.wits,
          interactArgs.code ?? [],
          interactArgs.codeTime,
          interactArgs.authenticate ?? false,
        );
        if (interactArgs.endpoint) {
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
