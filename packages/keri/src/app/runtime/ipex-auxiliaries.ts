/**
 * Runtime-owned registry of IPEX auxiliary owners (DH and Unblind), keyed by local identifier.
 *
 * The runtime registers one query receiver and one reply resource per route. Both select the
 * owner of the addressed local identifier at dispatch time, so a wallet with several identifiers
 * gets one owner per identifier and kind, created or released after the runtime exists.
 *
 * Dispatch key: an `/ipex/*` message carries the sender (`pre`) and the transaction id (`q.x` for
 * a query, `a.x` for a reply) but no recipient. An owner claims (`inTransaction`) the pair when it holds an approved
 * operation for that id, or (queries only) a stored Grant between the same two parties. The sole
 * claimant handles the message; none or several claimants leave it unowned, which is exactly a
 * runtime without that owner: queries drop as `missingProcessor` before KRAM, and replies fail
 * with the Router's missing-route error. Construction of an owner grants no consent.
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
import type { AuxiliaryQueryProcessor, DispatchDecision } from "../protocol/parsering.ts";

type Owner = Dhke | Unblind;
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
   */
  constructor(
    private readonly exc: Exchanger,
    private readonly registry: RegistryObserver,
    private readonly rvy: Revery,
    private readonly now: () => number,
    /** Local identifiers whose DH owners must exist before traffic; omitted leaves owner creation to the caller. */
    private readonly habs?: ReadonlyMap<string, Hab>,
  ) {
    this.ensureDhkes();
  }

  /**
   * Create the DH owner of every local identifier that lacks one. A query names no recipient, so an
   * identifier created or joined after the runtime must own its route before the first query arrives;
   * this runs at construction, before each DH dispatch and on the owners loop. A group without a local
   * signing member cannot own DH and is skipped. Construction grants no consent.
   */
  ensureDhkes(): void {
    if (!this.habs) return;
    for (const hab of this.habs.values()) {
      if (this.dhkes.has(hab.pre!)) continue;
      try {
        this.dhke(hab);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
    }
  }

  /** Every live DH owner, for hosts draining their completion cues. */
  dhkeOwners(): IterableIterator<Dhke> {
    return this.dhkes.values();
  }

  /** Register the DH and Unblind reply routes once; owners are looked up on each reply. */
  registerReplyRoutes(rtr: Router): void {
    rtr.addRoute(Dhke.Route, { processReply: (args: ReplyArgs) => this.reply(this.dhkes, args) });
    rtr.addRoute(Unblind.Route, { processReply: (args: ReplyArgs) => this.reply(this.unblinds, args) });
  }

  /** The DH owner for `hab`, created and registered on first use. */
  dhke(hab: Hab): Dhke {
    let owner = this.dhkes.get(hab.pre!);
    if (!owner) {
      owner = new Dhke({ hab, exc: this.exc, registryStore: this.registry.store, rvy: this.rvy, now: this.now });
      this.dhkes.set(hab.pre!, owner);
    }
    return owner;
  }

  /** The Unblind owner for `hab`, created and registered on first use. */
  unblind(hab: Hab): Unblind {
    let owner = this.unblinds.get(hab.pre!);
    if (!owner) {
      owner = new Unblind({ hab, exc: this.exc, registry: this.registry, rvy: this.rvy, now: this.now });
      this.unblinds.set(hab.pre!, owner);
    }
    return owner;
  }

  /** Close and unregister both owners of `pre`; process-local approvals and retries are cleared. */
  release(pre: string): void {
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
    return this.select(serder) !== null;
  }

  processQuery(envelope: KeriDispatchEnvelope): DispatchDecision {
    return this.select(envelope.serder)?.processQuery(envelope) ?? { kind: "drop", reason: "missingProcessor" };
  }

  private reply(owners: Map<string, Owner>, args: ReplyArgs) {
    const owner = this.claimant(owners, args.serder.pre, (args.serder.sad?.a as { x?: unknown } | undefined)?.x);
    if (!owner) throw new ValidationError(`No resource is registered to handle route ${args.route}`);
    return owner.processReply(args);
  }

  private select(serder: SerderKERI): Owner | null {
    if (serder.route === Dhke.Route) this.ensureDhkes();
    const owners = serder.route === Dhke.Route ? this.dhkes : serder.route === Unblind.Route ? this.unblinds : null;
    return owners && this.claimant(owners, serder.pre, (serder.sad?.q as { x?: unknown } | undefined)?.x);
  }

  /** The one owner claiming the transaction; absent or ambiguous means unowned. */
  private claimant(owners: Map<string, Owner>, sender: string | null, xid: unknown): Owner | null {
    if (!sender || typeof xid !== "string") return null;
    const claimed = [...owners.values()].filter((owner) => owner.inTransaction(sender, xid));
    return claimed.length === 1 ? claimed[0] : null;
  }
}
