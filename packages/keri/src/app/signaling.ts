import { type Operation } from "npm:effection@^3.6.0";
import { MtrDex, Salter } from "../../../cesr/mod.ts";
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

  constructor(
    init:
      | { raw: Uint8Array; ckey?: string }
      | { pad: Omit<Partial<SignalPad<T>>, "a" | "r"> & { a: T; r: string }; ckey?: string },
  ) {
    if ("raw" in init) {
      this.#ckey = init.ckey;
      this.raw = init.raw;
      return;
    }
    this.#ckey = init.ckey;
    this.pad = init.pad;
  }

  get raw(): Uint8Array {
    return new Uint8Array(this.#raw);
  }

  set raw(raw: Uint8Array) {
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

/**
 * In-memory transient signal queue with KERIpy-style collapse-key replacement.
 */
export class Signaler {
  static readonly SignalTimeoutMs = 10 * 60 * 1000;

  readonly signals: Signal[];
  readonly signalTimeoutMs: number;

  constructor(
    {
      signals,
      signalTimeoutMs,
    }: {
      signals?: Signal[];
      signalTimeoutMs?: number;
    } = {},
  ) {
    this.signals = signals ?? [];
    this.signalTimeoutMs = signalTimeoutMs ?? Signaler.SignalTimeoutMs;
  }

  push<T extends SignalAttrs = SignalAttrs>(
    attrs: T,
    topic: string,
    options: {
      ckey?: string;
      dt?: string | Date;
    } = {},
  ): Signal<T> {
    const created = signal(attrs, topic, options);
    if (created.ckey) {
      const index = this.signals.findIndex((existing) => existing.ckey === created.ckey);
      if (index >= 0) {
        this.signals.splice(index, 1, created);
        return created;
      }
    }

    this.signals.push(created);
    return created;
  }

  list(): Signal[] {
    return this.signals.map((current) => new Signal({ raw: current.raw, ckey: current.ckey }));
  }

  count(): number {
    return this.signals.length;
  }

  processOnce(now = Date.now()): number {
    const before = this.signals.length;
    for (let index = this.signals.length - 1; index >= 0; index -= 1) {
      const current = this.signals[index]!;
      const currentTime = new Date(current.datetime).getTime();
      if (Number.isNaN(currentTime)) {
        this.signals.splice(index, 1);
        continue;
      }
      if ((now - currentTime) > this.signalTimeoutMs) {
        this.signals.splice(index, 1);
      }
    }
    return before - this.signals.length;
  }

  *signalDo(): Operation<never> {
    while (true) {
      this.processOnce();
      yield* runtimeTurn();
    }
  }
}
