/**
 * `did:keri` resolution from local state and optional OOBI introduction.
 */
import type { Operation } from "effection";
import type { AgentRuntime } from "../../app/agent-runtime.ts";
import { processRuntimeTurn } from "../../app/agent-runtime.ts";
import { ValidationError } from "../../core/errors.ts";
import { parseDidKeriIdentifier } from "../webs/dids.ts";
import {
  type DidDocument,
  type DidResolutionResult,
  didResolutionResult,
  generateBareDidDocument,
} from "../webs/documenting.ts";

export interface ResolveDidKeriOptions {
  readonly did: string;
  readonly oobis?: readonly string[];
  readonly metadata?: boolean;
}

export interface ResolveDidKeriResult {
  readonly did: string;
  readonly document: DidDocument;
  readonly resolution: DidResolutionResult;
}

/** Resolve one `did:keri` from current runtime state, resolving OOBIs first when supplied. */
export function* resolveDidKeri(
  runtime: AgentRuntime,
  options: ResolveDidKeriOptions,
): Operation<ResolveDidKeriResult> {
  const parsed = parseDidKeriIdentifier(options.did);
  for (const oobi of options.oobis ?? []) {
    runtime.oobiery.resolve(oobi);
  }
  for (let i = 0; i < 5; i += 1) {
    yield* processRuntimeTurn(runtime, { pollMailbox: false });
    if (runtime.hby.db.getKever(parsed.aid, { refresh: true })) {
      break;
    }
  }
  if (!runtime.hby.db.getKever(parsed.aid, { refresh: true })) {
    throw new ValidationError(`No accepted key state for ${parsed.aid}.`);
  }
  const document = generateBareDidDocument(runtime, parsed.canonical);
  return {
    did: parsed.canonical,
    document,
    resolution: didResolutionResult(document),
  };
}
