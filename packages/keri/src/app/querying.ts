/** KERIpy-shaped query workflows; accepted protocol state determines completion. */
import type { SealEvent } from "cesr-ts";
import { call, type Operation, race, spawn, type Stream, type Task } from "effection";
import type { KeyStateSavedCue } from "../core/cues.ts";
import type { Baser } from "../db/basing.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import type { WitnessInquisitor } from "./witness-inquisitor.ts";

/** Local signer and optional remote attesters; neither selects a transport implementation. */
interface QueryOptions {
  signer?: string;
  wits?: string[];
}

/** Snapshot the caller's attester list before the workflow starts. */
function copyOptions(options: QueryOptions): QueryOptions {
  return { signer: options.signer, wits: options.wits ? [...options.wits] : undefined };
}

/** Preserve the existing nonnegative hex query ordinal convention. */
function hexOrdinal(value: number): string {
  return Math.max(0, value).toString(16);
}

/** Wait for an accepted KEL sequence, never for transport or queue completion. */
function* awaitSequence(db: Baser, pre: string, sn: number): Operation<void> {
  while (true) {
    const local = db.getKever(pre);
    if (local && local.sn >= sn) return;
    yield* runtimeTurn();
  }
}

/** Query key state, then compose log recovery when the saved notice is ahead of local state. */
export class KeyStateNoticer {
  private readonly options: QueryOptions;

  /** Borrow accepted state, a running sender and the composition's live key-state notice flow. */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    private readonly updates: Stream<KeyStateSavedCue, void>,
    options: QueryOptions = {},
  ) {
    this.options = copyOptions(options);
  }

  /** Own observation and follow-on work within this operation; returning means accepted catch-up. */
  queryDo(): Operation<void> {
    const { db, inquisitor, pre, updates, options } = this;
    return call(function*() {
      // Subscribe before publishing the request, including synchronous/local reply paths.
      const notices = yield* updates;
      inquisitor.enqueue({ pre, route: "ksn", q: { fn: "0", s: "0" }, ...options });
      let logs: Task<void> | undefined;
      let targetSn = 0;
      while (true) {
        const catchingUp = logs;
        let notice: IteratorResult<KeyStateSavedCue, void>;
        if (catchingUp) {
          const observed = yield* race([
            notices.next(),
            call(function*() {
              yield* catchingUp;
              return null;
            }),
          ]);
          if (observed === null) return;
          notice = observed;
        } else {
          notice = yield* notices.next();
        }
        if (notice.done) throw new Error("Key-state observation ended before accepted query completion");
        if (notice.value.ksn.i !== pre) continue;
        const local = db.getKever(pre);
        const ordinal = notice.value.ksn.s;
        if (!local || typeof ordinal !== "string" || !ordinal.length) continue;
        const remoteSn = parseInt(ordinal, 16);
        if (Number.isNaN(remoteSn)) continue;
        if (local.sn >= remoteSn) return;
        if (!logs || targetSn < remoteSn) {
          if (logs) yield* logs.halt();
          targetSn = remoteSn;
          logs = yield* spawn(() => new LogQuerier(db, inquisitor, pre, remoteSn, options).queryDo());
        }
      }
    });
  }
}

/** Request logs from the beginning and wait for the saved remote sequence to be accepted. */
export class LogQuerier {
  private readonly options: QueryOptions;

  /** Borrow accepted state and a running sender; construction starts no work. */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    readonly targetSn: number,
    options: QueryOptions = {},
  ) {
    this.options = copyOptions(options);
  }

  /** Send the initial request once and remain active until accepted state reaches the target. */
  *queryDo(): Operation<void> {
    this.inquisitor.enqueue({ pre: this.pre, route: "logs", q: { fn: "0", s: "0" }, ...this.options });
    yield* awaitSequence(this.db, this.pre, this.targetSn);
  }
}

/** Request a specific KEL sequence and first-seen start, as KERIpy's SeqNoQuerier does. */
export class SeqNoQuerier {
  private readonly options: QueryOptions;
  private readonly fn: number;

  /** Snapshot query selection; the caller composes the sender independently of this wait. */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    readonly targetSn: number,
    { fn = 0, ...options }: QueryOptions & { fn?: number } = {},
  ) {
    this.fn = fn;
    this.options = copyOptions(options);
  }

  /** Complete only from an accepted KEL at or beyond the requested sequence. */
  *queryDo(): Operation<void> {
    this.inquisitor.enqueue({
      pre: this.pre,
      route: "logs",
      q: { fn: hexOrdinal(this.fn), s: hexOrdinal(this.targetSn) },
      ...this.options,
    });
    yield* awaitSequence(this.db, this.pre, this.targetSn);
  }
}

/** Query an exact event seal and complete only when its sealing KEL event is accepted. */
export class AnchorQuerier {
  readonly anchor: ReturnType<typeof SealEvent.toSad>;
  private readonly options: QueryOptions;

  /** Snapshot the seal's protocol fields before the caller can mutate its input. */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    anchor: ReturnType<typeof SealEvent.toSad>,
    options: QueryOptions = {},
  ) {
    this.anchor = { i: anchor.i, s: anchor.s, d: anchor.d };
    this.options = copyOptions(options);
  }

  /** Ask the finite candidate set once, then observe accepted sealing evidence. */
  *queryDo(): Operation<void> {
    if (this.db.fetchLastSealingEventByEventSeal(this.pre, this.anchor)) return;
    // Deliberate difference from KERIpy's single random choice: a retired witness
    // may never learn the seal. Preserve the tested, finite current-candidate pass.
    const attesters = this.inquisitor.attestersFor(this.pre, this.options);
    for (const src of attesters.length ? attesters : [undefined]) {
      this.inquisitor.enqueue({
        pre: this.pre,
        route: "logs",
        q: { fn: "0", s: "0", a: { ...this.anchor } },
        src,
        ...this.options,
      });
    }
    while (!this.db.fetchLastSealingEventByEventSeal(this.pre, this.anchor)) yield* runtimeTurn();
  }
}
