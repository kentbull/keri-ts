/**
 * `tufa interact` command implementation.
 *
 * KERIpy correspondence:
 * - mirrors the single-sig `kli interact` command surface
 * - creates one local `ixn`, accepts it locally, then optionally converges
 *   witness receipts using the same receipting helpers already shared by
 *   `incept` and `rotate`
 */
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Receiptor, WitnessReceiptor } from "../witnessing.ts";
import { withExistingHab } from "./common/context.ts";
import { parseDataItems } from "./common/parsing.ts";
import { resolveWitnessAuths } from "./common/witness-auth.ts";

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

  yield* withExistingHab(
    interactArgs,
    interactArgs.alias,
    {
      compat: interactArgs.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: true,
    },
    function*({ hby, hab }) {
      if (!hab.kever) {
        throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
      }

      hab.interact({ data });

      if (hab.kever?.wits.length) {
        const auths = resolveWitnessAuths(
          hab.kever.wits,
          interactArgs.code ?? [],
          {
            codeTime: interactArgs.codeTime,
            promptMissing: interactArgs.authenticate ?? false,
          },
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
    },
  );
}
