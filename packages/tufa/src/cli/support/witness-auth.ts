/** Canonical witness-code parsing for finite authoring. */
import { parseBooleanOption, parseStringListOption, parseStringOption, resolveWitnessAuths } from "keri-ts/cli";
import { type Hab, type WitnessAuthMap } from "keri-ts/runtime";
import { validateIsoDatetime } from "../../operator/host-planning.ts";
export { resolveWitnessAuths, type WitnessAuthOptions } from "keri-ts/cli";

/** Resolve transient codes before authoring using the existing CLI semantics. */
export function authoringWitnessAuths(hab: Hab, args: Record<string, unknown>): WitnessAuthMap {
  const witnesses = hab.kever?.wits ?? [];
  return resolveWitnessAuths(witnesses, parseStringListOption(args.code, "code") ?? [], {
    codeTime: parseStringOption(args.codeTime, "code-time"),
    promptMissing: parseBooleanOption(args.authenticate, "authenticate") ?? false,
    normalizeCodeTime: validateIsoDatetime,
  });
}
