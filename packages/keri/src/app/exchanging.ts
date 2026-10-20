import {
  type AttachmentGroup,
  b,
  type CesrFrame,
  Cigar,
  Dater,
  DeserializeError,
  Diger,
  essrChunks,
  essrRaw,
  essrWire,
  framePayload,
  NumberPrimitive,
  Prefixer,
  Saider,
  type SealEvent,
  type SealSource,
  Seqner,
  type SerderKERI,
  ShortageError,
  type Siger,
  type Texter,
  UnknownCodeError,
  type Versionage,
} from "cesr-ts";
import { call, type Operation, type Provide, resource } from "npm:effection@^3.6.0";
import { resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { PathedMaterialGroup, TransIdxSigGroup, type TransLastIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { type ExchangeFactors, type MissingExchangeState, verifyExchangeProofs } from "../core/exchange-proofing.ts";
import { Kever } from "../core/kever.ts";
import { consoleLogger } from "../core/logger.ts";
import { supportsNestedExchange } from "../core/protocol-exchanging.ts";
import { messageAttachmentGroups, serializeMessage } from "../core/protocol-serialization.ts";
import { hasNests, loadNests, publishNests, stageNests } from "../db/exchange-nests.ts";
import type { PayloadArchive, PreparedPayload } from "../db/payload-archive.ts";
import { encodeDateTimeToDater, makeNowIso8601, timestampMicros } from "../time/mod.ts";
import { abortable } from "./abortable.ts";
import type { Hab, Habery } from "./habbing.ts";

const textDecoder = new TextDecoder();
const EXCHANGE_ESCROW_TIMEOUT_MS = 10_000;

/** CESR syntax failures identify malformed evidence; I/O, limits, and hashing failures do not. */
function malformedEssr(error: unknown): boolean {
  return error instanceof DeserializeError || error instanceof ShortageError || error instanceof UnknownCodeError;
}
/** Private persisted receipt corruption is an invariant failure, never a remote refusal. */
function storedReceiverTime(
  record: { receiverTime?: string } | null,
): string | undefined {
  const time = record?.receiverTime;
  if (time !== undefined && timestampMicros(time) === null) throw new Error("Corrupt exchange receiver receipt");
  return time;
}

/** Pathed attachment projection exposed to exchange-route handlers. */
export interface ExchangeAttachment {
  raw: Uint8Array;
  text: string;
}

/** Typed proof/schema dependencies follow authentication; schema is a complete missing resource SAID. */
export type ExchangeRouteVerification = boolean | { kind: "escrow"; reason: string; schema?: string };

/** Historical coordinates are frozen before escrow; unresolved last groups cannot be persisted. */
interface ResolvedExchangeFactors {
  tsgs: TransIdxSigGroup[];
  cigars: Cigar[];
  sourceSeals: SealEvent[];
  missing: MissingExchangeState[];
}

/** Authenticated sender factors and the owning route's selected supplemental factors. */
interface AuthenticatedExchange {
  kind: "verified";
  retained: Required<ExchangeFactors>;
  supplemental: Required<ExchangeFactors>;
  sscs: SealSource[];
}
/** Route-handler contract for accepted exchange messages. */
export interface ExchangeRouteHandler {
  readonly resource: string;
  /** Optional protocol-major specialization; omitted handlers remain the route default. */
  readonly protocolMajor?: number;
  /** Opt in only after route-specific child validation and durable replay are implemented. */
  readonly acceptsNests?: boolean;
  /** Opt in to verified sender source coordinates required by the v2 IPEX workflow. */
  readonly acceptsSscs?: boolean;
  /** Permit selected supplemental factors in verify(), independently of the selection hook. */
  readonly acceptsEvidence?: boolean;
  /** Only routes with optional supplemental evidence may query and drop missing factors. */
  readonly acceptsMissingEvidence?: boolean;
  /** Select from independently verified non-sender factors; null permanently rejects the route. */
  verifyEvidence?(
    args: {
      serder: SerderKERI;
      factors: Required<ExchangeFactors>;
      invalid: boolean;
      /** Present only when acceptsMissingEvidence is enabled, including an empty list. */
      missing?: readonly MissingExchangeState[];
    },
  ): ExchangeFactors | null;
  /** Validate route policy before publishing accepted evidence. */
  verify?(args: {
    serder: SerderKERI;
    /** Selected supplemental proofs; each factor authenticates this body only. */
    evidence?: Required<ExchangeFactors>;
    /** Valid sender-implied source couples, only for opted-in routes. */
    sscs?: readonly SealSource[];
    attachments: ExchangeAttachment[];
    /** Ordered fragments retained independently of the input source. */
    essrs?: readonly Texter[];
    /** Borrowed children, with evidence kept on its original message. */
    nests?: readonly CesrFrame[];
    /** Hosted endpoint provenance, distinct from the signed sender. */
    mailboxAid?: string | null;
    /** Qualified first receiver receipt, retained through dependency retry. */
    receiverTime?: string;
  }): ExchangeRouteVerification;
  /** Consume already durable evidence within the caller's Effection scope. */
  handle(args: {
    serder: SerderKERI;
    /** Valid sender-implied source couples, only for opted-in routes. */
    sscs?: readonly SealSource[];
    attachments: ExchangeAttachment[];
    /** Ordered fragments retained independently of the input source. */
    essrs?: readonly Texter[];
    /** Borrowed children, with evidence kept on its original message. */
    nests?: readonly CesrFrame[];
    /** Hosted endpoint provenance, distinct from the signed sender. */
    mailboxAid?: string | null;
    /** Qualified first receiver receipt, retained through dependency retry. */
    receiverTime?: string;
  }): void | Operation<void>;
}
/** One signed exchange and its attachment views at runtime admission. */
export interface ExchangeInput {
  /** Resolved attachment genus retained independently of body protocol metadata. */
  gvrsn?: Versionage;
  /** Signed exchange body, including any ESSR byte commitment. */
  serder: SerderKERI;
  /** Transferable sender endorsements. */
  tsgs?: readonly TransIdxSigGroup[];
  /** Nontransferable sender endorsements. */
  cigars?: readonly Cigar[];
  /** Last-establishment references must freeze to historical coordinates before escrow. */
  lsgs?: readonly TransLastIdxSigGroup[];
  /** Foreign last references unresolved at their original receipt. */
  unresolvedLast?: readonly Prefixer[];
  /** Sender-implied source coordinates from parser normalization. */
  sscs?: readonly SealSource[];
  /** Explicit anchoring AID and historical source coordinates. */
  sourceSeals?: readonly SealEvent[];
  /** Ordinary pathed attachments. */
  ptds?: readonly PathedMaterialGroup[];
  /** Ordered qualified fragments; persistence owns any actual file staging. */
  essrs?: readonly Texter[];
  /** Parent-owned children; admission borrows and snapshots their original wire. */
  nests?: readonly CesrFrame[];
  /** Hosted endpoint provenance, retained across escrow. */
  mailboxAid?: string | null;
  /** Receiver-observed time supplied by local intake, independent of signed wire. */
  receiverTime?: string;
}

/** Result of this attempt; complete(said) separately reports any earlier durable acceptance. */
export type ExchangeDecision =
  | {
    kind: "accept";
    said: string;
  }
  | {
    kind: "escrow";
    reason: string;
    said: string;
  }
  | {
    kind: "reject";
    reason: string;
    said: string;
    /** MissingSignatureError preserves an existing escrow but does not authorize creating one. */
    preserveEscrow?: true;
    /** Original malformed-wire failure when a rejected attempt was classified from a caught error. */
    cause?: unknown;
  };
/** Concrete evidence passed to the synchronous admission turn after file preparation. */
interface PreparedExchangeEvidence {
  retained: readonly Texter[] | null;
  essrs?: readonly Texter[];
  attachments: ExchangeAttachment[];
  nestStage?: string;
  payload?: PreparedPayload;
}

/** Decision and committed follow-up data; asynchronous handlers execute outside the writer. */
interface ExchangeAdmission {
  decision: ExchangeDecision;
  cues: AgentCue[];
  handling?: Parameters<ExchangeRouteHandler["handle"]>[0];
  /** A committed terminal removal; its physical file is reclaimed by the operation's cleanup. */
  retired?: string;
  ejection?: EscrowEjection;
}

/** Diagnostic fact emitted only after a committed removal and joined file cleanup. */
interface EscrowEjection {
  family: "epse" | "emse";
  reason: string;
  detail?: string;
  cause?: unknown;
}

/** Current accepted/pending state, read within the admission or retirement writer. */
type EscrowStatus =
  | { kind: "accepted" }
  | { kind: "absent" }
  | { kind: "pending"; family: "epse" | "emse" }
  | { kind: "expired" | "missingTimestamp"; family: "epse" | "emse" };

/** One completed input attempt; an obsolete escrow retry returns no attempt. */
interface ExchangeAttempt {
  decision: ExchangeDecision;
  ejection?: EscrowEjection;
}

/**
 * Peer-to-peer `exn` processor for one `Habery`.
 *
 * Responsibilities:
 * - verify exchange-message signatures against accepted sender state
 * - persist accepted exchange artifacts in the dedicated exchange stores
 * - escrow partially verifiable exchange traffic in `epse.` / `epsd.`
 * - dispatch accepted messages to route-specific handlers such as challenge
 *
 * TypeScript design rule:
 * - use typed `accept` / `escrow` / `reject` outcomes instead of KERIpy's
 *   exception-only control flow for ordinary branch results
 */
export class Exchanger {
  readonly hby: Habery;
  readonly cues: Deck<AgentCue>;
  readonly routes = new Map<string, ExchangeRouteHandler>();
  private readonly versionedRoutes = new Map<string, Map<number, ExchangeRouteHandler>>();
  /** Borrow the runtime clock for escrow deadlines and retries. */
  private readonly now: () => number;
  /** Bind route handlers, cues and the escrow clock to one habitat database. */
  constructor(hby: Habery, { handlers = [], cues, now = Date.now }: {
    handlers?: readonly ExchangeRouteHandler[];
    cues?: Deck<AgentCue>;
    now?: () => number;
  } = {}) {
    this.now = now;
    this.hby = hby;
    this.cues = cues ?? new Deck();
    for (const handler of handlers) {
      this.addHandler(handler);
    }
  }

  /** Register one route handler for accepted exchange messages. */
  addHandler(handler: ExchangeRouteHandler): void {
    if (handler.protocolMajor !== undefined) {
      if (!Number.isSafeInteger(handler.protocolMajor) || handler.protocolMajor < 1) {
        throw new ValidationError("Exchange protocol major must be a positive integer.");
      }
      const versions = this.versionedRoutes.get(handler.resource) ?? new Map<number, ExchangeRouteHandler>();
      if (versions.has(handler.protocolMajor)) {
        throw new ValidationError(
          `Exchange route ${handler.resource} v${handler.protocolMajor} is already registered.`,
        );
      }
      versions.set(handler.protocolMajor, handler);
      this.versionedRoutes.set(handler.resource, versions);
      return;
    }
    if (this.routes.has(handler.resource)) {
      throw new ValidationError(
        `Exchange route ${handler.resource} is already registered.`,
      );
    }
    this.routes.set(handler.resource, handler);
  }

  /**
   * Verify, persist, and dispatch one inbound `exn`.
   *
   * Accepted messages are durably logged before any route-specific side
   * effects run so later reopen and verification paths can reuse the same
   * stored evidence.
   */
  processEvent(args: ExchangeInput): Operation<ExchangeDecision> {
    return call(function*(this: Exchanger) {
      const attempt = yield* this.admit(args);
      if (!attempt) throw new Error("A direct exchange input cannot become an obsolete escrow retry");
      return attempt.decision;
    }.bind(this));
  }
  /** Prepare immutable evidence, decide against current state, then finish committed effects. */
  private *admit(args: ExchangeInput, retry = false): Operation<ExchangeAttempt | undefined> {
    const said = args.serder.said ?? "<unknown>";
    const reject = (reason: string, cause?: unknown): ExchangeDecision => ({
      kind: "reject",
      said,
      reason,
      ...(cause !== undefined ? { cause } : {}),
    });
    let nestStage: string | undefined;
    let prepared: PreparedPayload | undefined;
    let archive: PayloadArchive | undefined;
    let retired: string | undefined;
    yield* resource(function*(provide: Provide<void>) {
      try {
        yield* provide(undefined);
      } finally {
        if (retired) yield* call(() => archive!.reclaim(retired!));
      }
    });
    yield* resource(function*(this: Exchanger, provide: Provide<void>) {
      try {
        yield* provide(undefined);
      } finally {
        try {
          if (prepared) yield* call(() => prepared!.discard());
        } finally {
          if (nestStage) this.hby.db.enstStaging.rem([nestStage]);
        }
      }
    }.bind(this));
    if (this.hby.db.inWriteTransaction) throw new Error("Exchanger must own the admission transaction");
    if (args.serder.ilk !== "exn") return { decision: reject(`Unsupported exchange ilk ${args.serder.ilk}.`) };
    if (!args.serder.pre || !args.serder.said) {
      return { decision: reject("Exchange message is missing sender or SAID.") };
    }
    if (args.receiverTime !== undefined && timestampMicros(args.receiverTime) === null) {
      throw new Error("Invalid exchange receiver time");
    }
    const route = args.serder.route ?? "";
    const handler = this.versionedRoutes.get(route)?.get(args.serder.pvrsn.major) ?? this.routes.get(route);
    // Freeze implied last-establishment coordinates at this input, then authenticate them in the final turn.
    const resolved = this.resolveProofs(args);
    const attachments = normalizeAttachments(args.ptds ?? []);
    if (args.essrs || args.nests?.length || hasNests(this.hby.db, said) || this.hby.db.exchangeMeta.get([said])?.essr) {
      archive = yield* abortable((signal) => this.hby.db.openPayloads(signal));
    }
    if (args.nests?.length) {
      nestStage = crypto.randomUUID();
      yield* abortable((signal) => stageNests(this.hby.db, nestStage!, args.nests!, signal));
    }
    for (;;) {
      if (prepared) {
        yield* call(() => prepared!.discard());
        prepared = undefined;
      }
      const previous = this.hby.db.exchangeMeta.get([said]);
      const reference = archive?.referenceId(`essr/${said}`) ?? null;
      if (reference && !previous?.essr) throw new Error("Exchange payload reference has no provenance");
      const imported = previous?.essr ? undefined : this.hby.db.essrs.get([said]).map((texter) => texter.qb64);
      let retained: Texter[] | null;
      try {
        retained = yield* abortable((signal) => this.hby.db.getEssrs(said, signal));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound && (archive?.referenceId(`essr/${said}`) ?? null) !== reference) {
          continue;
        }
        throw error;
      }
      const essrs = retained ?? args.essrs;
      let payloadFailure: Extract<ExchangeDecision, { kind: "reject" }> | undefined;
      if (typeof args.serder.a === "string") {
        try {
          const diger = new Diger({ qb64: args.serder.a });
          if (!essrs || !(yield* abortable((signal) => diger.verifyStream(essrRaw(essrs).open(signal))))) {
            payloadFailure = {
              kind: "reject",
              said,
              reason: "Exchange ESSR payload digest does not match its signed commitment.",
            };
          }
          if (
            retained && args.essrs
            && !(yield* abortable((signal) => diger.verifyStream(essrRaw(args.essrs!).open(signal))))
          ) {
            payloadFailure = {
              kind: "reject",
              said,
              reason: "Duplicate ESSR payload digest does not match its signed commitment.",
            };
          }
        } catch (error) {
          if (!malformedEssr(error)) throw error;
          payloadFailure = {
            kind: "reject",
            said,
            reason: `Invalid exchange ESSR payload: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          };
        }
      }
      if (essrs && !reference && !payloadFailure) {
        if (!archive) archive = yield* abortable((signal) => this.hby.db.openPayloads(signal));
        yield* abortable(async (signal) => {
          prepared = await archive!.prepare(essrWire(essrs), signal);
          signal.throwIfAborted();
        });
      }
      const result = this.hby.db.env!.transactionSync((): ExchangeAdmission | "obsolete" | null => {
        // A changed file/imported row snapshot requires fresh byte verification, never a stale decision.
        if ((archive?.referenceId(`essr/${said}`) ?? null) !== reference) return null;
        const current = this.hby.db.exchangeMeta.get([said]);
        if (Boolean(current?.essr) !== Boolean(previous?.essr)) return null;
        if (imported) {
          const rows = this.hby.db.essrs.get([said]);
          if (rows.length !== imported.length || rows.some((row, index) => row.qb64 !== imported[index])) return null;
        }
        let status: EscrowStatus | undefined;
        if (retry) {
          status = this.escrowStatus(said);
          if (status.kind === "accepted") {
            this.clearPending(said);
            return "obsolete";
          }
          if (status.kind === "absent") return "obsolete";
          if (status.kind !== "pending") {
            return {
              decision: { kind: "reject", said, reason: status.kind },
              cues: [],
              ...this.retireCurrent(said, archive, this.expiryReport(status)),
            };
          }
        }
        const currentInput = retry ? this.escrowInput(args.serder) : args;
        const admission: ExchangeAdmission = payloadFailure
          ? { decision: payloadFailure, cues: [] }
          : this.admitCurrent(currentInput, retry ? this.resolveProofs(currentInput) : resolved, handler, {
            retained,
            essrs,
            attachments: retry ? normalizeAttachments(currentInput.ptds ?? []) : attachments,
            nestStage,
            payload: prepared,
          }, archive);
        if (status?.kind === "pending" && admission.decision.kind === "reject" && !admission.decision.preserveEscrow) {
          return {
            ...admission,
            ...this.retireCurrent(said, archive, {
              family: status.family,
              reason: admission.decision.reason,
              cause: admission.decision.cause,
            }),
          };
        }
        return admission;
      });
      if (!result) continue;
      if (result !== "obsolete") retired = result.retired;
      // Commit visibility and durable completion are different boundaries. Cancellation joins this flush.
      yield* abortable(async () => {
        await this.hby.db.env!.flushed;
      });
      if (result === "obsolete") return undefined;
      for (const cue of result.cues) this.cues.push(cue);
      if (result.handling && handler) yield* call(() => handler.handle(result.handling!));
      return { decision: result.decision, ejection: result.ejection };
    }
  }

  /** Authenticate, validate route policy and write evidence in one uninterrupted owner turn. */
  private admitCurrent(
    args: ExchangeInput,
    resolved: ResolvedExchangeFactors,
    handler: ExchangeRouteHandler | undefined,
    prepared: PreparedExchangeEvidence,
    archive: PayloadArchive | undefined,
  ): ExchangeAdmission {
    const said = args.serder.said!;
    const authentication = this.authenticate(args.serder, resolved, handler);
    const cues: AgentCue[] = [];
    if (authentication.kind === "reject") return { decision: authentication, cues };
    let pending = authentication.kind === "escrow"
      ? { kind: authentication.kind, said, reason: authentication.reason }
      : undefined;
    const senderQuery = authentication.kind === "escrow" ? authentication.query : undefined;
    const approved = authentication.kind === "verified" ? authentication : undefined;
    const previous = this.hby.db.exchangeMeta.get([said]);
    const receiverTime = storedReceiverTime(previous) ?? args.receiverTime;
    const mailboxAid = args.mailboxAid ?? previous?.mailboxAid ?? null;
    const nests = args.nests?.length ? args.nests : loadNests(this.hby.db, said);
    if (
      nests.length
      && (!handler?.acceptsNests || !supportsNestedExchange(args.serder.route ?? "", args.serder.pvrsn.major))
    ) {
      return { decision: { kind: "reject", said, reason: "Nested exchange route is not implemented." }, cues };
    }
    let missingSchema: string | undefined;
    let needsProof = false;
    const handling = {
      serder: args.serder,
      attachments: prepared.attachments,
      essrs: prepared.essrs,
      nests,
      mailboxAid,
      receiverTime,
      ...(handler?.acceptsSscs && approved?.sscs.length ? { sscs: approved.sscs } : {}),
    };
    if (approved && handler?.verify) {
      const verified = handler.verify({
        ...handling,
        ...(handler.acceptsEvidence ? { evidence: approved.supplemental } : {}),
      });
      if (verified === false) {
        return {
          decision: {
            kind: "reject",
            said,
            reason: `Exchange route ${args.serder.route ?? ""} failed handler verification.`,
          },
          cues,
        };
      }
      if (typeof verified === "object") {
        pending = { ...verified, said };
        missingSchema = verified.schema;
        if (missingSchema !== undefined && new Diger({ qb64: missingSchema }).qb64 !== missingSchema) {
          throw new ValidationError("Route missing-schema dependency must be a complete SAID.");
        }
        needsProof = missingSchema === undefined;
      }
    }
    if (pending && this.complete(said)) return { decision: pending, cues };
    if (prepared.nestStage) publishNests(this.hby.db, said, prepared.nestStage);
    let newEscrow = false;
    if (!pending && approved) {
      this.clearEscrow(said, true);
      this.logAcceptedEvent({
        serder: args.serder,
        ...approved.retained,
        supplemental: approved.supplemental,
        ptds: args.ptds ?? [],
      });
    } else {
      const factors = approved?.retained ?? resolved;
      newEscrow = missingSchema === undefined
        ? this.escrowPartialSigned(args.serder, factors, args.ptds ?? [])
        : this.escrowMissingSchema(args.serder, missingSchema, factors, args.ptds ?? []);
    }
    if (prepared.essrs && !prepared.retained) {
      this.hby.db.essrs.rem([said]);
      for (const texter of prepared.essrs) this.hby.db.essrs.add([said], texter);
    }
    if (prepared.payload) archive!.pin(`essr/${said}`, prepared.payload);
    this.hby.db.exchangeMeta.pin([said], {
      mailboxAid,
      ...(receiverTime !== undefined ? { receiverTime } : {}),
      ...(prepared.essrs
        ? { essr: { gvrsn: previous?.essr?.gvrsn ?? args.gvrsn ?? args.serder.gvrsn ?? args.serder.pvrsn } }
        : {}),
    });
    if (pending) {
      if (newEscrow) {
        if (senderQuery) cues.push(...this.missingStateCues([senderQuery]));
        if (needsProof) cues.push({ kin: "proof", said });
        if (missingSchema) cues.push({ kin: "query", q: { r: "schema", said: missingSchema } });
      }
      return { decision: pending, cues };
    }
    return { decision: { kind: "accept", said }, cues, handling };
  }

  /** Retry escrows using their persisted payload references and mailbox provenance. */
  processEscrows(): Operation<void> {
    return call(() => this.retryEscrows());
  }
  /** Retry each bounded escrow inside one structured child scope. */
  private *retryEscrows(): Operation<void> {
    if (this.hby.db.inWriteTransaction) throw new Error("Exchanger must own escrow transactions");
    yield* this.retryEscrowType(false);
    if (this.hby.db.emse) yield* this.retryEscrowType(true);
  }
  /**
   * Close each cursor before replay; newly discovered dependencies wait for the next finite pass.
   * Terminal diagnostics follow joined evidence cleanup, while acceptance and dependency migration stay silent.
   *
   * @param schema Select missing-schema escrow instead of partial-signature/proof escrow.
   */
  private *retryEscrowType(schema: boolean): Operation<void> {
    const table = schema ? this.hby.db.emse! : this.hby.db.epse;
    let end: Uint8Array | undefined;
    // Capture a finite key horizon without retaining bodies or holding a cursor across mutations.
    for (const key of table.sdb.getKeys({ reverse: true, limit: 1 })) {
      end = b(`${textDecoder.decode(key)}\0`);
    }
    if (!end) {
      return;
    }
    let start: Uint8Array | undefined;
    for (;;) {
      let physical: string | undefined;
      for (const key of table.sdb.getKeys({ start, end, limit: 1 })) {
        physical = textDecoder.decode(key);
      }
      if (!physical) break;
      const keys = physical.split("."), said = keys[0];
      // Skip every schema branch for this EXN, including dependencies inserted by the replay below.
      start = b(schema ? `${said}/` : `${physical}\0`);
      const serder = table.get(keys);
      if (!serder || serder.ilk !== "exn" || !serder.pre || serder.said !== said || keys.length !== (schema ? 2 : 1)) {
        throw new Error("Corrupt exchange escrow key or body.");
      }
      if (schema && new Diger({ qb64: keys[1] }).qb64 !== keys[1]) throw new Error("Corrupt schema escrow dependency.");
      const expired = yield* call(() => this.expirePending(said));
      if (expired) {
        consoleLogger.warn("Exchanger ejected exchange escrow", {
          said,
          pre: serder.pre,
          route: serder.route,
          ...expired,
        });
        continue;
      }
      const attempt = yield* call(() => this.admit(this.escrowInput(serder), true));
      if (attempt?.ejection) {
        consoleLogger.warn("Exchanger ejected exchange escrow", {
          said,
          pre: serder.pre,
          route: serder.route,
          ...attempt.ejection,
        });
      }
    }
  }
  /** Own accepted-evidence replay and its actual payload readers through completion or cancellation. */
  async *replay(said: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    signal?.throwIfAborted();
    const serder = this.hby.db.exns.get([said]);
    if (!serder) throw new ValidationError("Cannot replay an unaccepted exchange.");
    const essrs = await this.hby.db.getEssrs(said, signal);
    signal?.throwIfAborted();
    const gvrsn = resolveAttachmentGvrsn(serder, this.hby.db.exchangeMeta.get([said])?.essr?.gvrsn);
    const args = {
      serder,
      tsgs: this.rebuildEscrowedGroups(said),
      cigars: this.storedCigars(said),
      sourceSeals: this.storedSeals(said),
      ptds: this.hby.db.epath.get([said]).map((text) => PathedMaterialGroup.fromRaw(new TextEncoder().encode(text))),
    };
    const verified = verifyExchangeProofs(this.hby.db, serder, args);
    if (
      verified.invalid || verified.missing.length || !(verified.tsgs.some((group) => group.pre === serder.pre)
        || verified.cigars.some((cigar) => cigar.verfer?.qb64 === serder.pre)
        || verified.sourceSeals.some((seal) => seal.i.qb64 === serder.pre))
    ) throw new ValidationError("Invalid stored exchange authentication or evidence.");
    const evidence = { ...verified, pathed: args.ptds.map((group) => group.raw) };
    const nested = hasNests(this.hby.db, said);
    {
      const groups = nested ? messageAttachmentGroups(evidence, gvrsn) : [];
      const nests = nested ? loadNests(this.hby.db, said) : [];
      if (nests.length) {
        // Reuse the stored Serder and hydrated endorsements; the shared encoder builds real leaf groups.
        const parent: CesrFrame = {
          body: serder,
          attachments: groups,
          gvrsn,
          nests,
          essrs: essrs ?? undefined,
        };
        yield* framePayload(parent).open(signal);
      } else {
        signal?.throwIfAborted();
        yield serializeMessage(serder, { ...evidence, gvrsn, genusify: gvrsn.major >= 2 });
        if (essrs) {
          for (const chunk of essrChunks(essrs, { gvrsn })) {
            signal?.throwIfAborted();
            yield chunk;
          }
        }
      }
    }
  }

  /** Return true once the named exchange SAID is durably stored as accepted. */
  complete(said: string): boolean {
    return this.hby.db.exns.get([said])?.said === said;
  }

  /**
   * Return true when this local habitat is elected to externally send an EXN.
   *
   * KERIpy uses the lowest collected group-signature index as the lead for a
   * completed multisig business EXN. Single-sig habitats are always the lead.
   */
  lead(hab: Hab, said: string): boolean {
    const record = this.hby.db.getHab(hab.pre);
    if (!record?.mid) {
      return true;
    }

    const groupKever = hab.kever;
    const member = this.hby.habs.get(record.mid);
    const memberKever = member?.kever ?? this.hby.db.getKever(record.mid);
    const memberKey = memberKever?.verfers[0]?.qb64;
    if (!groupKever || !memberKey) {
      return false;
    }

    const indices: number[] = [];
    for (const [keys, siger] of this.hby.db.esigs.getTopItemIter([said, ""])) {
      if (keys[0] === said && keys[1] === hab.pre) {
        indices.push(siger.index);
      }
    }
    if (indices.length === 0) {
      return false;
    }

    const leadKey = groupKever.verfers[Math.min(...indices)]?.qb64;
    return leadKey === memberKey;
  }

  /** Freeze last-establishment groups and expand sender-implied seals before durable admission. */
  private resolveProofs(args: ExchangeInput): ResolvedExchangeFactors {
    const result: ResolvedExchangeFactors = {
      tsgs: [...(args.tsgs ?? [])],
      cigars: [...(args.cigars ?? [])],
      sourceSeals: [
        ...(args.sscs ?? []).map((seal) => ({ ...seal, i: new Prefixer({ qb64: args.serder.pre! }) })),
        ...(args.sourceSeals ?? []),
      ],
      missing: (args.unresolvedLast ?? []).map((prefix) => ({ pre: prefix.qb64, sn: null })),
    };
    for (const group of args.lsgs ?? []) {
      const kever = this.hby.db.getKever(group.pre);
      if (!kever) {
        result.missing.push({ pre: group.pre, sn: null });
        continue;
      }
      result.tsgs.push(
        new TransIdxSigGroup(
          group.prefixer,
          NumberPrimitive.fromNum(BigInt(kever.lastEst.s)),
          new Diger({ qb64: kever.lastEst.d }),
          group.sigers,
        ),
      );
    }
    return result;
  }
  /** Match sender-factor precedence and let the registered route select supplemental evidence. */
  private authenticate(
    serder: SerderKERI,
    resolved: ResolvedExchangeFactors,
    handler: ExchangeRouteHandler | undefined,
  ):
    | AuthenticatedExchange
    | (
      & Exclude<ExchangeDecision, { kind: "accept" }>
      & { query?: MissingExchangeState }
    )
  {
    const said = serder.said!;
    const sender = serder.pre!;
    const senderTsgs = aggregateTransIdxSigGroups(resolved.tsgs.filter((group) => group.pre === sender));
    const extraTsgs = aggregateTransIdxSigGroups(resolved.tsgs.filter((group) => group.pre !== sender));
    const cigars = senderTsgs.length && !handler?.verifyEvidence ? [] : resolved.cigars;
    const senderCigars = cigars.filter((cigar) => cigar.verfer?.qb64 === sender);
    const extraCigars = cigars.filter((cigar) => cigar.verfer?.qb64 !== sender);
    this.cueMissingStates(resolved.missing);
    if (
      resolved.missing.length && (!handler?.acceptsMissingEvidence || resolved.missing.some((m) => m.pre === sender))
    ) {
      // An unresolved last-establishment reference has no historical coordinate to persist.
      // Sender intake recovery belongs to the consolidated processMsg/KRAM boundary.
      return {
        kind: "reject",
        said,
        preserveEscrow: true,
        reason: "Unresolved last-establishment evidence requires key state and retransmission.",
      };
    }
    const sealed = verifyExchangeProofs(this.hby.db, serder, {
      sourceSeals: resolved.sourceSeals.filter((seal) => seal.i.qb64 === sender),
    });
    if (sealed.missing.length) {
      this.cueMissingStates(sealed.missing);
      return {
        kind: handler?.acceptsSscs ? "escrow" : "reject",
        ...(!handler?.acceptsSscs ? { preserveEscrow: true as const } : {}),
        said,
        reason: "Missing sender source-seal KEL evidence.",
      };
    }
    let tsgs: TransIdxSigGroup[];
    let validCigars: Cigar[];
    if (sealed.sourceSeals.length) {
      // A valid sender seal wins; invalid optional sender signatures cannot undo its authentication.
      tsgs = verifyExchangeProofs(this.hby.db, serder, { tsgs: senderTsgs }).tsgs;
      validCigars = [];
    } else {
      if (
        !handler?.verifyEvidence && !senderTsgs.length && !senderCigars.length
        && (extraTsgs.length || extraCigars.length)
      ) {
        return {
          kind: "reject",
          said,
          preserveEscrow: true,
          reason: "Exchange has foreign proofs without sender authentication.",
        };
      }
      const signatures = this.verifySignatures({ serder, sender, tsgs: senderTsgs, cigars: senderCigars });
      if (signatures.kind !== "verified") {
        return signatures;
      }
      tsgs = signatures.tsgs;
      validCigars = signatures.cigars;
    }
    if (!handler?.verifyEvidence && (extraTsgs.length || extraCigars.length)) {
      return {
        kind: "reject",
        said,
        preserveEscrow: true,
        reason: "Exchange route does not accept supplemental endorsements.",
      };
    }
    let supplemental: Required<ExchangeFactors> = { tsgs: [], cigars: [], sourceSeals: [] };
    if (handler?.verifyEvidence) {
      const { invalid, missing, ...factors } = verifyExchangeProofs(this.hby.db, serder, {
        tsgs: extraTsgs,
        cigars: extraCigars,
        sourceSeals: resolved.sourceSeals.filter((seal) => seal.i.qb64 !== sender),
      });
      // Each reference helper invocation deduplicates its own coordinate list. Do not
      // re-query unresolved last groups when passing them on to the selection hook.
      this.cueMissingStates(missing);
      if (missing.length && !handler.acceptsMissingEvidence) {
        return { kind: "reject", said, preserveEscrow: true, reason: "Missing supplemental proof key state." };
      }
      const selection = handler.verifyEvidence!({
        serder,
        factors,
        invalid,
        ...(handler.acceptsMissingEvidence ? { missing: [...resolved.missing, ...missing] } : {}),
      });
      const selected = selection;
      if (!selected) return { kind: "reject", said, reason: "Route rejected supplemental exchange proofs." };
      supplemental = {
        tsgs: selected.tsgs ?? [],
        cigars: selected.cigars ?? [],
        sourceSeals: selected.sourceSeals ?? [],
      };
    }
    return {
      kind: "verified",
      supplemental,
      sscs: sealed.sourceSeals.map(({ s, d }) => ({ s, d })),
      retained: {
        tsgs: [...tsgs, ...supplemental.tsgs],
        cigars: [...validCigars, ...supplemental.cigars],
        sourceSeals: [...sealed.sourceSeals, ...supplemental.sourceSeals],
      },
    };
  }
  /** Missing-key queries describe observed facts even when later validation or storage fails. */
  private cueMissingStates(missing: readonly MissingExchangeState[]): void {
    for (const cue of this.missingStateCues(missing)) this.cues.push(cue);
  }

  /** Match _cueMissingKeyState's coordinate deduplication within this invocation. */
  private missingStateCues(missing: readonly MissingExchangeState[]): AgentCue[] {
    const cues: AgentCue[] = [];
    const seen = new Set<string>();
    for (const { pre, sn } of missing) {
      const key = `${pre}:${sn ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      cues.push({
        kin: "query",
        pre,
        route: "logs",
        q: sn === null ? {} : { s: sn.toString(16) },
      });
    }
    return cues;
  }

  /** Reattach the persisted verifier to each nontransferable signature before replay or retry. */
  private storedCigars(said: string): Cigar[] {
    return this.hby.db.ecigs.get([said]).map(([verfer, cigar]) => new Cigar(cigar, verfer));
  }

  /** Restore source triples without losing the anchoring AID or its historical ordinal. */
  private storedSeals(said: string): SealEvent[] {
    const seals: SealEvent[] = [];
    for (const [keys, [s, d]] of this.hby.db.ests.getTopItemIter([said, ""])) {
      seals.push({ i: new Prefixer({ qb64: keys[1] }), s, d });
    }
    return seals;
  }

  /** Classify sender endorsements without publishing exchange or payload ownership. */
  private verifySignatures(args: {
    serder: SerderKERI;
    sender: string;
    tsgs: readonly TransIdxSigGroup[];
    cigars: readonly Cigar[];
  }):
    | {
      kind: "verified";
      tsgs: TransIdxSigGroup[];
      cigars: Cigar[];
    }
    | (Exclude<ExchangeDecision, { kind: "accept" }> & { query?: MissingExchangeState })
  {
    if (args.tsgs.length > 0) {
      const verifiedGroups: TransIdxSigGroup[] = [];
      const grouped = args.tsgs;

      for (const tsg of grouped) {
        if (tsg.pre !== args.sender) {
          return {
            kind: "reject",
            reason: `Exchange signer ${tsg.pre} does not match sender ${args.sender}.`,
            said: args.serder.said ?? "<unknown>",
          };
        }

        if (tsg.sn > BigInt(Number.MAX_SAFE_INTEGER)) {
          return { kind: "reject", reason: "Sender ordinal exceeds runtime range.", said: args.serder.said! };
        }
        const estSaid = this.hby.db.kels.getLast(tsg.pre, Number(tsg.sn));
        const estEvent = estSaid ? this.hby.db.getEvtSerder(tsg.pre, estSaid) : null;
        if (!estSaid || !estEvent) {
          return {
            kind: "escrow",
            query: { pre: tsg.pre, sn: tsg.sn },
            reason: `Missing accepted establishment state for ${tsg.pre}:${tsg.said}.`,
            said: args.serder.said ?? "<unknown>",
          };
        }

        if (estSaid !== tsg.said || !estEvent.estive || !tsg.prefixer.transferable) {
          return { kind: "reject", reason: "Invalid sender establishment reference.", said: args.serder.said! };
        }
        const tholder = estEvent.tholder;
        if (!tholder || estEvent.verfers.length < tholder.size) {
          return {
            kind: "reject",
            reason: `Invalid threshold material for exchange signer ${tsg.pre}.`,
            said: args.serder.said ?? "<unknown>",
          };
        }

        const verified = Kever.verifyIndexedSignatures(
          args.serder.raw,
          tsg.sigers,
          estEvent.verfers,
        );
        if (!tholder.satisfy(verified.indices)) {
          return {
            kind: "escrow",
            query: { pre: tsg.pre, sn: tsg.sn },
            reason: `Exchange ${args.serder.said ?? "<unknown>"} does not yet satisfy sender threshold.`,
            said: args.serder.said ?? "<unknown>",
          };
        }

        verifiedGroups.push(
          new TransIdxSigGroup(
            tsg.prefixer,
            tsg.seqner,
            tsg.diger,
            verified.sigers,
          ),
        );
      }

      return { kind: "verified", tsgs: verifiedGroups, cigars: [] };
    }

    if (args.cigars.length > 0) {
      const verifiedCigars: Cigar[] = [];
      for (const cigar of args.cigars) {
        if (!cigar.verfer) {
          return {
            kind: "reject",
            reason: "Exchange cigar is missing verifier context.",
            said: args.serder.said ?? "<unknown>",
          };
        }
        if (cigar.verfer.qb64 !== args.sender) {
          return {
            kind: "reject",
            reason: `Exchange cigar signer ${cigar.verfer.qb64} does not match sender ${args.sender}.`,
            said: args.serder.said ?? "<unknown>",
          };
        }
        if (cigar.verfer.transferable || !cigar.verfer.verify(cigar.raw, args.serder.raw)) {
          return {
            kind: "reject",
            preserveEscrow: true,
            reason: `Exchange cigar failed verification for ${args.sender}.`,
            said: args.serder.said ?? "<unknown>",
          };
        }
        verifiedCigars.push(cigar);
      }

      return { kind: "verified", tsgs: [], cigars: verifiedCigars };
    }

    return {
      kind: "escrow",
      reason: "Exchange message has no signatures yet.",
      said: args.serder.said ?? "<unknown>",
    };
  }
  /** Retain incomplete endorsements and the original expiration clock for retry. */
  private escrowPartialSigned(
    serder: SerderKERI,
    factors: Required<ExchangeFactors>,
    ptds: readonly PathedMaterialGroup[],
  ): boolean {
    const said = serder.said;
    if (!said) {
      throw new ValidationError("Cannot escrow an exchange without a SAID.");
    }
    if (this.complete(said)) {
      return false;
    }
    this.storeEscrowEvidence(serder, factors, ptds);
    this.hby.db.emse?.trim([said]);
    // Preserve first admission time so repeated retries cannot keep stale wire alive forever.
    this.hby.db.epsd.put([said], new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601(new Date(this.now()))) }));
    return this.hby.db.epse.put([said], serder);
  }
  /** Persist the same independently authenticated evidence for signature and schema dependencies. */
  private storeEscrowEvidence(
    serder: SerderKERI,
    factors: Required<ExchangeFactors>,
    ptds: readonly PathedMaterialGroup[],
  ): void {
    const said = serder.said!;

    for (const tsg of factors.tsgs) {
      const quadKey = [said, tsg.pre, tsg.sn.toString(16).padStart(32, "0"), tsg.said] as const;
      for (const siger of tsg.sigers) {
        this.hby.db.esigs.add(quadKey, siger);
      }
    }
    for (const cigar of factors.cigars) {
      if (cigar.verfer) {
        this.hby.db.ecigs.add([said], [cigar.verfer, cigar]);
      }
    }
    for (const seal of factors.sourceSeals) this.hby.db.ests.add([said, seal.i.qb64], [seal.s, seal.d]);
    this.hby.db.epath.pin(
      [said],
      ptds.map((group) => textDecoder.decode(group.raw)),
    );
  }
  /** One absolute deadline spans sequential schema dependencies; receiver receipt is not the TMSC opener. */
  private escrowMissingSchema(
    serder: SerderKERI,
    schema: string,
    factors: Required<ExchangeFactors>,
    ptds: readonly PathedMaterialGroup[],
  ): boolean {
    const { emse, emsd } = this.hby.db, said = serder.said!;
    if (!emse || !emsd) throw new ValidationError("Missing-schema storage is unavailable on this readonly layout.");
    if (this.complete(said)) {
      return false;
    }
    const prior = emsd.get([said]);
    if (prior && timestampMicros(prior.dts) === null) throw new Error("Corrupt missing-schema deadline.");
    if (!prior) {
      const xid = serder.sad!.x;
      const cache = typeof xid === "string" && xid ? this.hby.db.tmsc.get([serder.pre!, xid, said]) : null;
      const opener = cache && timestampMicros(cache.xdt);
      if (cache && (opener === null || opener === undefined || !Number.isSafeInteger(cache.pxl) || cache.pxl! < 0)) {
        throw new Error("Corrupt missing-schema transaction lifetime.");
      }
      const expiry = cache ? opener! + BigInt(cache.pxl!) * 1000n : this.nowMicros() + 20_000_000n;
      const remainder = (expiry % 1000n + 1000n) % 1000n;
      const text = makeNowIso8601(new Date(Number((expiry - remainder) / 1000n)))
        .replace(/\d{6}\+/, ((expiry % 1_000_000n + 1_000_000n) % 1_000_000n).toString().padStart(6, "0") + "+");
      if (timestampMicros(text) !== expiry) throw new Error("Missing-schema deadline exceeds supported date range.");
      emsd.put([said], new Dater({ qb64: encodeDateTimeToDater(text) }));
    }
    this.storeEscrowEvidence(serder, factors, ptds);
    this.hby.db.epse.rem([said]);
    this.hby.db.epsd.rem([said]);
    const stored = emse.get([said, schema]) === null;
    emse.trim([said]);
    emse.put([said, schema], serder);
    return stored;
  }
  /** Trusted clock failures remain infrastructure errors rather than expiring remote work. */
  private nowMicros(): bigint {
    const now = new Date(this.now()).getTime();
    if (!Number.isFinite(now)) throw new Error("Invalid exchange receiver clock.");
    return BigInt(now) * 1000n;
  }
  /** Persist protocol evidence inside the admission transaction before route handling. */
  private logAcceptedEvent(
    args: {
      serder: SerderKERI;
      tsgs: readonly TransIdxSigGroup[];
      cigars: readonly Cigar[];
      sourceSeals: readonly SealEvent[];
      supplemental: Required<ExchangeFactors>;
      ptds: readonly PathedMaterialGroup[];
    },
  ): void {
    const said = args.serder.said;
    if (!said) {
      throw new ValidationError("Cannot log an exchange without a SAID.");
    }

    for (const tsg of args.tsgs) {
      const quadKey = [said, tsg.pre, tsg.sn.toString(16).padStart(32, "0"), tsg.said] as const;
      for (const siger of tsg.sigers) {
        this.hby.db.esigs.add(quadKey, siger);
      }
    }
    for (const cigar of args.cigars) {
      if (!cigar.verfer) {
        throw new ValidationError(
          "Cannot log a cigar without verifier context.",
        );
      }
      this.hby.db.ecigs.add([said], [cigar.verfer, cigar]);
    }
    this.hby.db.epath.pin(
      [said],
      args.ptds.map((group) => textDecoder.decode(group.raw)),
    );
    for (const seal of args.sourceSeals) this.hby.db.ests.add([said, seal.i.qb64], [seal.s, seal.d]);
    const endorsers = new Set([
      ...args.supplemental.tsgs.map((group) => group.pre),
      ...args.supplemental.cigars.map((cigar) => cigar.verfer!.qb64),
      ...args.supplemental.sourceSeals.map((seal) => seal.i.qb64),
    ]);
    for (const pre of endorsers) this.hby.db.eidx.add([pre], new Diger({ qb64: said }));
    const prior = args.serder.ked?.p;
    if (typeof prior === "string" && prior.length > 0) {
      this.hby.db.erpy.pin([prior], new Saider({ qb64: said }));
    }

    this.hby.db.exns.pin([said], args.serder);
  }

  private rebuildEscrowedGroups(said: string): TransIdxSigGroup[] {
    const groups: TransIdxSigGroup[] = [];
    let currentKey: string[] | null = null;
    let currentSigers: Siger[] = [];

    const flush = () => {
      if (!currentKey || currentSigers.length === 0) {
        return;
      }
      groups.push(
        new TransIdxSigGroup(
          new Prefixer({ qb64: currentKey[0] }),
          seqnerFromSnh(currentKey[1]),
          new Diger({ qb64: currentKey[2] }),
          currentSigers,
        ),
      );
      currentSigers = [];
    };

    for (const [keys, siger] of this.hby.db.esigs.getTopItemIter([said, ""])) {
      const groupKey = keys.slice(1);
      if (!groupKey[0] || !groupKey[1] || !groupKey[2]) {
        continue;
      }
      if (
        currentKey
        && (currentKey[0] !== groupKey[0]
          || currentKey[1] !== groupKey[1]
          || currentKey[2] !== groupKey[2])
      ) {
        flush();
      }
      currentKey = [groupKey[0], groupKey[1], groupKey[2]];
      currentSigers.push(siger);
    }

    flush();
    return groups;
  }

  /** Clear pending metadata, preserving wire evidence during the acceptance transaction. */
  private clearEscrow(said: string, keepEvidence = false): void {
    this.clearPending(said);
    // First acceptance replaces provisional factors; accepted duplicates accumulate verified proofs.
    if (!keepEvidence || !this.complete(said)) {
      this.hby.db.esigs.trim([said, ""], { topive: false });
      this.hby.db.ecigs.rem([said]);
      this.hby.db.ests.trim([said, ""], { topive: false });
    }
    this.hby.db.epath.rem([said]);
    if (!keepEvidence) {
      this.hby.db.essrs.rem([said]);
      this.hby.db.enst.rem([said]);
      this.hby.db.exchangeMeta.rem([said]);
    }
  }
  /** Snapshot current escrow proofs; retry re-reads this data again in its final writer. */
  private escrowInput(serder: SerderKERI): ExchangeInput {
    const said = serder.said!;
    return {
      serder,
      tsgs: this.rebuildEscrowedGroups(said),
      cigars: this.storedCigars(said),
      sourceSeals: this.storedSeals(said),
      ptds: this.hby.db.epath.get([said]).map((text) => PathedMaterialGroup.fromRaw(new TextEncoder().encode(text))),
      mailboxAid: this.hby.db.exchangeMeta.get([said])?.mailboxAid,
    };
  }

  /** Decide eligibility from current accepted records and both protocol deadline stores. */
  private escrowStatus(said: string): EscrowStatus {
    if (this.complete(said)) return { kind: "accepted" };
    const partial = this.hby.db.epse.get([said]) !== null;
    if (!partial && !this.hby.db.hasSchemaEscrow(said)) return { kind: "absent" };
    const family = partial ? "epse" : "emse";
    const deadline = this.hby.db.emsd?.get([said]);
    const absolute = deadline && timestampMicros(deadline.dts);
    if (deadline && absolute === null) throw new Error("Corrupt missing-schema deadline.");
    const dater = partial ? this.hby.db.epsd.get([said]) : deadline;
    const date = dater && timestampMicros(dater.dts);
    if (date === null || date === undefined) {
      if (!partial) throw new Error("Corrupt missing-schema deadline.");
      return { kind: "missingTimestamp", family };
    }
    const now = this.nowMicros();
    if (
      now > date + (partial ? BigInt(EXCHANGE_ESCROW_TIMEOUT_MS) * 1000n : 0n)
      || absolute !== null && absolute !== undefined && now > absolute
    ) return { kind: "expired", family };
    return { kind: "pending", family };
  }

  /** Describe only the terminal decision that the owning writer actually commits. */
  private expiryReport(status: { kind: "expired" | "missingTimestamp"; family: "epse" | "emse" }): EscrowEjection {
    const detail = status.kind === "missingTimestamp"
      ? "Pending exchange has no valid admission timestamp."
      : "Exchange dependency exceeded its pending lifetime or absolute schema deadline.";
    return { family: status.family, reason: status.kind, detail };
  }

  /** Unpublish pending evidence and return its exact retired file, all in the current domain writer. */
  private retireCurrent(said: string, archive: PayloadArchive | undefined, ejection: EscrowEjection): {
    retired?: string;
    ejection: EscrowEjection;
  } {
    let retired: string | undefined;
    if (this.hby.db.exchangeMeta.get([said])?.essr) {
      if (!archive) throw new Error("Pending exchange file owner is unavailable");
      retired = archive.unpin(`essr/${said}`) ?? undefined;
      if (!retired) throw new Error("Pending exchange payload reference is missing");
    }
    this.clearEscrow(said);
    return { retired, ejection };
  }

  /** Finish archive startup before deciding expiry; commit removal before asynchronous reclamation. */
  private *expirePending(said: string): Operation<EscrowEjection | undefined> {
    let archive: PayloadArchive | undefined;
    let retired: string | undefined;
    yield* resource(function*(provide: Provide<void>) {
      try {
        yield* provide(undefined);
      } finally {
        if (retired) yield* call(() => archive!.reclaim(retired!));
      }
    });
    if (this.hby.db.exchangeMeta.get([said])?.essr) {
      archive = yield* abortable((signal) => this.hby.db.openPayloads(signal));
    }
    const result = this.hby.db.env!.transactionSync(() => {
      const status = this.escrowStatus(said);
      if (status.kind === "accepted") {
        this.clearPending(said);
        return undefined;
      }
      if (status.kind === "absent" || status.kind === "pending") return undefined;
      return this.retireCurrent(said, archive, this.expiryReport(status));
    });
    retired = result?.retired;
    yield* abortable(async () => {
      await this.hby.db.env!.flushed;
    });
    return result?.ejection;
  }

  /** Clear only dependency markers, keeping all accepted evidence and metadata intact. */
  private clearPending(said: string): void {
    this.hby.db.epse.rem([said]);
    this.hby.db.epsd.rem([said]);
    this.hby.db.emse?.trim([said]);
    this.hby.db.emsd?.rem([said]);
  }
}

function normalizeAttachments(
  ptds: readonly PathedMaterialGroup[],
): ExchangeAttachment[] {
  return ptds.map((group) => ({
    raw: group.raw.slice(),
    text: textDecoder.decode(group.raw),
  }));
}

function hexToFixedBytes(hex: string, size: number): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error(`Invalid hex ordinal ${hex}`);
  }
  if (normalized.length > size * 2) {
    throw new Error(`Hex ordinal ${hex} exceeds ${size} bytes.`);
  }

  const raw = new Uint8Array(size);
  const padded = normalized.padStart(size * 2, "0");
  for (let i = 0; i < size; i++) {
    raw[i] = Number.parseInt(padded.slice(i * 2, (i * 2) + 2), 16);
  }
  return raw;
}

function seqnerFromSnh(snh: string): Seqner {
  return new Seqner({ code: "0A", raw: hexToFixedBytes(snh, 16) });
}

function aggregateTransIdxSigGroups(
  groups: readonly TransIdxSigGroup[],
): TransIdxSigGroup[] {
  const aggregated = new Map<string, TransIdxSigGroup>();
  for (const group of groups) {
    const key = `${group.pre}\0${group.sn}\0${group.said}`;
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, group);
      continue;
    }
    aggregated.set(
      key,
      new TransIdxSigGroup(
        existing.prefixer,
        existing.seqner,
        existing.diger,
        [...existing.sigers, ...group.sigers],
      ),
    );
  }
  return [...aggregated.values()];
}
