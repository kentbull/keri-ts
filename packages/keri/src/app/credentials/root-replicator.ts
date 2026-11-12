/**
 * Root replication as a runtime reaction: owed `/registry/root` copies, kept in the
 * embedder's own ledger, are sent without any command asking.
 *
 * A group's registry root is retained by one custodian, so every other current
 * member must be sent a sealed copy (KERIpy `replicate` cue, Locksmith
 * `root_replicating`). Two triggers owe copies, a cue and a scan, and `processOnce`
 * sends what is owed. Sending a root a member already holds to the group's current
 * members is not a new consent, so nothing here asks anyone.
 *
 * - The Dhke completion cue (`DhkeReplicate`) owes every other current member.
 * - The scan examines each local group's latest establishment once, and for an
 *   accepted rotation owes members that are new or whose contributing key changed
 *   (`RegistryRoot.resealed`). It exists because a cue is lost when the process
 *   dies between acceptance and send.
 *
 * Receiving is idempotent, so at-least-once delivery is correct and a ledger may
 * be replayed. A row stays owed while local evidence is missing or delivery fails,
 * and is settled once sent or when the copy can never be authorized. The ledger
 * holds coordinates only and never a root.
 */
import type { Operation } from "effection";
import type { DhkeReplicate } from "../../acdc/dhking.ts";
import type { RegistryRoot } from "../../acdc/salting.ts";
import { AppError } from "../../core/errors.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab } from "../identity/habbing.ts";
import { isLocalGroupHab, localGroupMember } from "../multisig/group-members.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { ChangeSink } from "../runtime/workflow-contract.ts";
import {
  replicateRootCopy,
  type RootCopyReport,
  RootResealBudgetMs,
  type RootResealFailure,
} from "./root-replicating.ts";

/** One owed copy: non-secret coordinates; `rotation` is the accepted rotation that owed it, null for issuance. */
export interface OwedCopy {
  group: string;
  registry: string;
  recipient: string;
  rotation: string | null;
}

/**
 * The embedder's record of owed copies and examined rotations. Methods are
 * synchronous, so an embedder over an async store keeps a cache and flushes it.
 * `owe` is idempotent per (group, registry, recipient).
 */
export interface RootLedger {
  owed(): OwedCopy[];
  owe(copy: OwedCopy): void;
  settle(copy: OwedCopy): void;
  examined(group: string, rotation: string): boolean;
  markExamined(group: string, rotation: string): void;
}

/** Non-durable ledger: the CLI's fire-and-forget behavior, and a reference for embedders' stores. */
export class MemoryRootLedger implements RootLedger {
  readonly #owed = new Map<string, OwedCopy>();
  readonly #examined = new Set<string>();
  owed(): OwedCopy[] {
    return [...this.#owed.values()].map(copy => ({ ...copy }));
  }
  owe(copy: OwedCopy): void {
    const key = [copy.group, copy.registry, copy.recipient].join("/");
    if (!this.#owed.has(key)) this.#owed.set(key, { ...copy });
  }
  settle(copy: OwedCopy): void {
    this.#owed.delete([copy.group, copy.registry, copy.recipient].join("/"));
  }
  examined(group: string, rotation: string): boolean {
    return this.#examined.has(`${group}/${rotation}`);
  }
  markExamined(group: string, rotation: string): void {
    this.#examined.add(`${group}/${rotation}`);
  }
}

/** An owed copy and why its last attempt did not send it (null before the first attempt). */
export interface OwedCopyStatus extends OwedCopy {
  lastFailure: string | null;
}

export interface RootReplicatorStatus {
  owed: OwedCopyStatus[];
  /** Rotations the last pass could not examine, reported once and not retried. */
  examinations: RootResealFailure[];
}

/** The declared collaborators; no runtime bundle. `postman.deliverDo` is run by the host. */
export interface RootReplicatorDeps {
  root: RegistryRoot;
  postman: Poster;
  clock: RuntimeClock;
  ledger: RootLedger;
  changes?: ChangeSink;
}

/**
 * Owes, sends and settles registry root copies for a wallet's local groups.
 *
 * Holds no durable state of its own: owed copies and examined rotations live in the
 * `RootLedger`, and the last failure per copy is process-local status. A host calls
 * `replicate` for each Dhke cue and `processOnce` on its loop; both are safe to repeat.
 */
export class RootReplicator {
  readonly #deps: RootReplicatorDeps;
  readonly #failures = new Map<string, string>();
  #examinations: RootResealFailure[] = [];

  constructor(deps: RootReplicatorDeps) {
    this.#deps = deps;
  }

  /** Owe `cue.registries` held for the group to every other current member; returns rows newly owed. */
  replicate(cue: Pick<DhkeReplicate, "gid" | "registries">): number {
    const { root } = this.#deps;
    if (!root.hby.db.getHab(cue.gid)?.mid) return 0;
    const sender = localGroupMember(root.hby, cue.gid).pre;
    const held = new Set(root.held(cue.gid));
    return this.#owe(
      cue.gid,
      cue.registries.filter(registry => held.has(registry)),
      root.members(cue.gid).filter(aid => aid !== sender),
      null,
    );
  }

  /**
   * Owe `rotation`'s re-seal copies for every root held for `ghab`. Returns the
   * failure when the rotation cannot be examined at all, as `resealRegistryRoots` does.
   */
  examine(ghab: Hab, rotation: string): RootResealFailure | null {
    const { root } = this.#deps;
    let recipients: string[];
    try {
      recipients = root.resealed(ghab, rotation);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const failure: RootResealFailure = {
        phase: "root_copy",
        gid: ghab.pre!,
        rotation,
        transmitted: false,
        error: error.message,
      };
      return failure;
    }
    this.#owe(ghab.pre!, root.held(ghab.pre!), recipients, rotation);
    return null;
  }

  /** Examine each local group's latest establishment once; an unexaminable rotation is reported, not retried. */
  scan(): void {
    const { root, ledger } = this.#deps, hby = root.hby;
    this.#examinations = [];
    for (const hab of hby.habs.values()) {
      const lastEst = hab.pre && isLocalGroupHab(hby, hab) ? hab.kever?.lastEst : null;
      if (!lastEst || lastEst.s === 0 || ledger.examined(hab.pre!, lastEst.d)) continue;
      const failure = this.examine(hab, lastEst.d);
      if (failure) this.#examinations.push(failure);
      ledger.markExamined(hab.pre!, lastEst.d);
    }
  }

  /**
   * Scan, then send each owed copy once within `timeoutMs`. Settled when sent or
   * refused for good; kept when evidence is missing or delivery fails, to retry on
   * the next pass. Never throws on a remote failure; every attempt is reported.
   * The host runs `postman.deliverDo` for the duration.
   */
  *processOnce({ timeoutMs = RootResealBudgetMs }: { timeoutMs?: number } = {}): Operation<RootCopyReport[]> {
    const { root, postman, clock, ledger, changes } = this.#deps, deadline = clock.now() + Math.max(timeoutMs, 0);
    this.scan();
    const reports: RootCopyReport[] = [];
    for (const copy of ledger.owed()) {
      const { kin, report, failure } = yield* replicateRootCopy(
        root,
        postman,
        clock,
        copy.group,
        copy.registry,
        copy.recipient,
        deadline,
      );
      reports.push(report);
      const key = [copy.group, copy.registry, copy.recipient].join("/");
      if (kin === "sent" || kin === "refused") {
        ledger.settle(copy);
        this.#failures.delete(key);
      } else this.#failures.set(key, failure instanceof Error ? failure.message : String(failure));
      changes?.push({ kind: "group", id: copy.group });
    }
    return reports;
  }

  /** Pure read: what is owed and why it has not gone yet. */
  status(): RootReplicatorStatus {
    const owed = this.#deps.ledger.owed().map(copy => ({
      ...copy,
      lastFailure: this.#failures.get([copy.group, copy.registry, copy.recipient].join("/")) ?? null,
    }));
    return { owed, examinations: this.#examinations.map(failure => ({ ...failure })) };
  }

  #owe(group: string, registries: readonly string[], recipients: readonly string[], rotation: string | null): number {
    const { ledger, changes } = this.#deps, before = ledger.owed().length;
    for (const registry of registries) {
      for (const recipient of recipients) ledger.owe({ group, registry, recipient, rotation });
    }
    const added = ledger.owed().length - before;
    if (added) changes?.push({ kind: "group", id: group });
    return added;
  }
}
