/**
 * Root replication as a runtime reaction: `/registry/root` copies a group member owes
 * are worked out from state and sent without any command asking.
 *
 * A group's registry root is retained by one custodian, so every other current
 * member must be sent a sealed copy (KERIpy `replicate` cue, Locksmith
 * `root_replicating`). Nothing is queued durably. A pass derives what is owed: for each
 * local group, each registry whose root this member holds, and each other current signing
 * member, a copy is owed unless `Baser.rrsn` shows one sent to the key the member
 * currently contributes to the group. A new member has no row and a rekeyed member's row
 * holds its old key, so both are owed a (re-sealed) copy after an accepted rotation. The
 * marker is written when the Poster reports a copy sent, and holds the recipient's public
 * key, never a root. A crash between send and marker costs one harmless resend, since
 * receiving is idempotent.
 *
 * A pass runs for a group on the replicator's first pass, after its latest establishment
 * changes (an accepted rotation), and when the Dhke completion cue prompts it, so a cue
 * lost in a crash is recovered by the next start. Sending a root a member already holds to
 * the group's current members is not a new consent, so nothing here asks anyone.
 *
 * A copy that cannot be prepared or delivered stays owed and is retried with a
 * process-local backoff; `status` reports it until it goes.
 */
import type { Operation } from "effection";
import type { DhkeReplicate } from "../../acdc/dhking.ts";
import type { RegistryRoot } from "../../acdc/salting.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab } from "../identity/habbing.ts";
import { isLocalGroupHab, localGroupMember } from "../multisig/group-members.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { ChangeSink } from "../runtime/workflow-contract.ts";
import { replicateRootCopy, type RootCopyResult, RootResealBudgetMs } from "./root-replicating.ts";

/** Most copies one `processOnce` attempts, so a first pass over a large store cannot stall the runtime. */
export const RootSendsPerPass = 4;
/** Process-local retry delay after a copy's first failed attempt; doubles per attempt up to {@link RootRetryMaxMs}. */
export const RootRetryBaseMs = 1_000;
export const RootRetryMaxMs = 300_000;

/** A copy still owed and the error of its last attempt (null before the first attempt). */
export interface OwedCopyStatus {
  group: string;
  registry: string;
  recipient: string;
  attempts: number;
  lastFailure: unknown;
}

export interface RootReplicatorStatus {
  owed: OwedCopyStatus[];
}

/** The declared collaborators; no runtime bundle. `postman.deliverDo` is run by the host. */
export interface RootReplicatorDeps {
  root: RegistryRoot;
  postman: Poster;
  clock: RuntimeClock;
  changes?: ChangeSink;
}

interface Pending extends OwedCopyStatus {
  retryAt: number;
}

const idOf = (group: string, registry: string, recipient: string) => [group, registry, recipient].join("/");

/**
 * Derives, sends and records registry root copies for a wallet's local groups.
 *
 * Holds no durable state of its own beyond `Baser.rrsn`; what is pending and the
 * backoff are process-local and rebuilt from state. A host calls `prompt` (or
 * `replicate`) for each Dhke cue and `processOnce` on its loop; both are safe to repeat,
 * and overlapping `processOnce` calls never send one copy twice.
 */
export class RootReplicator {
  readonly #deps: RootReplicatorDeps;
  readonly #pending = new Map<string, Pending>();
  readonly #inflight = new Set<string>();
  readonly #seen = new Map<string, string>();
  readonly #dirty = new Set<string>();
  #pruned = false;

  constructor(deps: RootReplicatorDeps) {
    this.#deps = deps;
  }

  /** Re-derive `group`'s owed copies on the next pass and retry its failed copies at once. */
  prompt(group: string): void {
    this.#dirty.add(group);
    for (const entry of this.#pending.values()) if (entry.group === group) entry.retryAt = 0;
  }

  /** The Dhke completion cue: a prompt to run the pass now, not the source of truth. */
  replicate(cue: Pick<DhkeReplicate, "gid" | "registries">): void {
    this.prompt(cue.gid);
  }

  /**
   * Derive what is owed, then send up to {@link RootSendsPerPass} due copies within
   * `timeoutMs`. A copy is recorded when sent and kept for retry otherwise. Never throws
   * on a remote failure; every attempt is returned. The host runs `postman.deliverDo`.
   */
  *processOnce({ timeoutMs = RootResealBudgetMs }: { timeoutMs?: number } = {}): Operation<RootCopyResult[]> {
    const { clock } = this.#deps, deadline = clock.now() + Math.max(timeoutMs, 0);
    this.#refresh();
    const results: RootCopyResult[] = [];
    for (const entry of [...this.#pending.values()]) {
      if (results.length >= RootSendsPerPass) break;
      if (entry.retryAt > clock.now()) continue;
      const result = yield* this.#attempt(entry.group, entry.registry, entry.recipient, deadline);
      if (!result) continue;
      results.push(result);
      if (result.kin === "sent") {
        this.#pending.delete(idOf(entry.group, entry.registry, entry.recipient));
      } else {
        entry.attempts += 1;
        entry.lastFailure = result.error;
        entry.retryAt = clock.now() + Math.min(RootRetryBaseMs * 2 ** (entry.attempts - 1), RootRetryMaxMs);
      }
    }
    return results;
  }

  /**
   * Send each registry's root to each recipient now, whatever was sent before, as an
   * explicit command does; a sent copy is recorded like any other. `recipients` defaults
   * to every other current signing member.
   */
  *send(
    ghab: Hab,
    registries: readonly string[],
    { recipients, timeoutMs }: { recipients?: readonly string[]; timeoutMs: number },
  ): Operation<RootCopyResult[]> {
    const { root, clock } = this.#deps, gid = ghab.pre!, deadline = clock.now() + Math.max(timeoutMs, 0);
    const sender = localGroupMember(root.hby, gid).pre;
    const targets = recipients ?? root.members(gid).filter(aid => aid !== sender);
    const results: RootCopyResult[] = [];
    for (const registry of registries) {
      for (const recipient of targets) {
        const result = yield* this.#attempt(gid, registry, recipient, deadline);
        if (result) results.push(result);
      }
    }
    return results;
  }

  /** Whether a copy is owed or a group is waiting to be re-derived; in memory, reads no store. */
  pending(): boolean {
    return this.#pending.size > 0 || this.#dirty.size > 0;
  }

  /** Pure read: what is owed and why it has not gone yet. */
  status(): RootReplicatorStatus {
    return {
      owed: [...this.#pending.values()].map(({ retryAt: _retryAt, ...entry }) => ({ ...entry })),
    };
  }

  /** Deliver one copy unless an overlapping call already is; record it when sent. */
  *#attempt(group: string, registry: string, recipient: string, deadline: number): Operation<RootCopyResult | null> {
    const { root, postman, clock, changes } = this.#deps, id = idOf(group, registry, recipient);
    if (this.#inflight.has(id)) return null;
    this.#inflight.add(id);
    try {
      const key = root.contributor(group, recipient);
      const result = yield* replicateRootCopy(root, postman, clock, group, registry, recipient, deadline);
      if (result.kin === "sent" && key) {
        root.hby.db.rrsn.pin([group, registry, recipient], { key, dt: new Date(clock.now()).toISOString() });
      }
      changes?.push({ kind: "group", id: group });
      return result;
    } finally {
      this.#inflight.delete(id);
    }
  }

  /** Re-derive the owed copies of each local group that is new, rotated or prompted. */
  #refresh(): void {
    const { root } = this.#deps, hby = root.hby;
    if (!this.#pruned) {
      this.#pruned = true;
      for (const [[group]] of [...hby.db.rrsn.getTopItemIter()]) {
        if (!hby.db.getHab(group)?.mid) hby.db.rrsn.trim(group, { topive: true });
      }
    }
    for (const hab of hby.habs.values()) {
      const established = hab.pre && isLocalGroupHab(hby, hab) ? hab.kever?.lastEst.d : null;
      if (!established || (this.#seen.get(hab.pre!) === established && !this.#dirty.has(hab.pre!))) continue;
      this.#seen.set(hab.pre!, established);
      this.#dirty.delete(hab.pre!);
      this.#derive(hab.pre!);
    }
  }

  /** Replace `group`'s pending copies with those its held roots and current members owe, and drop stale markers. */
  #derive(group: string): void {
    const { root, changes } = this.#deps, db = root.hby.db;
    const sender = localGroupMember(root.hby, group).pre, registries = root.held(group);
    const members = root.members(group).filter(aid => aid !== sender);
    const wanted = new Set<string>();
    for (const registry of registries) {
      for (const recipient of members) {
        const id = idOf(group, registry, recipient);
        wanted.add(id);
        if (db.rrsn.get([group, registry, recipient])?.key === root.contributor(group, recipient)) {
          this.#pending.delete(id);
        } else if (!this.#pending.has(id)) {
          this.#pending.set(id, { group, registry, recipient, attempts: 0, lastFailure: null, retryAt: 0 });
        }
      }
    }
    for (const [id, entry] of [...this.#pending]) {
      if (entry.group === group && !wanted.has(id)) this.#pending.delete(id);
    }
    for (const [[, registry, recipient]] of [...db.rrsn.getTopItemIter(group, { topive: true })]) {
      if (!wanted.has(idOf(group, registry, recipient))) db.rrsn.rem([group, registry, recipient]);
    }
    if (wanted.size) changes?.push({ kind: "group", id: group });
  }
}
