import {
  MtrDex,
  ResourceAdmissionError,
  ResourceLimitError,
  ResourcePolicy,
  type ResourceReservation,
  Salter,
} from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { runtimeTurn } from "./runtime-turn.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type SignalAttrs = Record<string, unknown>;

export interface SignalPad<T extends SignalAttrs = SignalAttrs> {
  i: string;
  dt: string;
  r: string;
  a: T;
}

function randomNonce(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return new Salter({ code: MtrDex.Salt_128, raw }).qb64;
}

function encodePad<T extends object>(pad: T): Uint8Array {
  return textEncoder.encode(JSON.stringify(pad));
}

function decodePad<T extends object>(raw: Uint8Array): T {
  return JSON.parse(textDecoder.decode(raw)) as T;
}

/**
 * Transient host signal matching the KERIpy `Signal` pad shape.
 *
 * Unlike `Notice`, this is not durably stored. Hosts use it as a reload hint.
 */
export class Signal<T extends SignalAttrs = SignalAttrs> {
  #raw!: Uint8Array;
  #pad!: SignalPad<T>;
  #ckey?: string;
  #immutable = false;

  constructor(
    init:
      | { raw: Uint8Array; ckey?: string }
      | {
        pad: Omit<Partial<SignalPad<T>>, "a" | "r"> & { a: T; r: string };
        ckey?: string;
      },
  ) {
    if ("raw" in init) {
      this.#ckey = init.ckey;
      this.raw = init.raw;
      return;
    }
    this.#ckey = init.ckey;
    this.pad = init.pad;
  }

  /** Inspect backing before copying a finite seed signal. */
  get rawByteLength(): number {
    return this.#raw.byteLength;
  }

  get raw(): Uint8Array {
    return new Uint8Array(this.#raw);
  }

  set raw(raw: Uint8Array) {
    if (this.#immutable) throw new Error("Queued signals are immutable");
    this.pad = decodePad<SignalPad<T>>(raw);
  }

  get pad(): SignalPad<T> {
    return {
      ...this.#pad,
      a: { ...this.#pad.a },
    };
  }

  set pad(
    pad: Omit<Partial<SignalPad<T>>, "a" | "r"> & { a: T; r: string },
  ) {
    if (this.#immutable) throw new Error("Queued signals are immutable");
    const normalized: SignalPad<T> = {
      i: typeof pad.i === "string" && pad.i.length > 0 ? pad.i : randomNonce(),
      dt: typeof pad.dt === "string" && pad.dt.length > 0
        ? pad.dt
        : new Date().toISOString(),
      r: pad.r,
      a: { ...pad.a },
    };
    this.#pad = normalized;
    this.#raw = encodePad(normalized);
  }

  get rid(): string {
    return this.#pad.i;
  }

  get datetime(): string {
    return this.#pad.dt;
  }

  get topic(): string {
    return this.#pad.r;
  }

  get attrs(): T {
    return { ...this.#pad.a };
  }

  get ckey(): string | undefined {
    return this.#ckey;
  }

  asDict(): SignalPad<T> {
    return this.pad;
  }

  /** Snapshot and freeze a method-managed ping; caller input and queued state never share mutable children. */
  freeze(): this {
    this.#pad = decodePad<SignalPad<T>>(this.#raw);
    const freeze = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    };
    freeze(this.#pad);
    this.#immutable = true;
    return this;
  }
}

export function signal<T extends SignalAttrs = SignalAttrs>(
  attrs: T,
  topic: string,
  options: {
    ckey?: string;
    dt?: string | Date;
  } = {},
): Signal<T> {
  const dt = typeof options.dt === "string"
    ? options.dt
    : options.dt?.toISOString();
  return new Signal({
    pad: {
      i: "",
      dt,
      r: topic,
      a: attrs,
    },
    ckey: options.ckey,
  });
}

/** One finite ping prepared before durable notice effects; publication transfers its credit to the queue. */
export interface PreparedSignal<T extends SignalAttrs = SignalAttrs> {
  readonly signal: Signal<T>;
  publish(): void;
  release(): void;
}

const signalNodes = 4096;

/** Bound this signal's plain JSON before stringify; no accessors, custom serializers or retained input aliases. */
function checkSignalJson(value: unknown, maxBytes: number): void {
  let bytes = 256, nodes = 0;
  const ancestors = new Set<object>();
  const visit = (current: unknown, depth: number): void => {
    if (++nodes > signalNodes || depth > 64) throw new ResourceLimitError("Signal JSON inspection exceeds policy");
    if (typeof current === "string") bytes += 6 * current.length + 2;
    else if (current === null || current === undefined || typeof current === "number" || typeof current === "boolean") {
      bytes += 32;
    } else if (typeof current === "object") {
      if (ancestors.has(current)) throw new TypeError("Circular signal JSON");
      const array = Array.isArray(current);
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
        throw new RangeError("Signal attributes require plain JSON values");
      }
      ancestors.add(current);
      try {
        if (array) {
          if (current.length > signalNodes - nodes) {
            throw new ResourceLimitError("Signal JSON inspection exceeds policy");
          }
          for (let index = 0; index < current.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(current, index);
            if (descriptor && !Object.hasOwn(descriptor, "value")) {
              throw new RangeError("Signal accessors are unsupported");
            }
            bytes += 2;
            visit(descriptor?.value ?? null, depth + 1);
          }
        } else {
          for (const key in current) {
            if (!Object.hasOwn(current, key)) continue;
            const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
            if (!Object.hasOwn(descriptor, "value")) throw new RangeError("Signal accessors are unsupported");
            bytes += 6 * key.length + 5;
            visit(descriptor.value, depth + 1);
          }
        }
      } finally {
        ancestors.delete(current);
      }
    } else throw new RangeError("Signal attributes require plain JSON values");
    if (bytes > maxBytes) throw new ResourceLimitError("Signal exceeds conservative JSON byte ceiling");
  };
  visit(value, 0);
}

/** Existing transient signal queue; immutable method-managed entries retain shared credit until retirement. */
export class Signaler {
  static readonly SignalTimeoutMs = 10 * 60 * 1000;
  readonly signalTimeoutMs: number;
  readonly maxSignals: number;
  readonly maxSignalBytes: number;
  readonly resources: ResourcePolicy;
  private readonly queued: Signal[] = [];
  private readonly reservations = new Map<Signal, ResourceReservation>();
  private pending?: { release(): void };
  private closed = false;

  constructor(
    {
      signals = [],
      signalTimeoutMs = Signaler.SignalTimeoutMs,
      resources = new ResourcePolicy(),
      maxSignals = 1024,
      maxSignalBytes = 64 * 1024,
    }: {
      signals?: readonly Signal[];
      signalTimeoutMs?: number;
      resources?: ResourcePolicy;
      maxSignals?: number;
      maxSignalBytes?: number;
    } = {},
  ) {
    if (
      !Number.isSafeInteger(maxSignals) || maxSignals < 0 || !Number.isSafeInteger(maxSignalBytes) || maxSignalBytes < 1
      || !Number.isFinite(signalTimeoutMs) || signalTimeoutMs < 0
    ) throw new RangeError("Invalid signal limits");
    this.resources = resources;
    this.maxSignals = maxSignals;
    this.maxSignalBytes = maxSignalBytes;
    this.signalTimeoutMs = signalTimeoutMs;
    try {
      for (const seed of signals) {
        const prepared = this.prepareValue(() => {
          if (seed.rawByteLength > this.maxSignalBytes) {
            throw new ResourceLimitError("Seed signal exceeds byte ceiling");
          }
          checkSignalJson(seed.pad, this.maxSignalBytes);
          return new Signal({ raw: seed.raw, ckey: seed.ckey });
        });
        try {
          prepared.publish();
        } finally {
          prepared.release();
        }
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** Borrowed readonly queue view; arbitrary external mutation or retention is outside managed admission. */
  get signals(): readonly Signal[] {
    return this.queued;
  }

  /** Admit slot/inspection/copy credit before invoking a finite producer or constructing its ping. */
  prepare<T extends SignalAttrs>(
    attrs: T | (() => T),
    topic: string,
    options: { ckey?: string; dt?: string | Date } = {},
  ): PreparedSignal<T> {
    return this.prepareValue(() => {
      const value = typeof attrs === "function" ? attrs() : attrs;
      const dt = typeof options.dt === "string" ? options.dt : options.dt?.toISOString();
      checkSignalJson({ a: value, r: topic, dt: dt ?? "", ckey: options.ckey ?? "" }, this.maxSignalBytes);
      return signal(value, topic, { ...options, dt });
    }, options.ckey);
  }

  private prepareValue<T extends SignalAttrs>(create: () => Signal<T>, ckey?: string): PreparedSignal<T> {
    if (this.closed) throw new Error("Signaler is closed");
    if (this.pending) throw new ResourceAdmissionError("Signal preparation is occupied", "busy");
    if (this.maxSignals === 0) throw new ResourceLimitError("Signal item capacity is zero");
    const replacing = ckey !== undefined ? this.queued.find((current) => current.ckey === ckey) : undefined;
    if (!replacing && this.queued.length >= this.maxSignals) {
      throw new ResourceAdmissionError("Signal item capacity is occupied", "busy");
    }
    // Whole finite constructor allowance: JSON text/raw/snapshot copies and bounded inspection metadata.
    const credit = this.resources.reserve({ bytes: 8 * this.maxSignalBytes + 128 * signalNodes + 16384 });
    if (credit.kind === "refuse") {
      throw new ResourceAdmissionError(`Signal byte admission refused: ${credit.reason}`, credit.reason);
    }
    let state: "prepared" | "published" | "released" = "prepared";
    const release = () => {
      if (state !== "prepared") return;
      state = "released";
      this.pending = undefined;
      credit.reservation.release();
    };
    this.pending = { release };
    try {
      const created = create().freeze();
      if (state !== "prepared" || this.closed) throw new Error("Signal preparation was closed");
      return {
        signal: created,
        release,
        publish: () => {
          if (state !== "prepared" || this.closed) throw new Error("Signal preparation is no longer publishable");
          const index = replacing ? this.queued.indexOf(replacing) : -1;
          if (index >= 0) this.queued.splice(index, 1, created);
          else this.queued.push(created);
          this.reservations.set(created, credit.reservation);
          state = "published";
          this.pending = undefined;
          if (index >= 0) this.retire(replacing!);
        },
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  /** Prepare and immediately publish one transient wakeup. */
  push<T extends SignalAttrs>(attrs: T, topic: string, options: { ckey?: string; dt?: string | Date } = {}): Signal<T> {
    const prepared = this.prepare(attrs, topic, options);
    try {
      prepared.publish();
      return prepared.signal;
    } finally {
      prepared.release();
    }
  }

  list(): Signal[] {
    return this.queued.map((current) => new Signal({ raw: current.raw, ckey: current.ckey }));
  }
  count(): number {
    return this.queued.length;
  }

  private retire(current: Signal): void {
    this.reservations.get(current)?.release();
    this.reservations.delete(current);
  }

  processOnce(now = Date.now()): number {
    const before = this.queued.length;
    for (let index = this.queued.length - 1; index >= 0; index--) {
      const current = this.queued[index]!;
      const time = new Date(current.datetime).getTime();
      if (Number.isNaN(time) || now - time > this.signalTimeoutMs) {
        this.queued.splice(index, 1);
        this.retire(current);
      }
    }
    return before - this.queued.length;
  }

  /** Drop only transient wakeups, releasing their credit exactly once. */
  clear(): void {
    for (const current of this.queued) this.retire(current);
    this.queued.length = 0;
  }
  /** Close this owned producer and release queued and unpublished preparation. */
  close(): void {
    this.closed = true;
    this.pending?.release();
    this.clear();
  }

  *signalDo(): Operation<never> {
    while (true) {
      this.processOnce();
      yield* runtimeTurn();
    }
  }
}
