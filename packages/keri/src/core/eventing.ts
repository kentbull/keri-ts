import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import type { SerderKERI, Siger } from "../../../cesr/mod.ts";
import { Baser } from "../db/basing.ts";
import { encodeDateTimeToDater } from "../app/keeping.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import type { FirstSeenReplayCouple } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import type { KeyStateRecord } from "./records.ts";

/**
 * Build one UTC ISO-8601 timestamp in the text form expected by KERI records.
 *
 * This is used only as a fallback when inbound first-seen material does not
 * provide a dater and the bootstrap runtime still needs a durable timestamp.
 */
function makeNowIso8601(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const micros = (now.getUTCMilliseconds() * 1000).toString().padStart(6, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

/**
 * Convert one simple hex threshold into a numeric signature threshold.
 *
 * Current `keri-ts` limitation:
 * - this bootstrap `Kevery` only supports simple numeric thresholds
 * - weighted thresholds and richer `Tholder` semantics remain later parity work
 */
function parseNumericThreshold(
  sith: string | null | undefined,
  count: number,
): number {
  if (!sith) {
    return Math.max(1, count);
  }
  const parsed = Number.parseInt(sith, 16);
  return Number.isNaN(parsed) ? Math.max(1, count) : parsed;
}

/**
 * Build the durable `states.` projection for one accepted bootstrap inception.
 *
 * This mirrors the KERI key-state record shape closely enough for Gate E OOBI
 * bootstrap, but it is not yet the full evolving-state updater used by a
 * complete `Kevery`.
 */
function makeKeyStateRecord(args: {
  pre: string;
  said: string;
  dt: string;
  ilk: string;
  fn: number;
  isith: string;
  nsith: string;
  keys: string[];
  ndigs: string[];
  toad: number;
  wits: string[];
  cnfg: string[];
  delpre?: string | null;
}): KeyStateRecord {
  return {
    vn: [1, 0],
    i: args.pre,
    s: "0",
    p: "",
    d: args.said,
    f: args.fn.toString(16),
    dt: args.dt,
    et: args.ilk,
    kt: args.isith,
    k: args.keys,
    nt: args.nsith,
    n: args.ndigs,
    bt: args.toad.toString(16),
    b: args.wits,
    c: args.cnfg,
    ee: {
      s: "0",
      d: args.said,
      br: [],
      ba: [],
    },
    di: args.delpre ?? "",
  };
}

/**
 * Normalized event envelope consumed by the bootstrap `Kevery`.
 *
 * The runtime is responsible for converting parser attachments into this
 * shape before calling `processEvent()`.
 */
export interface KeverEnvelope {
  serder: SerderKERI;
  sigers: Siger[];
  frcs: FirstSeenReplayCouple[];
}

/**
 * Minimal KEL event processor for Gate E bootstrap.
 *
 * Current scope:
 * - accepts and persists fresh `icp`/`dip` events with indexed signatures
 * - records first-seen ordinal/timestamp locally
 * - emits `keyStateSaved` cues on accepted state
 *
 * Deferred breadth:
 * - rotations, interactions, witness receipts, duplication handling, and the
 *   full escrow family remain follow-on work on this same surface
 */
export class Kevery {
  readonly db: Baser;
  readonly cues: Deck<AgentCue>;
  readonly local: boolean;

  /**
   * Create one bootstrap `Kevery` bound to one database and shared cue deck.
   *
   * `local` controls the provenance flag written into the event-source record
   * when an event is accepted.
   */
  constructor(
    db: Baser,
    { cues, local = false }: { cues?: Deck<AgentCue>; local?: boolean } = {},
  ) {
    this.db = db;
    this.cues = cues ?? new Deck();
    this.local = local;
  }

  /**
   * Process one normalized remote event envelope.
   *
   * Current scope:
   * - accepts fresh `icp` and `dip`
   *
   * Deferred parity:
   * - all later KEL ilks still intentionally fail fast so this bootstrap slice
   *   does not masquerade as a full `Kevery`
   */
  processEvent(envelope: KeverEnvelope): void {
    switch (envelope.serder.ilk) {
      case "icp":
      case "dip":
        this.processInception(envelope);
        return;
      default:
        throw new ValidationError(
          `Remote event ilk=${
            String(envelope.serder.ilk)
          } is not yet implemented in Kevery.`,
        );
    }
  }

  /** Placeholder for KERIpy out-of-order event escrow processing. */
  processEscrowOutOfOrders(): void {}
  /** Placeholder for KERIpy unverified witness-receipt escrow processing. */
  processEscrowUnverWitness(): void {}
  /** Placeholder for KERIpy unverified non-transferable receipt escrow processing. */
  processEscrowUnverNonTrans(): void {}
  /** Placeholder for KERIpy unverified transferable receipt escrow processing. */
  processEscrowUnverTrans(): void {}
  /** Placeholder for KERIpy partially verified delegated-event escrow processing. */
  processEscrowPartialDels(): void {}
  /** Placeholder for KERIpy partially verified witness-signature escrow processing. */
  processEscrowPartialWigs(): void {}
  /** Placeholder for KERIpy partially verified controller-signature escrow processing. */
  processEscrowPartialSigs(): void {}
  /** Placeholder for KERIpy duplicitous-event escrow processing. */
  processEscrowDuplicitous(): void {}
  /** Placeholder for KERIpy delegable-event escrow reprocessing. */
  processEscrowDelegables(): void {}
  /** Placeholder for KERIpy query-not-found escrow processing. */
  processQueryNotFound(): void {}

  /**
   * Run one full bootstrap KEL escrow sweep.
   *
   * The method ordering mirrors the planned Gate E continuous-loop order even
   * though the individual escrow handlers are still stubbed at this stage.
   */
  processEscrows(): void {
    this.processEscrowOutOfOrders();
    this.processEscrowUnverWitness();
    this.processEscrowUnverNonTrans();
    this.processEscrowUnverTrans();
    this.processEscrowPartialDels();
    this.processEscrowPartialWigs();
    this.processEscrowPartialSigs();
    this.processEscrowDuplicitous();
    this.processEscrowDelegables(); // TODO remove processEscrowDelegables from this call since it should be manual for now
    this.processQueryNotFound();
  }

  /**
   * Accept and persist one fresh inception or delegated inception event.
   *
   * Stores touched on success:
   * - `evts.`, `kels.`, `fels.`, `dtss.`, `sigs.`, `esrs.`, `states.`
   *
   * Side effects:
   * - emits one `keyStateSaved` cue with the durable key-state projection
   *
   * Current `keri-ts` differences:
   * - only first-seen bootstrap acceptance is implemented
   * - replay, rotation, interaction, receipts, and escrow recovery are still
   *   follow-on work
   */
  private processInception(envelope: KeverEnvelope): void {
    const { serder, sigers } = envelope;
    const pre = serder.pre;
    const said = serder.said;
    const sn = serder.sn;
    if (!pre || !said || sn === null) {
      throw new ValidationError(
        "Inception event must include pre, said, and sn.",
      );
    }
    if (sn !== 0) {
      throw new ValidationError(`Inception event ${said} must have sn=0.`);
    }
    if (this.db.getState(pre)) {
      return;
    }

    const verfers = serder.verfers;
    const threshold = parseNumericThreshold(
      serder.tholder?.sith,
      verfers.length,
    );
    const verified = new Set<number>();
    for (const siger of sigers) {
      const verfer = verfers[siger.index];
      if (!verfer || verified.has(siger.index)) {
        continue;
      }
      if (!ed25519.verify(siger.raw, serder.raw, verfer.raw)) {
        continue;
      }
      verified.add(siger.index);
    }
    if (verified.size < threshold) {
      throw new ValidationError(
        `Inception event ${said} does not meet signature threshold.`,
      );
    }

    this.db.putEvtSerder(pre, said, serder.raw);
    this.db.putKel(pre, 0, said);
    const fn = this.db.appendFel(pre, said);
    const firstSeen = envelope.frcs[0]?.dater.qb64 ??
      encodeDateTimeToDater(makeNowIso8601());
    this.db.putDts(pre, said, firstSeen);
    this.db.pinSigs(pre, said, sigers);
    this.db.pinEsr(pre, said, { local: this.local });
    const state = makeKeyStateRecord({
      pre,
      said,
      dt: envelope.frcs[0]?.dater.iso8601 ?? makeNowIso8601(),
      ilk: serder.ilk ?? "icp",
      fn,
      isith: serder.tholder?.sith ??
        `${Math.max(1, verfers.length).toString(16)}`,
      nsith: serder.ntholder?.sith ?? "0",
      keys: serder.keys,
      ndigs: serder.ndigs,
      toad: serder.bn ?? 0,
      wits: serder.backs,
      cnfg: serder.traits,
      delpre: serder.delpre,
    });
    this.db.pinState(pre, state);
    this.cues.push({ kin: "keyStateSaved", ksn: state });
  }
}
