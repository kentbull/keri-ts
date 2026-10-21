import { FetchHttpClient } from "../http-client.ts";
import { createProtocolProcessor } from "../protocol-processing.ts";
import { systemClock } from "../runtime-clock.ts";

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
import { parseBooleanOption, parseDataItems, parseStringListOption, parseStringOption } from "./common/parsing.ts";
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
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* interactCommand(
  args: Record<string, unknown>,
): Operation<void> {
  // Select one HTTP implementation for all work owned by this command.
  const http = new FetchHttpClient();
  const interactArgs: InteractArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    compat: parseBooleanOption(args.compat, "compat"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
    data: parseStringListOption(args.data, "data"),
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
          const receiptor = new Receiptor(
            hby,
            createProtocolProcessor(hby),
            http,
            systemClock,
          );
          yield* receiptor.receipt(hab.pre, {
            sn: hab.kever.sn,
            auths,
          });
        } else {
          const witDoer = new WitnessReceiptor(
            hby,
            createProtocolProcessor(hby),
            http,
            systemClock,
          );
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
