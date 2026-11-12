/**
 * Boolean adapters over the library TEL waits (`app/credentials/tel-completion.ts`)
 * for callers that still take an epoch-millisecond deadline and ignore the status.
 * The group multisig commands use these until they switch to the library wait.
 */
import type { Operation } from "effection";
import {
  waitForIssuedCredential as waitForIssuedCredentialStatus,
  waitForTelEvent,
} from "../../app/credentials/tel-completion.ts";
import type { TelPublication } from "../../vdr/tel-publication.ts";

/** Observe one exact TEL coordinate until completion or an epoch-millisecond deadline; never drive workers here. */
export function* waitForTelPublication(
  publication: TelPublication,
  pre: string,
  sn: number,
  deadline: number,
): Operation<boolean> {
  return (yield* waitForTelEvent({ publication }, pre, sn, { deadline })).outcome === "settled";
}

/** Issuance additionally needs saved credential evidence; publication alone is not verifier acceptance. */
export function* waitForIssuedCredential(
  publication: TelPublication,
  said: string,
  deadline: number,
): Operation<boolean> {
  return (yield* waitForIssuedCredentialStatus({ publication }, said, { deadline })).outcome === "settled";
}
