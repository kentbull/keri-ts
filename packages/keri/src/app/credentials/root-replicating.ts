/**
 * Finite delivery of prepared `/registry/root` copies; transmission is never receipt.
 *
 * `replicateRootCopies` is the KERIpy `rootreplicating.replicate` happy path: a
 * command calls it once a send is possible and reports each typed outcome. There
 * is no acknowledgement or retry here (the runtime's `RootReplicator` derives
 * what is owed and retries); receiving is idempotent, so duplicate copies are
 * harmless.
 */
import { parseBytes } from "cesr-ts";
import { action, type Operation, race } from "effection";
import { type RegistryRoot, RootUnverified } from "../../acdc/salting.ts";
import { AppError, ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab } from "../identity/habbing.ts";
import { localGroupMember } from "../multisig/group-members.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";

/** One signed ESSR copy already authorized and prepared by `RegistryRoot.prepare`. */
export interface RootCopy {
  recipient: string;
  wire: Uint8Array;
}

/** Local Poster attempt result for one copy; `sent` means transmitted, not received or retained. */
export type RootDelivery<C extends RootCopy = RootCopy> =
  | { kin: "sent"; copy: C; deliveries: string[] }
  | { kin: "failed"; copy: C; error: unknown };

/**
 * Send each copy from `sender` to its recipient's `credential` mailbox, in
 * order, and return one outcome per copy. A failed copy does not stop later
 * copies. The caller runs `postman.deliverDo` for the duration; Poster wait
 * misuse or closure still throws.
 */
export function* deliverRegistryRoots<C extends RootCopy>(
  postman: Poster,
  sender: string,
  copies: readonly C[],
): Operation<RootDelivery<C>[]> {
  const outcomes: RootDelivery<C>[] = [];
  for (const copy of copies) {
    const event = postman.send(
      { src: sender, dest: copy.recipient, topic: CREDENTIAL_MAILBOX_TOPIC, msg: copy.wire },
      { notify: true },
    );
    const outcome = yield* postman.wait(event);
    outcomes.push(
      outcome.kin === "sent"
        ? { kin: "sent", copy, deliveries: outcome.deliveries }
        : { kin: "failed", copy, error: outcome.error },
    );
  }
  return outcomes;
}

/** Run `operation` for at most `milliseconds` of `clock` time; null when the budget ends first. */
function* within<T>(clock: RuntimeClock, milliseconds: number, operation: Operation<T>): Operation<T | null> {
  return yield* race([
    operation,
    action<null>(resolve => {
      const timer = clock.setTimeout(() => resolve(null), Math.max(milliseconds, 0));
      return () => clock.clearTimeout(timer);
    }),
  ]);
}

/** How one copy attempt ended: `deferred` and `failed` may succeed later; `refused` never will. */
export type RootCopyKin = "sent" | "deferred" | "refused" | "failed";

/**
 * The typed outcome of one copy attempt, whatever drove it (`RootReplicator`, the
 * `replicateRootCopies` and `resealRootCopies` loops).
 *
 * `kin` says whether to try again: `sent` means handed to the mailbox, not received
 * (`deliveries` names where, as `RootDelivery`); `deferred` means local evidence
 * (the BUP, key state, a hint) is not yet present; `refused` means the copy is not
 * authorized; `failed` means the budget ended or the Poster could not send it.
 * Unless `sent`, `error` is the error itself. `exchange` is the prepared copy's SAID
 * once one was prepared.
 */
export interface RootCopyResult {
  kin: RootCopyKin;
  group: string;
  registry: string;
  sender: string;
  recipient: string;
  exchange?: string;
  deliveries?: string[];
  error?: unknown;
}

/** An accepted rotation whose re-seal recipients could not be selected at all. */
export interface RootExamination {
  group: string;
  rotation: string;
  error: AppError;
}

/**
 * Prepare and deliver one `/registry/root` copy for `gid` from its local member to
 * `recipient`, before `deadline` (epoch ms of `clock`).
 *
 * The copy is sealed with `RegistryRoot.prepare` and a per-registry derived hint
 * (`hinted`, so a copy that could never verify is reported, not sent). Any
 * `AppError` ends in the result; any other exception is an invariant failure and
 * escapes. The caller runs `postman.deliverDo` for the duration.
 */
export function* replicateRootCopy(
  root: RegistryRoot,
  postman: Poster,
  clock: RuntimeClock,
  gid: string,
  registry: string,
  recipient: string,
  deadline: number,
): Operation<RootCopyResult> {
  const sender = localGroupMember(root.hby, gid);
  const result: RootCopyResult = { kin: "failed", group: gid, registry, sender: sender.pre!, recipient };
  try {
    if (clock.now() >= deadline) {
      throw new ValidationError("registry root copies did not complete within their budget");
    }
    let wire: Uint8Array;
    try {
      wire = root.prepare(sender, recipient, gid, registry, { hinted: true });
    } catch (error) {
      result.kin = error instanceof RootUnverified ? "deferred" : "refused";
      throw error;
    }
    result.exchange = parseBytes(wire)[0].body.said!;
    const outcome = yield* within(
      clock,
      deadline - clock.now(),
      deliverRegistryRoots(postman, sender.pre!, [{ recipient, wire }]),
    );
    if (!outcome) throw new ValidationError("registry root copies did not complete within their budget");
    if (outcome[0].kin === "failed") {
      result.error = outcome[0].error ?? "delivery failed";
    } else {
      result.kin = "sent";
      result.deliveries = outcome[0].deliveries;
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    result.error = error;
  }
  return result;
}

/**
 * Send one copy of each of `registries`' held roots for group `ghab` to each
 * recipient, signed by `ghab`'s local member, and return one result per copy.
 *
 * `recipients` defaults to every other current signing member. `timeoutMs` is this
 * replication's own budget: a copy reached after it ends, or still sending when it
 * ends, is `failed`. Nothing is retried or recorded and an `AppError` never
 * escapes. The caller runs `postman.deliverDo` for the duration.
 */
export function* replicateRootCopies(
  root: RegistryRoot,
  postman: Poster,
  clock: RuntimeClock,
  ghab: Hab,
  registries: readonly string[],
  { recipients, timeoutMs }: { recipients?: readonly string[]; timeoutMs: number },
): Operation<RootCopyResult[]> {
  const gid = ghab.pre, sender = localGroupMember(root.hby, gid), deadline = clock.now() + Math.max(timeoutMs, 0);
  const targets = recipients ?? root.members(gid).filter(aid => aid !== sender.pre);
  const results: RootCopyResult[] = [];
  for (const registry of registries) {
    for (const recipient of targets) {
      results.push(yield* replicateRootCopy(root, postman, clock, gid, registry, recipient, deadline));
    }
  }
  return results;
}

/** Budget for re-seal copies from a command without its own `--timeout`, as KERIpy `rootreplicating.Budget`. */
export const RootResealBudgetMs = 30_000;

/**
 * After an accepted group rotation, send held roots to new or rekeyed members.
 *
 * Only a signer of the rotation that held a prior key sends (`RegistryRoot.resealed`),
 * every such signer sends with no election, and a member holding no root for the
 * group sends nothing. `examination` is set when the recipients could not be
 * selected, and then nothing is sent. Fire and forget like `replicateRootCopies`.
 */
export function* resealRootCopies(
  root: RegistryRoot,
  postman: Poster,
  clock: RuntimeClock,
  ghab: Hab,
  rotation: string,
  { timeoutMs = RootResealBudgetMs }: { timeoutMs?: number } = {},
): Operation<{ examination: RootExamination | null; copies: RootCopyResult[] }> {
  let recipients: string[];
  try {
    recipients = root.resealed(ghab, rotation);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { examination: { group: ghab.pre!, rotation, error }, copies: [] };
  }
  const registries = root.held(ghab.pre);
  if (!recipients.length || !registries.length) return { examination: null, copies: [] };
  const copies = yield* replicateRootCopies(root, postman, clock, ghab, registries, { recipients, timeoutMs });
  return { examination: null, copies };
}
