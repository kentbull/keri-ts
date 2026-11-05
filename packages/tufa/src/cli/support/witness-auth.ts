/** Canonical witness-code parsing for finite authoring. */
import { parseBooleanOption, parseStringListOption, parseStringOption, resolveWitnessAuths } from "keri-ts/cli";
import { type Hab, ValidationError, type WitnessAuthMap } from "keri-ts/runtime";
import { validateIsoDatetime } from "../../operator/host-planning.ts";
import { loadKfWitnessAuths } from "../../operator/kfboot/onboarding.ts";
export { resolveWitnessAuths, type WitnessAuthOptions } from "keri-ts/cli";

/** Resolve transient codes before authoring using the existing CLI semantics. */
export function authoringWitnessAuths(hab: Hab, args: Record<string, unknown>): WitnessAuthMap {
  const credentialFile = parseStringOption(args.witnessCredentials, "witness-credentials");
  const codes = parseStringListOption(args.code, "code") ?? [];
  const authenticate = parseBooleanOption(args.authenticate, "authenticate") ?? false;
  if (credentialFile) {
    if (codes.length || authenticate || args.codeTime !== undefined) {
      throw new ValidationError("--witness-credentials cannot be combined with --code, --authenticate or --code-time.");
    }
    return loadKfWitnessAuths(hab, credentialFile);
  }
  const witnesses = hab.kever?.wits ?? [];
  return resolveWitnessAuths(witnesses, codes, {
    codeTime: parseStringOption(args.codeTime, "code-time"),
    promptMissing: authenticate,
    normalizeCodeTime: validateIsoDatetime,
  });
}
