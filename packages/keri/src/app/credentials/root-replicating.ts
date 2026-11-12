/**
 * Finite delivery of prepared `/registry/root` copies; transmission is never receipt.
 *
 * `replicateRegistryRoots` is the KERIpy `rootreplicating.replicate` happy path:
 * group commands call it once a send is possible and report each outcome. There
 * is no acknowledgement, sent-copies record or retry; receiving is idempotent,
 * so duplicate copies are harmless, and `tufa vc registry root send` is the
 * recovery path for a copy that was not sent.
 */
import { parseBytes } from "cesr-ts";
import { action, type Operation, race } from "effection";
import type { RegistryRoot } from "../../acdc/salting.ts";
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

/** The operator command that resends a copy automatic replication did not send. */
export const RootCopyRecovery = "tufa vc registry root send";

/**
 * One automatic copy's outcome, displayed as a `root_copy` JSON line. `exchange`
 * is the prepared copy's SAID; `transmitted` means handed to the mailbox, not
 * received. A copy not sent carries the error and the recovery command.
 */
export interface RootCopyReport {
  phase: "root_copy";
  gid: string;
  registry: string;
  sender: string;
  recipient: string;
  exchange?: string;
  transmitted: boolean;
  error?: string;
  recovery?: string;
}

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

/**
 * Fire and forget one copy of each of `registries`' held roots for group
 * `ghab` to each recipient, signed by `ghab`'s local member.
 *
 * `recipients` defaults to every other current signing member. Each copy is
 * prepared with `RegistryRoot.prepare` and a per-registry derived hint
 * (`hinted`, so a copy that could never verify is reported, not sent) and
 * delivered through `deliverRegistryRoots`, as `tufa vc registry root send`
 * does. `timeoutMs` is this replication's own budget: a copy reached after it
 * ends, or still sending when it ends, is reported unsent. Nothing is retried
 * or recorded and an `AppError` never escapes: every outcome is returned for
 * display. The caller runs `postman.deliverDo` for the duration.
 */
export function* replicateRegistryRoots(
  root: RegistryRoot,
  postman: Poster,
  clock: RuntimeClock,
  ghab: Hab,
  registries: readonly string[],
  { recipients, timeoutMs }: { recipients?: readonly string[]; timeoutMs: number },
): Operation<RootCopyReport[]> {
  const gid = ghab.pre, sender = localGroupMember(root.hby, gid), deadline = clock.now() + Math.max(timeoutMs, 0);
  const targets = recipients ?? root.members(gid).filter(aid => aid !== sender.pre);
  const reports: RootCopyReport[] = [];
  for (const registry of registries) {
    for (const recipient of targets) {
      const result: RootCopyReport = {
        phase: "root_copy",
        gid,
        registry,
        sender: sender.pre,
        recipient,
        transmitted: false,
      };
      let failure: unknown = null;
      try {
        if (clock.now() >= deadline) {
          throw new ValidationError("registry root copies did not complete within their budget");
        }
        const wire = root.prepare(sender, recipient, gid, registry, { hinted: true });
        result.exchange = parseBytes(wire)[0].body.said!;
        const outcome = yield* within(
          clock,
          deadline - clock.now(),
          deliverRegistryRoots(postman, sender.pre, [{ recipient, wire }]),
        );
        if (!outcome) failure = new ValidationError("registry root copies did not complete within their budget");
        else if (outcome[0].kin === "failed") failure = outcome[0].error ?? "delivery failed";
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        failure = error;
      }
      reports.push(
        failure === null ? { ...result, transmitted: true } : {
          ...result,
          error: failure instanceof Error ? failure.message : String(failure),
          recovery: RootCopyRecovery,
        },
      );
    }
  }
  return reports;
}

/** Budget for re-seal copies from a command without its own `--timeout`, as KERIpy `rootreplicating.Budget`. */
export const RootResealBudgetMs = 30_000;

/** A re-seal that could not even select its recipients, displayed as a `root_copy` line. */
export interface RootResealFailure {
  phase: "root_copy";
  gid: string;
  rotation: string;
  transmitted: false;
  error: string;
}

/**
 * After an accepted group rotation, send held roots to new or rekeyed members.
 *
 * Fire and forget like `replicateRegistryRoots`: only a signer of the rotation
 * that held a prior key sends (`RegistryRoot.resealed`), every such signer
 * sends with no election, a member holding no root for the group sends
 * nothing, and no failure ever fails the rotation. The caller runs
 * `postman.deliverDo` for the duration.
 */
export function* resealRegistryRoots(
  root: RegistryRoot,
  postman: Poster,
  clock: RuntimeClock,
  ghab: Hab,
  rotation: string,
  { timeoutMs = RootResealBudgetMs }: { timeoutMs?: number } = {},
): Operation<(RootCopyReport | RootResealFailure)[]> {
  let recipients: string[];
  try {
    recipients = root.resealed(ghab, rotation);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return [{ phase: "root_copy", gid: ghab.pre, rotation, transmitted: false, error: error.message }];
  }
  const registries = root.held(ghab.pre);
  if (!recipients.length || !registries.length) return [];
  return yield* replicateRegistryRoots(root, postman, clock, ghab, registries, { recipients, timeoutMs });
}
