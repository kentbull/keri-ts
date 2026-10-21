/**
 * `did:keri` projection from accepted local state.
 */
import type { Habery } from "../../app/identity/habbing.ts";
import type { Regery } from "../../vdr/credentialing.ts";
import { parseDidKeriIdentifier } from "../webs/dids.ts";
import {
  type DidDocument,
  type DidResolutionResult,
  didResolutionResult,
  generateBareDidDocument,
} from "../webs/documenting.ts";

export interface ResolveDidKeriResult {
  readonly did: string;
  readonly document: DidDocument;
  readonly resolution: DidResolutionResult;
}

/** Project one accepted `did:keri`; callers own introductions and worker lifetimes. */
export function resolveDidKeri(
  hby: Habery,
  regery: Regery,
  did: string,
): ResolveDidKeriResult {
  const parsed = parseDidKeriIdentifier(did);
  const document = generateBareDidDocument(hby, regery, parsed.canonical);
  return {
    did: parsed.canonical,
    document,
    resolution: didResolutionResult(document),
  };
}
