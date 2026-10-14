/** Internal cue retention admission; production runtime wiring waits for every producer/consumer port. */
import { Indexer, Matter, ResourceAdmissionError, ResourceLimitError, type ResourcePolicy, Serder } from "cesr-ts";
import type { AgentCue } from "./cues.ts";
import { Deck, DeckFullError } from "./deck.ts";
import { RawRecord } from "./records.ts";

const ownerDecks = new WeakMap<OwnedCue, CueDeck>();

/** One cue reference. Borrow its data only while this handle remains live. */
export class OwnedCue {
  private live = true;
  constructor(
    private value: AgentCue | undefined,
    private dispose: (() => void) | undefined,
    private duplicate: (() => OwnedCue) | undefined,
  ) {}
  get cue(): AgentCue {
    if (!this.live) throw new Error("Cue owner is released or transferred");
    return this.value!;
  }
  /** Move ownership without returning byte/item credit at the handoff. */
  transfer(): OwnedCue {
    const cue = this.cue;
    const next = new OwnedCue(cue, this.dispose, this.duplicate);
    ownerDecks.set(next, ownerDecks.get(this)!);
    this.invalidate();
    return next;
  }
  /** Admit another reference for request fanout; payload credit stays shared. */
  retain(): OwnedCue {
    void this.cue;
    return this.duplicate!();
  }
  /** Call after consumption and joined cleanup; repeated releases are harmless. */
  release(): void {
    if (!this.live) return;
    const dispose = this.dispose!;
    this.invalidate();
    dispose();
  }
  private invalidate(): void {
    this.live = false;
    this.value = undefined;
    this.dispose = this.duplicate = undefined;
  }
}

/** Prepared slots/bytes are held before side effects and cannot be stolen by another producer. */
export interface PreparedCueBatch {
  /** Publish the finite batch atomically into its existing Deck seam. */
  publish(): void;
  /** Roll back unpublished preparation; published ownership belongs to the deck/consumer. */
  release(): void;
}

/** Measure canonical cue records without encoding/copying their data or invoking accessors. */
function retainedBytes(cues: readonly AgentCue[], maxNodes: number): number {
  const seen = new Set<object>();
  let bytes = 64 + 128 * cues.length, nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (++nodes > maxNodes || depth > 64) throw new ResourceLimitError("Cue metadata inspection exceeds policy");
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      bytes += 2 * value.length;
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      bytes += 8;
      return;
    }
    if (typeof value !== "object") throw new RangeError("Unsupported retained cue value");
    if (seen.has(value)) return;
    seen.add(value);
    bytes += 64;
    if (ArrayBuffer.isView(value)) {
      visit(value.buffer, depth + 1);
      return;
    }
    if (value instanceof ArrayBuffer) {
      if (value.resizable) throw new RangeError("Resizable cue backing is unsupported");
      bytes += value.byteLength;
      return;
    }
    const proto = Object.getPrototypeOf(value);
    if (
      proto !== null && proto !== Object.prototype && !Array.isArray(value)
      && !(value instanceof Serder || value instanceof RawRecord || value instanceof Matter || value instanceof Indexer)
    ) throw new RangeError("Unsupported retained cue owner");
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, "value")) throw new RangeError("Cue metadata accessors are unsupported");
      bytes += 16 + 2 * key.length;
      visit(descriptor.value, depth + 1);
    }
  }
  for (const cue of cues) {
    // Replay closures need explicit captured-range metadata; inspecting them would open arbitrary work.
    const kind = Object.getOwnPropertyDescriptor(cue, "kin");
    if (!kind || !Object.hasOwn(kind, "value")) throw new RangeError("Cue metadata accessors are unsupported");
    if (kind.value === "replay") throw new RangeError("Opaque replay cue retention is not yet admitted");
    visit(cue, 0);
  }
  if (!Number.isSafeInteger(bytes)) throw new RangeError("Unsafe cue byte charge");
  return bytes;
}

/**
 * AgentCue-only admission on the existing Deck. Held items include preparation,
 * queued cues and transferred/fanout handles. Pulling never returns their credit.
 * Payloads must remain immutable until final release; this is logical retention
 * accounting, not a native heap/RSS measurement or durable delivery journal.
 */
export class CueDeck extends Deck<AgentCue> {
  private held = 0;
  private publishing = false;
  private readonly owners = new Map<AgentCue, OwnedCue[]>();
  constructor(
    private readonly resources: ResourcePolicy,
    capacity = 1024,
    private readonly maxNodes = 65536,
  ) {
    super(undefined, capacity);
    if (!Number.isSafeInteger(capacity) || capacity < 0 || !Number.isSafeInteger(maxNodes) || maxNodes < 1) {
      throw new RangeError("Invalid cue admission limits");
    }
  }
  override get capacity(): number {
    return super.capacity;
  }
  override set capacity(value: number) {
    if (!Number.isSafeInteger(value) || value < (this.held ?? 0)) throw new RangeError("Invalid held cue capacity");
    super.capacity = value;
  }
  override checkSpace(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid cue admission count");
    if (this.publishing) return;
    if (count > this.capacity) throw new ResourceLimitError("Cue batch exceeds item capacity");
    if (count > this.capacity - this.held) throw new DeckFullError("Cue item capacity is occupied");
  }
  /** Reserve the actual batch before durable writes; finally release unused preparation. */
  prepare(cues: readonly AgentCue[]): PreparedCueBatch {
    this.checkSpace(cues.length);
    if (!cues.length) throw new RangeError("Empty cue preparation");
    const credit = this.resources.reserve({ bytes: retainedBytes(cues, this.maxNodes) });
    if (credit.kind === "refuse") throw new ResourceAdmissionError("Cue byte admission refused", credit.reason);
    let values: AgentCue[];
    try {
      values = [...cues];
    } catch (error) {
      credit.reservation.release();
      throw error;
    }
    const count = values.length;
    this.held += count;
    let state: "prepared" | "published" | "released" = "prepared";
    let references = count;
    const makeOwner = (cue: AgentCue, extra?: { release(): void }): OwnedCue => {
      const owner = new OwnedCue(cue, () => {
        extra?.release();
        this.held--;
        if (--references === 0) credit.reservation.release();
      }, () => {
        this.checkSpace();
        const duplicate = this.resources.reserve({ bytes: 128 });
        if (duplicate.kind === "refuse") {
          throw new ResourceAdmissionError("Cue fanout admission refused", duplicate.reason);
        }
        this.held++;
        references++;
        return makeOwner(cue, duplicate.reservation);
      });
      ownerDecks.set(owner, this);
      return owner;
    };
    const release = () => {
      if (state !== "prepared") return;
      state = "released";
      this.held -= count;
      values = [];
      credit.reservation.release();
    };
    return {
      release,
      publish: () => {
        if (state !== "prepared") throw new Error("Cue preparation is no longer publishable");
        try {
          this.publishing = true;
          super.extend(values);
          for (const cue of values) {
            const owners = this.owners.get(cue) ?? [];
            owners.push(makeOwner(cue));
            this.owners.set(cue, owners);
          }
          state = "published";
          values = [];
        } catch (error) {
          release();
          throw error;
        } finally {
          this.publishing = false;
        }
      },
    };
  }
  override append(cue: AgentCue): number {
    this.prepare([cue]).publish();
    return this.length;
  }
  override extend(cues: Iterable<AgentCue>): number {
    const values: AgentCue[] = [];
    for (const cue of cues) {
      this.checkSpace(values.length + 1);
      values.push(cue);
    }
    if (values.length) this.prepare(values).publish();
    return this.length;
  }
  override prepend(_cue: AgentCue): number {
    throw new Error("Requeue the existing owned cue; do not create a second admission");
  }
  override pull(): AgentCue | undefined {
    throw new Error("Admitted cues require takeOwned ownership transfer");
  }
  override pop(): AgentCue | undefined {
    throw new Error("Admitted cues require takeOwned ownership transfer");
  }
  /** Transfer one queued owner; it still occupies item/byte credit until released. */
  takeOwned(): OwnedCue | undefined {
    const cue = super.pull();
    if (!cue) return;
    const owners = this.owners.get(cue)!;
    const owner = owners.shift()!;
    if (!owners.length) this.owners.delete(cue);
    return owner;
  }
  /** Return failed/untransferred work to the head without releasing/reacquiring its credit. */
  requeue(owner: OwnedCue): void {
    const cue = owner.cue;
    if (ownerDecks.get(owner) !== this) throw new Error("Cue belongs to another admission deck");
    try {
      this.publishing = true;
      super.prepend(cue);
    } finally {
      this.publishing = false;
    }
    const owners = this.owners.get(cue) ?? [];
    owners.unshift(owner.transfer());
    this.owners.set(cue, owners);
  }
  /** Discard queued work only; active transferred owners retain their credit. */
  override clear(): void {
    for (const owners of this.owners.values()) for (const owner of owners) owner.release();
    this.owners.clear();
    super.clear();
  }
}
