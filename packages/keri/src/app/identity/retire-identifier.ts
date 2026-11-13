/**
 * Retire a local, non-group identifier from a running agent: `Habery.retireHab` at the store level, then the
 * runtime's own state for it.
 *
 * {@link retireIdentifierRefusal} decides first, as a pure read, and {@link retireIdentifier} refuses with its
 * reason before any write. Beyond `retireHab`'s own refusals (not local, a group, a local group's member or
 * accepted member, a local habitat's delegator) the runtime refuses an identifier it still needs: the issuer of a
 * legacy or v2 registry (a v2 registry's alias cannot be reloaded without its local issuer), one with a delegated
 * event pending in `dpwe.`/`dune.`/`dpub.` or pinned as a delegation proxy, the habitat of a live issuance or
 * Unblind operation, the source of a queued Poster event, the explicit signer of a queued query, and the
 * querier's configured default signer.
 *
 * `retireHab` drops the held signers of the identifier's current keys with its stored keys. After it commits,
 * this deletes the identifier's mailbox poll cursors (`Baser.tops`, keyed by subject and endpoint) and its KEL
 * publisher bookkeeping (`Baser.kpub`), and prompts the mailbox poller and the KEL publisher. The poller halts
 * the identifier's workers on its next tock; the publisher drops the identifier's budgets and derives nothing
 * for it, since it is no longer local.
 *
 * Deleted, and why none of it is acceptance state: `tops.` is this consumer's own poll progress against a
 * remote mailbox, not a record of anything accepted; `kpub.` records which mailboxes were told the
 * identifier's KEL, the publisher's own bookkeeping (its sweep prunes rows of non-local identifiers anyway).
 * Neither takes part in reply acceptance (BADA/RUN) or replay protection.
 *
 * Kept, deliberately (BADA/RUN): the KEL and its attachments, `states.` and key-state notices, every accepted
 * reply the identifier authored or that names it (end-role and location records, reply SADs, their date-times
 * and signatures or seal couples), transaction-state notices, KRAM cache rows, stored exchanges and
 * credentials. Keeper registry-root rows (`rroots.`) keyed by this identifier are left too: a registry issuer
 * is refused, so any such row belongs to a registry the identifier does not own.
 *
 * Retirement is one-way, as for `retireHab`: the retired name cannot be reused with the same salt and
 * namespace, and the seeds of salt-derived keys stay derivable from the Keeper's root salt.
 */
import { ValidationError } from "../../core/errors.ts";
import { mailboxPollEndpoints } from "../mailbox/mailboxing.ts";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";

/** What {@link retireIdentifier} did. */
export interface RetiredIdentifier {
  pre: string;
  /** The local name the identifier had. */
  name: string;
  /** Current public keys whose held signers retirement dropped; empty for keys the Keeper stored. */
  released: string[];
  /** Mailbox (and witness) endpoints whose poll workers stop. */
  mailboxes: string[];
}

/**
 * Why `runtime` would refuse to retire `pre`, or null when {@link retireIdentifier} would retire it. A pure read;
 * the first refusal found is returned, `retireHab`'s own first.
 */
export function retireIdentifierRefusal(runtime: AgentRuntime, pre: string): string | null {
  const { hby } = runtime;
  const store = hby.retireRefusal(pre);
  if (store) return store;
  for (const [keys, record] of runtime.vdr?.reger.regs.getTopItemIter() ?? []) {
    if (record.prefix === pre) return `${pre} is the issuer of registry ${keys.join(".")}.`;
  }
  const acdc = runtime.acdc?.store;
  for (const [keys, record] of acdc?.records?.getTopItemIter() ?? []) {
    if (acdc!.event(record.registryKey)?.issuer === pre) return `${pre} is the issuer of registry ${keys.join(".")}.`;
  }
  const pending = runtime.delegating.pendingOf(pre);
  if (pending.length) return `${pre} has a pending delegated event: ${pending.join(", ")}.`;
  const proxied = runtime.delegating.proxiedBy(pre);
  if (proxied.length) return `${pre} is the delegation proxy of ${proxied.join(", ")}.`;
  const issuance = runtime.operations?.issuance.grantsOf(pre) ?? [];
  if (issuance.length) return `${pre} has live issuance operations: ${issuance.join(", ")}.`;
  const unblinding = runtime.operations?.unblinding.grantsOf(pre) ?? [];
  if (unblinding.length) return `${pre} has live Unblind operations: ${unblinding.join(", ")}.`;
  for (const evt of runtime.postman.evts) {
    if (evt.src === pre) return `${pre} has queued outgoing messages.`;
  }
  if (runtime.querying.hasRequestsSignedBy(pre)) return `${pre} signs queued queries.`;
  if (runtime.querying.defaultSigner === pre) return `${pre} is the runtime's configured query signer.`;
  return null;
}

/**
 * Retire `pre`: `Habery.retireHab` (which drops its held signers), then delete its mailbox cursors and KEL
 * publisher rows, and prompt the mailbox poller and KEL publisher. Makes no event and signs nothing.
 *
 * @throws ValidationError with {@link retireIdentifierRefusal}'s reason, before any write.
 */
export function retireIdentifier(runtime: AgentRuntime, pre: string): RetiredIdentifier {
  const refusal = retireIdentifierRefusal(runtime, pre);
  if (refusal) throw new ValidationError(refusal);
  const { hby } = runtime;
  const hab = hby.habs.get(pre);
  const mailboxes = hab ? [...new Set(mailboxPollEndpoints(hab).map((endpoint) => endpoint.eid))] : [];
  const { name, released } = hby.retireHab(pre);
  hby.db.transaction(() => {
    hby.db.tops.trim([pre], { topive: true });
    hby.db.kpub.trim([pre], { topive: true });
  });
  runtime.mailboxPoller.prompt(pre);
  runtime.kelPublisher.prompt(pre);
  return { pre, name, released, mailboxes };
}
