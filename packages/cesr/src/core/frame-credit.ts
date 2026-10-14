import type { ResourceReservation } from "./resource-policy.ts";
import type { CesrFrame } from "./types.ts";

const credits = new WeakMap<CesrFrame, ResourceReservation>();

/** Retain root credit until both generator suspension and consumer disposal release their references. */
export function retainFrameCredit(frame: CesrFrame, credit: ResourceReservation): () => void {
  if (credits.has(frame)) throw new Error("Frame already owns resource credit");
  let consumer = true;
  let parser = true;
  const release = () => {
    if (!consumer && !parser) credit.release();
  };
  credits.set(frame, {
    release: () => {
      consumer = false;
      release();
    },
  });
  return () => {
    parser = false;
    release();
  };
}

/** Claim once before asynchronous disposal; the caller releases only after all owners finish. */
export function takeFrameCredit(frame: CesrFrame): ResourceReservation | undefined {
  const credit = credits.get(frame);
  credits.delete(frame);
  return credit;
}
