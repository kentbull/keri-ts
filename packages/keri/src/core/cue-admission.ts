/** Shared cue retention admission; the default runtime scopes queued owners through joined consumer cleanup. */
import {
  Indexer,
  Matter,
  ResourceAdmissionError,
  ResourceLimitError,
  type ResourcePolicy,
  type ResourceReservation,
  Serder,
} from "cesr-ts";
import { CapturedKelReplay } from "../db/kel-replay.ts";
import { CapturedTelReplay } from "../db/tel-replay.ts";
import type { CueQueue } from "./cue-publishing.ts";
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
    readonly retainedBytes: number,
  ) {}
  get cue(): AgentCue {
    if (!this.live) throw new Error("Cue owner is released or transferred");
    return this.value!;
  }
  /** Move ownership after optional synchronous atomic target admission, without returning credit. */
  transfer(accept?: (next: OwnedCue) => void): OwnedCue {
    const cue = this.cue;
    const next = new OwnedCue(cue, this.dispose, this.duplicate, this.retainedBytes);
    ownerDecks.set(next, ownerDecks.get(this)!);
    try {
      accept?.(next);
    } catch (error) {
      next.invalidate();
      throw error;
    }
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
    if (CapturedKelReplay.is(value)) {
      // Canonical frozen capture metadata is owned here; the runtime-owned Baser is only borrowed.
      bytes += 3 * 16 + 2 * ("ranges".length + "maxMessageBytes".length) + 8;
      visit(value.ranges, depth + 1);
      visit(value.maxMessageBytes, depth + 1);
      return;
    }
    if (CapturedTelReplay.is(value)) {
      // Fixed metadata and one borrowed Reger reference; never inspect the store or open its readers.
      bytes += 3 * 16 + 2 * ("ranges".length + "settings".length);
      visit(value.ranges, depth + 1);
      visit(value.settings, depth + 1);
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
    // Never open a replay to measure it: only canonical KEL/TEL captures or finite message arrays are inspectable.
    const kind = Object.getOwnPropertyDescriptor(cue, "kin");
    if (!kind || !Object.hasOwn(kind, "value")) throw new RangeError("Cue metadata accessors are unsupported");
    if (kind.value === "replay") {
      const messages = Object.getOwnPropertyDescriptor(cue, "messages");
      if (!messages || !Object.hasOwn(messages, "value")) {
        throw new RangeError("Cue metadata accessors are unsupported");
      }
      if (
        !CapturedKelReplay.is(messages.value) && !CapturedTelReplay.is(messages.value) && !Array.isArray(messages.value)
      ) {
        throw new RangeError("Opaque replay cue retention is not admitted");
      }
    }
    visit(cue, 0);
  }
  if (!Number.isSafeInteger(bytes)) throw new RangeError("Unsafe cue byte charge");
  return bytes;
}

/** Concrete cue retention credit; the measured logical charge follows its owner. */
export type CueByteReservation = ResourceReservation & { readonly bytes: number };
/** Only this operation's own capacity refusal is a value; inspection/service failures still throw. */
export type CueByteAdmission =
  | { kind: "reserve"; reservation: CueByteReservation }
  | { kind: "refuse"; error: ResourceAdmissionError };

/** Logical coexistence policy shared by strict and outcome-based retention admission. */
type CueByteLimits = { additionalBytes?: number; maxBytes?: number; copies?: number };

/** Strict producer boundary; runtime admission callers consume admitCueBytes directly. */
export function reserveCueBytes(
  resources: ResourcePolicy,
  cues: readonly AgentCue[],
  maxNodes?: number,
  onAdmissionRefusal?: (error: ResourceAdmissionError) => void,
  limits: CueByteLimits = {},
): CueByteReservation {
  const result = admitCueBytes(resources, cues, maxNodes, limits);
  if (result.kind === "refuse") {
    onAdmissionRefusal?.(result.error);
    throw result.error;
  }
  return result.reservation;
}

/**
 * Reserve canonical retention before copying/interpreting; caller releases after joined consumption.
 * Optional copies is conservative coexistence allowance, not a count of physical/native allocations.
 */
export function admitCueBytes(
  resources: ResourcePolicy,
  cues: readonly AgentCue[],
  maxNodes = 65536,
  limits: CueByteLimits = {},
): CueByteAdmission {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new RangeError("Invalid cue inspection limit");
  const { additionalBytes = 0, maxBytes = Number.MAX_SAFE_INTEGER, copies = 1 } = limits;
  if (!Number.isSafeInteger(copies) || copies < 1) throw new RangeError("Invalid cue copy allowance");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid cue byte limit");
  if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) throw new RangeError("Invalid cue byte floor");
  // Logical Set/descriptor/stack allowance precedes even the metadata walk.
  const inspectionBytes = 128 * maxNodes + 16 * cues.length + 16384;
  const inspection = resources.reserve({ bytes: inspectionBytes });
  if (inspection.kind === "refuse") {
    const refusal = new ResourceAdmissionError("Cue inspection admission refused", inspection.reason);
    return { kind: "refuse", error: refusal };
  }
  try {
    const measured = retainedBytes(cues, maxNodes);
    const bytes = measured * copies;
    if (!Number.isSafeInteger(bytes)) throw new RangeError("Unsafe cue copy allowance");
    if (measured > maxBytes) throw new ResourceLimitError("Cue retention exceeds finite byte limit");
    if (bytes > resources.limits.bytes - additionalBytes - (copies > 1 ? inspectionBytes : 0)) {
      const refusal = new ResourceAdmissionError("Cue retention exceeds combined byte capacity", "limit");
      return { kind: "refuse", error: refusal };
    }
    const retained = resources.reserve({ bytes });
    if (retained.kind === "refuse") {
      const refusal = new ResourceAdmissionError("Cue byte admission refused", retained.reason);
      return { kind: "refuse", error: refusal };
    }
    return { kind: "reserve", reservation: { bytes, release: () => retained.reservation.release() } };
  } finally {
    inspection.reservation.release();
  }
}

/**
 * AgentCue admission with one queue of owned handles. Held items include preparation,
 * queued cues and transferred/fanout handles. Pulling never returns their credit.
 * Payloads must remain immutable until final release; this is logical retention
 * accounting, not a native heap/RSS measurement or durable delivery journal.
 */
export class CueDeck implements CueQueue {
  private held = 0;
  private readonly owners = new Deck<OwnedCue>();
  private itemCapacity: number;
  constructor(
    private readonly resources: ResourcePolicy,
    capacity = 1024,
    private readonly maxNodes = 65536,
  ) {
    this.itemCapacity = capacity;
    if (!Number.isSafeInteger(capacity) || capacity < 0 || !Number.isSafeInteger(maxNodes) || maxNodes < 1) {
      throw new RangeError("Invalid cue admission limits");
    }
  }
  /** Retention and interpretation must share this exact ledger. */
  get resourcePolicy(): ResourcePolicy {
    return this.resources;
  }
  /** Batch credit cannot return while this queued head has a live owner; inspect without opening its evidence. */
  headRetentionBytes(): number {
    return this.owners.peekHead()?.retainedBytes ?? 0;
  }
  get capacity(): number {
    return this.itemCapacity;
  }
  set capacity(value: number) {
    if (!Number.isSafeInteger(value) || value < this.held) throw new RangeError("Invalid held cue capacity");
    this.itemCapacity = value;
  }
  get length(): number {
    return this.owners.length;
  }
  get empty(): boolean {
    return this.owners.empty;
  }
  peekHead(): AgentCue | undefined {
    return this.owners.peekHead()?.cue;
  }
  peekTail(): AgentCue | undefined {
    return this.owners.peekTail()?.cue;
  }
  toArray(): AgentCue[] {
    return [...this];
  }
  *[Symbol.iterator](): Iterator<AgentCue> {
    for (const owner of this.owners) yield owner.cue;
  }
  checkSpace(count = 1, onAdmissionRefusal?: (error: ResourceAdmissionError | DeckFullError) => void): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid cue admission count");
    if (count > this.capacity) throw new ResourceLimitError("Cue batch exceeds item capacity");
    if (count > this.capacity - this.held) {
      const refusal = new DeckFullError("Cue item capacity is occupied");
      onAdmissionRefusal?.(refusal);
      throw refusal;
    }
  }
  /** Reserve the actual batch before durable writes; finally release unused preparation. */
  prepare(
    cues: readonly AgentCue[],
    onAdmissionRefusal?: (error: ResourceAdmissionError | DeckFullError) => void,
  ): PreparedCueBatch {
    this.checkSpace(cues.length, onAdmissionRefusal);
    if (!cues.length) throw new RangeError("Empty cue preparation");
    const credit = reserveCueBytes(this.resources, cues, this.maxNodes, onAdmissionRefusal);
    let values: AgentCue[];
    try {
      values = [...cues];
    } catch (error) {
      credit.release();
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
        if (--references === 0) credit!.release();
      }, () => {
        this.checkSpace();
        const duplicate = this.resources.reserve({ bytes: 128 });
        if (duplicate.kind === "refuse") {
          throw new ResourceAdmissionError("Cue fanout admission refused", duplicate.reason);
        }
        try {
          const copy = makeOwner(cue, duplicate.reservation);
          this.held++;
          references++;
          return copy;
        } catch (error) {
          duplicate.reservation.release();
          throw error;
        }
      }, credit.bytes + (extra ? 128 : 0));
      ownerDecks.set(owner, this);
      return owner;
    };
    const release = () => {
      if (state !== "prepared") return;
      state = "released";
      this.held -= count;
      values.length = 0;
      credit!.release();
    };
    return {
      release,
      publish: () => {
        if (state !== "prepared") throw new Error("Cue preparation is no longer publishable");
        try {
          this.owners.extend(values.map((cue) => makeOwner(cue)));
          state = "published";
          values.length = 0;
        } catch (error) {
          release();
          throw error;
        }
      },
    };
  }
  append(cue: AgentCue): number {
    this.prepare([cue]).publish();
    return this.length;
  }
  extend(cues: Iterable<AgentCue>): number {
    const values: AgentCue[] = [];
    for (const cue of cues) {
      this.checkSpace(values.length + 1);
      values.push(cue);
    }
    if (values.length) this.prepare(values).publish();
    return this.length;
  }
  push(cue: AgentCue): number {
    return this.append(cue);
  }
  /** Transfer one queued owner; it still occupies item/byte credit until released. */
  takeOwned(): OwnedCue | undefined {
    return this.owners.pull();
  }
  /** Return failed/untransferred work to the head without releasing/reacquiring its credit. */
  requeue(owner: OwnedCue): void {
    if (ownerDecks.get(owner) !== this) throw new Error("Cue belongs to another admission deck");
    owner.transfer((next) => {
      this.owners.prepend(next);
    });
  }
  /** Discard queued work only; active transferred owners retain their credit. */
  clear(): void {
    for (const owner of this.owners) owner.release();
    this.owners.clear();
  }
}
