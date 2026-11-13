/**
 * Runtime-owned registry of IPEX auxiliary owners (DH and Unblind), keyed by local identifier.
 *
 * The runtime registers one query receiver and one reply resource per route. Both resolve the
 * addressed local identifier at dispatch time and create that identifier's owner then, so a wallet
 * with several identifiers needs no owner before the first message and no hook when an identifier
 * is made, joined or reloaded.
 *
 * Dispatch key: an `/ipex/*` message carries the sender (`pre`) and the transaction id (`q.x` for
 * a query, `a.x` for a reply) but no recipient. The addressed local identifier is, from stored state:
 * the holder of an approved operation for that id; for DH the recipient of a Grant `sender` opened in
 * that transaction, and for Unblind the sender of a Grant addressed to `sender`; and, for a local
 * group, itself when it is `sender` (its own members' contributions, which KRAM must pool). Exactly one
 * such identifier owns the message; none or several leave it unowned, which is exactly a runtime without
 * that owner: queries drop as `missingProcessor` before KRAM, and replies fail with the Router's
 * missing-route error. Creating an owner grants no consent.
 */
import type { SerderKERI } from "cesr-ts";
import { Dhke } from "../../acdc/dhking.ts";
import type { RegistryObserver } from "../../acdc/observing.ts";
import { Unblind } from "../../acdc/unblinding.ts";
import type { KeriDispatchEnvelope } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Revery, Router } from "../../core/routing.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { AuxiliaryQueryProcessor, DispatchDecision } from "../protocol/parsering.ts";

type Owner = Dhke | Unblind;
type Kind = "dhke" | "unblind";
type ReplyArgs = Parameters<Dhke["processReply"]>[0] & Parameters<Unblind["processReply"]>[0];

/** Per-identifier DH and Unblind owners behind one query receiver and one reply route each. */
export class IpexAuxiliaries implements AuxiliaryQueryProcessor {
  /** Unused: `claims` decides which queries this receiver takes. */
  readonly resource = "/ipex";
  private readonly dhkes = new Map<string, Dhke>();
  private readonly unblinds = new Map<string, Unblind>();

  /**
   * @param exc Exchanger shared by every owner.
   * @param registry Public registry observer shared by every owner.
   * @param rvy Reply verifier whose router the owners' routes are registered on.
   * @param now Receiver clock shared by every owner.
   * @param kram Whether KRAM is enabled; with it off, `approve` of either owner throws.
   */
  constructor(
    private readonly exc: Exchanger,
    private readonly registry: RegistryObserver,
    private readonly rvy: Revery,
    private readonly now: () => number,
    /** Whether the runtime's KRAM is on; DH and Unblind approval need the rows only KRAM writes. */
    private readonly kram: boolean,
  ) {}

  private restored = false;

  /** Every live DH owner, for hosts draining their completion cues. */
  dhkeOwners(): IterableIterator<Dhke> {
    return this.dhkes.values();
  }

  /** Every live Unblind owner, for hosts delivering the replies they owe. */
  unblindOwners(): IterableIterator<Unblind> {
    if (!this.restored) {
      // A request persisted before a restart is owed its reply by an owner nothing has created yet.
      this.restored = true;
      const owed = new Set([...this.exc.hby.db.heldu.getTopItemIter()].map(([[pre]]) => pre));
      for (const pre of owed) {
        const hab = this.exc.hby.habs.get(pre);
        if (!hab) continue;
        try {
          this.unblind(hab);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
        }
      }
    }
    return this.unblinds.values();
  }

  /** Register the DH and Unblind reply routes once; owners are looked up on each reply. */
  registerReplyRoutes(rtr: Router): void {
    rtr.addRoute(Dhke.Route, { processReply: (args: ReplyArgs) => this.reply("dhke", args) });
    rtr.addRoute(Unblind.Route, { processReply: (args: ReplyArgs) => this.reply("unblind", args) });
  }

  /** The DH owner for `hab`, created on first use and recreated when `hab` is no longer the owner's object. */
  dhke(hab: Hab): Dhke {
    const current = this.dhkes.get(hab.pre!);
    if (current?.hab === hab) return current;
    const owner = new Dhke({
      hab,
      exc: this.exc,
      registryStore: this.registry.store,
      rvy: this.rvy,
      now: this.now,
      kram: this.kram,
    });
    current?.close();
    this.dhkes.set(hab.pre!, owner);
    return owner;
  }

  /** The Unblind owner for `hab`, created on first use and recreated when `hab` is no longer the owner's object. */
  unblind(hab: Hab): Unblind {
    const current = this.unblinds.get(hab.pre!);
    if (current?.hab === hab) return current;
    const owner = new Unblind({ hab, exc: this.exc, registry: this.registry, rvy: this.rvy, kram: this.kram });
    current?.close();
    this.unblinds.set(hab.pre!, owner);
    return owner;
  }

  /** Close and unregister both owners of `pre`; process-local approvals and retries are cleared. */
  release(pre: string): void {
    this.restored = false;
    for (const owners of [this.dhkes, this.unblinds] as Map<string, Owner>[]) {
      owners.get(pre)?.close();
      owners.delete(pre);
    }
  }

  /** Close every owner; the runtime calls this on explicit close and scope exit. */
  close(): void {
    for (const owner of [...this.dhkes.values(), ...this.unblinds.values()]) owner.close();
    this.dhkes.clear();
    this.unblinds.clear();
  }

  claims(serder: SerderKERI): boolean {
    return this.select(serder).length > 0;
  }

  /**
   * Every local party to the transaction takes the query: a Habery that holds both sides of a Grant has the sender's
   * owner (its own threshold query) and the recipient's (the query received), and each decides by its own role.
   */
  processQuery(envelope: KeriDispatchEnvelope): DispatchDecision {
    const owners = this.select(envelope.serder);
    const decisions = owners.map((owner): DispatchDecision => {
      try {
        return owner.processQuery(envelope);
      } catch (error) {
        // With two parties, the one that is not the query's audience may refuse it; the other still decides.
        if (owners.length > 1 && error instanceof ValidationError) return { kind: "drop", reason: "missingProcessor" };
        throw error;
      }
    });
    return decisions.find((decision) => decision && decision.kind === "accept") ?? decisions[0]
      ?? { kind: "drop", reason: "missingProcessor" };
  }

  private reply(kind: Kind, args: ReplyArgs) {
    const owners = this.claimants(kind, args.serder.pre, (args.serder.sad?.a as { x?: unknown } | undefined)?.x);
    if (!owners.length) throw new ValidationError(`No resource is registered to handle route ${args.route}`);
    let accepted: ReturnType<Owner["processReply"]> | undefined, failure: unknown;
    for (const owner of owners) {
      try {
        const decision = owner.processReply(args);
        accepted ??= decision;
      } catch (error) {
        failure ??= error;
      }
    }
    if (accepted === undefined) throw failure;
    return accepted;
  }

  private select(serder: SerderKERI): Owner[] {
    const kind = serder.route === Dhke.Route ? "dhke" : serder.route === Unblind.Route ? "unblind" : null;
    return kind ? this.claimants(kind, serder.pre, (serder.sad?.q as { x?: unknown } | undefined)?.x) : [];
  }

  /**
   * The owners of the local identifiers party to the transaction, created now if needed; none means unowned.
   * Parties come from live owners (approved operations) and from the store. Usually one; two when this Habery
   * holds both the sender and the recipient.
   */
  private claimants(kind: Kind, sender: string | null, xid: unknown): Owner[] {
    if (!sender || typeof xid !== "string") return [];
    const owners = kind === "dhke" ? this.dhkes : this.unblinds;
    const habs = this.exc.hby.habs;
    const parties = new Set<string>();
    for (const [pre, owner] of owners) if (owner.inTransaction(sender, xid)) parties.add(pre);
    if (kind === "dhke") {
      for (const recipient of Dhke.recipients(this.exc.hby.db, sender, xid)) {
        if (habs.has(recipient)) parties.add(recipient);
      }
    } else {
      for (const pre of habs.keys()) {
        if (Unblind.recipients(this.exc.hby.db, pre, xid).includes(sender)) parties.add(pre);
      }
    }
    const group = habs.get(sender);
    if (group && isLocalGroupHab(this.exc.hby, group)) parties.add(sender);
    // Two parties are one transaction only when the sender is itself local: its owner and the recipient's.
    if (parties.size < 1 || (parties.size > 1 && !(parties.size === 2 && parties.has(sender)))) {
      return [];
    }
    const owned: Owner[] = [];
    for (const pre of parties) {
      const hab = habs.get(pre);
      if (!hab) {
        this.release(pre);
        continue;
      }
      try {
        owned.push(kind === "dhke" ? this.dhke(hab) : this.unblind(hab));
      } catch (error) {
        // A group without a local signing member cannot own the route.
        if (!(error instanceof ValidationError)) throw error;
      }
    }
    return owned;
  }
}
