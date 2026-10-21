/** Finite CLI observations over the publication owner's durable facts; host workers make progress. */
import { type Operation, sleep } from "effection";
import type { TelPublication } from "../../../vdr/tel-publication.ts";

/** Observe one exact TEL coordinate until completion or an epoch-millisecond deadline; never drive workers here. */
export function* waitForTelPublication(
  publication: TelPublication,
  pre: string,
  sn: number,
  deadline: number,
): Operation<boolean> {
  while (!publication.complete(pre, sn)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    yield* sleep(Math.min(50, remaining));
  }
  return true;
}

/** Issuance additionally needs saved credential evidence; publication alone is not verifier acceptance. */
export function* waitForIssuedCredential(
  publication: TelPublication,
  said: string,
  deadline: number,
): Operation<boolean> {
  if (!(yield* waitForTelPublication(publication, said, 0, deadline))) return false;
  while (publication.reger.saved.get(said) === null) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    yield* sleep(Math.min(50, remaining));
  }
  return true;
}
