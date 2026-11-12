/**
 * Runtime-owned operations for single-signature v2 IPEX presentation.
 *
 * `present` is the user's one explicit consent: it selects the credential view,
 * signs the Offer, Grant, Apply, Agree or Spurn (a Grant may also anchor its
 * presentation proof under that same consent), takes the signed exchange into
 * local authenticated intake and records the operation. It returns after local
 * commit and never waits for the peer. `PresentationOperations.processOnce` is
 * the only worker: it delivers the already signed bytes, retries a failed
 * delivery on a fixed interval and ends the operation at the Grant's original
 * exchange deadline. It never signs. Nothing is retained that could sign later:
 * the signed bytes are the only memory, so a record that is active with no live
 * operation reads `interrupted` (or `expired` past the deadline) and nothing is
 * sent after a restart.
 *
 * Workflow-contract shape (`app/runtime/workflow-contract.ts`): `present`
 * returns after local commit, `presentationStatus` is a pure read of the record,
 * the live table and the stored exchanges, `waitForPresentation` only observes
 * and returns a `WaitResult`, and `abandonPresentation` is local. A host that
 * wants only the signed bytes (a file, a QR code) uses `preparePresentation`,
 * which commits locally and records nothing else.
 *
 * Group identifiers are refused: group presentation needs member coordination
 * and belongs to the group proposal API (a later change).
 */
import { concatBytes, type SerderKERI } from "cesr-ts";
import { action, type Operation, race } from "npm:effection@^3.6.0";
import { type DerivedUpdateStore, RegistryCustody } from "../../acdc/custody.ts";
import type { Regery } from "../../acdc/registraring.ts";
import { ValidationError } from "../../core/errors.ts";
import { timestampMicros } from "../../time/mod.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import type { IpexV2BodyOptions } from "./ipex-building.ts";
import {
  type CredentialViews,
  type DisclosureSelection,
  IpexDiscloser,
  type PreparedDisclosure,
} from "./ipex-discloser.ts";
import type { IssuanceDelivery } from "./issuance.ts";

/** Milliseconds between delivery attempts of a presentation whose transport failed. */
export const PRESENTATION_RETRY_MS = 1000;
/** Delivery attempts before a presentation reads `failed`. */
export const PRESENTATION_MAX_ATTEMPTS = 10;

/** The signed IPEX message a presentation operation sends. */
export type PresentationVerb = "apply" | "offer" | "agree" | "spurn" | "grant";

/** Terminal states that are not delivery; each carries a reason. */
export type PresentationEndState = "abandoned" | "interrupted" | "expired" | "failed";

/** Durable, non-secret operation facts. Never holds keys, authorisation codes or message bytes. */
export interface PresentationRecord {
  /** SAID of the signed exchange. */
  readonly said: string;
  readonly verb: PresentationVerb;
  /** Prefix of the local sender. */
  readonly hab: string;
  readonly recipient: string;
  /** The exchange's original deadline (ISO 8601), for an exchange that has one. */
  readonly deadline?: string;
  /** When the user gave the consent (ISO 8601). */
  readonly presented: string;
  /** When the transport reported delivery, and where it reached. */
  readonly delivered?: { readonly at: string; readonly deliveries: readonly string[] };
  readonly ended?: { readonly state: PresentationEndState; readonly reason: string; readonly at: string };
}

/** The embedder's durable table of {@link PresentationRecord}s, keyed by exchange SAID. */
export interface PresentationOperationStore {
  get(said: string): PresentationRecord | null;
  /** Insert or replace the record for `record.said`. */
  put(record: PresentationRecord): void;
  list(): PresentationRecord[];
}

/** Process-local store for the CLI and tests; a wallet backs the port with its own table. */
export class MemoryPresentationOperationStore implements PresentationOperationStore {
  private readonly records = new Map<string, PresentationRecord>();
  get(said: string): PresentationRecord | null {
    return this.records.get(said) ?? null;
  }
  put(record: PresentationRecord): void {
    this.records.set(record.said, structuredClone(record));
  }
  list(): PresentationRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}

/** The peer's stored answer to a delivered exchange, read from the retained response index. */
export interface PresentationResponse {
  said: string;
  route: string | null;
}

/** Status of one presentation, discriminated on `state`. A pure read. */
export type PresentationStatus =
  | {
    state: "active";
    verb: PresentationVerb;
    phase: "delivering";
    deadline?: string;
    attempts: number;
    /** The last transport failure, while attempts remain. */
    blocked?: string;
  }
  | {
    state: "done";
    verb: PresentationVerb;
    phase: "delivered";
    deliveries: readonly string[];
    response?: PresentationResponse;
  }
  | { state: PresentationEndState; verb: PresentationVerb; reason: string };

/** Narrow collaborators of the presentation owner. Hosts adapt their runtime to this once. */
export interface PresentationDeps {
  readonly hby: Habery;
  /** Registry environment: its public store and the local presentation registries by name. */
  readonly rgy: Pick<Regery, "store" | "registryByName">;
  readonly exc: Exchanger;
  /** Receipt collector for an anchored exchange; its genus selects the witness protocol version. */
  readonly receiptor: Receiptor;
  /** Local intake of what this identifier signs. */
  readonly reactor: Pick<Reactor, "processBytes">;
  readonly protocol: Pick<ProtocolProcessor, "processEscrowsOnce">;
  readonly delivery: IssuanceDelivery;
  readonly store: PresentationOperationStore;
  /** Same clock the exchanger was composed with. */
  readonly clock: RuntimeClock;
  /** Embedder inventory for selecting an issued credential or a retained Grant. */
  readonly views?: CredentialViews;
  /** Derivation coordinates, needed only for a selection with `derive`. */
  readonly derived?: DerivedUpdateStore;
  readonly changes?: ChangeSink;
}

/** Body options of a selecting message, plus the presentation registry that carries a Grant's proof. */
export type PresentationOptions = IpexV2BodyOptions & {
  priorSaid?: string;
  auths?: WitnessAuthMap;
  /** Alias of a local registry whose presented-state update this Grant anchors. */
  presentationRegistry?: string;
};

/** What the user presents. Selecting verbs name a credential view; replies name the exchange they answer. */
export type PresentationInput =
  | { verb: "offer"; hab: Hab; selection: DisclosureSelection; options: PresentationOptions }
  | { verb: "grant"; hab: Hab; selection: DisclosureSelection; options: PresentationOptions }
  | { verb: "apply"; hab: Hab; options: IpexV2BodyOptions }
  | {
    verb: "agree" | "spurn";
    hab: Hab;
    /** SAID of the accepted, authenticated exchange being answered. */
    prior: string;
    message?: string;
    recipient?: string;
    auths?: WitnessAuthMap;
  };

/** A signed exchange accepted locally, with the bytes in delivery order. */
export interface PreparedPresentation {
  exn: SerderKERI;
  /** Sender KEL, proof support and the exchange. */
  wire: Uint8Array;
  recipient: string;
}

/** What `present` selected. */
export interface PresentationBegun {
  said: string;
  recipient: string;
  /** The signed bytes, for a host that also wants to file them. */
  wire: Uint8Array;
}

/** Options of one `present`. */
export interface PresentOptions {
  /** Delivery attempts before the operation reads `failed`. */
  maxAttempts?: number;
}

/** One operation the user began; exists only while its delivery is live in memory. */
interface LivePresentation {
  record: PresentationRecord;
  readonly hab: Hab;
  readonly wire: Uint8Array;
  readonly expires: bigint | null;
  readonly maxAttempts: number;
  attempts: number;
  nextTry: number;
  blocked?: string;
  /** A delivery is running; overlapping `processOnce` calls skip it. */
  busy: boolean;
}

const EXPIRED = "The presentation reached its original exchange deadline";
const PENDING = "ACDC v2 exchange remains pending authenticated intake.";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wait on the host's clock so cancellation releases the timer. */
function* wait(clock: RuntimeClock, milliseconds: number): Operation<void> {
  yield* action<void>((resolve) => {
    const timer = clock.setTimeout(resolve, milliseconds);
    return () => clock.clearTimeout(timer);
  });
}

/** Whether the exchange's deadline has passed; a record without one never lapses. */
function lapsed(deps: Pick<PresentationDeps, "clock">, { deadline }: PresentationRecord): boolean {
  const expiry = timestampMicros(deadline);
  return expiry !== null && BigInt(deps.clock.now()) * 1000n >= expiry;
}

/** The operations table and its delivery driver. One per host runtime; every identifier may present through it. */
export class PresentationOperations {
  /** Operations whose delivery is live in this process. Internal to this module's functions. */
  readonly live = new Map<string, LivePresentation>();
  private swept = false;

  constructor(readonly deps: PresentationDeps) {}

  /**
   * Advance every live delivery by one pass. The first pass also settles records left active by an earlier
   * process as `interrupted`; that signs and sends nothing.
   */
  *processOnce(): Operation<void> {
    const { deps } = this;
    if (!this.swept) {
      this.swept = true;
      for (const record of deps.store.list()) {
        if (!record.ended && !record.delivered && !this.live.has(record.said)) this.orphan(record);
      }
    }
    for (const op of [...this.live.values()]) {
      if (op.busy || !this.live.has(op.record.said) || deps.clock.now() < op.nextTry) continue;
      op.busy = true;
      try {
        const left = op.expires === null ? null : op.expires - BigInt(deps.clock.now()) * 1000n;
        if (left !== null && left <= 0n) this.end(op, "expired", EXPIRED);
        else if ((yield* race([this.deliver(op), this.timer(left)])) === "expired") this.end(op, "expired", EXPIRED);
      } finally {
        op.busy = false;
      }
    }
  }

  /** End a live operation: drop it, record why, tell the sink. */
  end(op: LivePresentation, state: PresentationEndState, reason: string): void {
    this.live.delete(op.record.said);
    this.deps.store.put({ ...op.record, ended: { state, reason, at: iso(this.deps.clock.now()) } });
    this.deps.changes?.push({ kind: "presentation", id: op.record.said });
  }

  private orphan(record: PresentationRecord): void {
    const [state, reason] = orphaned(lapsed(this.deps, record));
    this.deps.store.put({ ...record, ended: { state, reason, at: iso(this.deps.clock.now()) } });
    this.deps.changes?.push({ kind: "presentation", id: record.said });
  }

  /** Resolves only when the deadline passes; never resolves for an exchange without one. */
  private *timer(left: bigint | null): Operation<"expired" | "waiting"> {
    if (left === null) return yield* action<never>(() => () => {});
    yield* wait(this.deps.clock, Number(left) / 1000);
    return "expired";
  }

  /** One attempt: a failure is retried after {@link PRESENTATION_RETRY_MS} until the attempts run out. */
  private *deliver(op: LivePresentation): Operation<"delivered" | "retry" | "failed"> {
    const { deps } = this;
    op.attempts++;
    try {
      const deliveries = yield* deps.delivery.deliver({ src: op.hab.pre!, dest: op.record.recipient, msg: op.wire });
      this.live.delete(op.record.said);
      deps.store.put({ ...op.record, delivered: { at: iso(deps.clock.now()), deliveries } });
      deps.changes?.push({ kind: "presentation", id: op.record.said });
      return "delivered";
    } catch (error) {
      op.blocked = message(error);
      if (op.attempts >= op.maxAttempts) {
        this.end(op, "failed", op.blocked);
        return "failed";
      }
      op.nextTry = deps.clock.now() + PRESENTATION_RETRY_MS;
      deps.changes?.push({ kind: "presentation", id: op.record.said });
      return "retry";
    }
  }
}

function orphaned(lapsed: boolean): ["expired" | "interrupted", string] {
  return lapsed
    ? ["expired", EXPIRED]
    : ["interrupted", "The process that began this presentation ended before delivery; present again"];
}

/** The discloser for one sender; derivation needs custody over the sender's own Keeper root. */
function discloserFor(deps: PresentationDeps, hab: Hab, derive?: boolean): IpexDiscloser {
  let custody: RegistryCustody | undefined;
  if (derive) {
    if (!deps.derived) throw new ValidationError("Derived disclosure requires the embedder's derivation store.");
    custody = new RegistryCustody({ hby: deps.hby, hab, registry: deps.rgy.store, store: deps.derived });
  }
  return new IpexDiscloser(deps.hby, deps.rgy.store, deps.exc, deps.receiptor, custody, deps.views);
}

/**
 * Sign the selected message and take it into local authenticated intake, without recording an operation or
 * delivering. This is the whole consent: the returned bytes are final.
 *
 * @throws ValidationError for a group identifier, an unknown presentation registry, a selection the discloser
 * refuses, or an exchange that does not reach authenticated intake.
 */
export function* preparePresentation(
  deps: PresentationDeps,
  input: PresentationInput,
): Operation<PreparedPresentation> {
  const { hab } = input;
  let presentation;
  if (input.verb === "grant" && input.options.presentationRegistry) {
    presentation = deps.rgy.registryByName(input.options.presentationRegistry);
    if (!presentation) throw new ValidationError("Unknown presentation registry.");
  }
  const discloser = discloserFor(deps, hab, "selection" in input ? input.selection.derive : undefined);
  const sender = hab.pre!;
  let prepared: PreparedDisclosure;
  switch (input.verb) {
    case "apply":
      prepared = yield* discloser.prepareApply(sender, input.options);
      break;
    case "agree":
    case "spurn":
      prepared = yield* discloser.prepareReply(
        sender,
        input.verb,
        input.prior,
        input.message ?? "",
        input.recipient,
        input.auths,
      );
      break;
    case "offer":
      prepared = yield* discloser.prepareOffer(sender, input.selection, input.options);
      break;
    case "grant":
      prepared = yield* discloser.prepareGrant(sender, input.selection, {
        ...input.options,
        presentation: presentation ?? undefined,
      });
      break;
  }
  const wire = concatBytes(discloser.kel(hab), prepared.support, prepared.wire);
  yield* deps.reactor.processBytes(wire, { local: true });
  yield* deps.protocol.processEscrowsOnce();
  if (!deps.exc.complete(prepared.exn.said!)) throw new ValidationError(PENDING);
  return { exn: prepared.exn, wire, recipient: prepared.exn.sad!.ri as string };
}

/**
 * The user's consent to present: signs and takes the message into local intake ({@link preparePresentation}),
 * records the operation and queues the signed bytes for `processOnce` to deliver. Returns after local commit.
 */
export function* present(
  ops: PresentationOperations,
  input: PresentationInput,
  { maxAttempts = PRESENTATION_MAX_ATTEMPTS }: PresentOptions = {},
): Operation<PresentationBegun> {
  const { deps } = ops;
  const { exn, wire, recipient } = yield* preparePresentation(deps, input);
  const said = exn.said!, deadline = deps.exc.exchangeDeadline(exn) ?? undefined;
  const record: PresentationRecord = {
    said,
    verb: input.verb,
    hab: input.hab.pre!,
    recipient,
    deadline,
    presented: iso(deps.clock.now()),
  };
  deps.store.put(record);
  ops.live.set(said, {
    record,
    hab: input.hab,
    wire,
    expires: timestampMicros(deadline),
    maxAttempts,
    attempts: 0,
    nextTry: 0,
    busy: false,
  });
  deps.changes?.push({ kind: "presentation", id: said });
  return { said, recipient, wire };
}

/**
 * Pure read of one presentation: its record, the live table and the stored exchanges (the peer's answer, when
 * one was stored). A record left active by a process that is gone reads `interrupted`, or `expired` past the
 * deadline; that is a statement, not a write.
 *
 * @throws ValidationError when no presentation was begun for `said`.
 */
export function presentationStatus(
  ops: Pick<PresentationOperations, "deps" | "live">,
  said: string,
): PresentationStatus {
  const { deps } = ops, record = deps.store.get(said);
  if (!record) throw new ValidationError("No presentation was begun for this exchange");
  const { verb } = record;
  if (record.ended) return { state: record.ended.state, verb, reason: record.ended.reason };
  if (record.delivered) {
    const answer = deps.hby.db.erpy.get([said])?.qb64;
    const response = answer ? { said: answer, route: deps.hby.db.exns.get([answer])?.route ?? null } : undefined;
    return { state: "done", verb, phase: "delivered", deliveries: record.delivered.deliveries, response };
  }
  const live = ops.live.get(said), over = lapsed(deps, record);
  if (live && !over) {
    return {
      state: "active",
      verb,
      phase: "delivering",
      deadline: record.deadline,
      attempts: live.attempts,
      blocked: live.blocked,
    };
  }
  const [state, reason] = orphaned(over);
  return { state, verb, reason };
}

/** Options for {@link waitForPresentation}. */
export interface PresentationWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  clock?: Pick<RuntimeClock, "now">;
  /** Settle on this instead of any non-active state. */
  until?: (status: PresentationStatus) => boolean;
}

/**
 * Observe until the presentation is delivered or ended, or the budget expires. Starts no worker and drives
 * nothing: someone else must call `processOnce`.
 */
export function* waitForPresentation(
  ops: Pick<PresentationOperations, "deps" | "live">,
  said: string,
  { timeoutMs, clock = ops.deps.clock, until = (status) => status.state !== "active" }: PresentationWaitOptions,
): Operation<WaitResult<PresentationStatus>> {
  const settled = yield* observeUntil(() => until(presentationStatus(ops, said)), { timeoutMs, clock });
  const status = presentationStatus(ops, said);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/**
 * Local abandon: stop delivering and record `abandoned`. Does not message the peer and does not retract an
 * exchange already delivered. Does nothing to a presentation that is already delivered or ended.
 *
 * @throws ValidationError when no presentation was begun for `said`.
 */
export function abandonPresentation(
  ops: PresentationOperations,
  said: string,
  reason = "Abandoned by the user",
): void {
  const record = ops.deps.store.get(said);
  if (!record) throw new ValidationError("No presentation was begun for this exchange");
  if (record.ended || record.delivered) return;
  const live = ops.live.get(said);
  if (live) ops.end(live, "abandoned", reason);
  else {
    ops.deps.store.put({ ...record, ended: { state: "abandoned", reason, at: iso(ops.deps.clock.now()) } });
    ops.deps.changes?.push({ kind: "presentation", id: said });
  }
}
