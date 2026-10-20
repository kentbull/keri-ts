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
  ): ExchangeFactors | null | Operation<ExchangeFactors | null>;
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
  }): ExchangeRouteVerification | Operation<ExchangeRouteVerification>;
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
  /** Serialize admissions so payload recovery cannot race this owner's unfinished publication. */
  private processing = false;
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
    return call(() => this.admit(args));
  }
  /** Hold one exchange mutation until its child I/O and payload cleanup have finished. */
  private admission(): Operation<void> {
    return resource(function*(this: Exchanger, provide: Provide<void>) {
      if (this.processing) throw new ValidationError("Exchanger has an active admission.");
      this.processing = true;
      try {
        yield* provide(undefined);
      } finally {
        this.processing = false;
      }
    }.bind(this));
  }
  /** Isolate admission cleanup so cancelling it cannot resume the caller after delegation. */
  private *admit(args: ExchangeInput): Operation<ExchangeDecision> {
    const said = args.serder.said ?? "<unknown>";
    /** Keep normal remote admission failures in the decision channel. */
    const reject = (reason: string, cause?: unknown): ExchangeDecision => ({
      kind: "reject",
      reason,
      said,
      ...(cause !== undefined ? { cause } : {}),
    });
    let nestStage: string | undefined;
    let nests: readonly CesrFrame[] = args.nests ?? [];
    // Resources unwind in reverse order: I/O, payload cleanup, then admission release.
    yield* this.admission();
    yield* resource(function*(this: Exchanger, provide: Provide<void>) {
      try {
        yield* provide(undefined);
      } finally {
        if (nestStage) this.hby.db.enstStaging.rem([nestStage]);
      }
    }.bind(this));
    if (args.serder.ilk !== "exn") return reject(`Unsupported exchange ilk ${args.serder.ilk}.`);
    const sender = args.serder.pre;
    if (!sender || !args.serder.said) return reject("Exchange message is missing sender or SAID.");
    const route = args.serder.route ?? "";
    const handler = this.versionedRoutes.get(route)?.get(args.serder.pvrsn.major) ?? this.routes.get(route);
    const resolved = this.resolveProofs(args);
    const authentication = yield* this.authenticate(args.serder, resolved, handler);
    if (authentication.kind === "reject") return authentication;
    let pending = authentication.kind === "escrow"
      ? { kind: authentication.kind, said, reason: authentication.reason }
      : undefined;
    const senderQuery = authentication.kind === "escrow" ? authentication.query : undefined;
    let needsProof = false;
    let missingSchema: string | undefined;
    let newEscrow = false;
    const approved = authentication.kind === "verified" ? authentication : undefined;
    const retainedFactors = approved?.retained ?? resolved;

    const previous = this.hby.db.exchangeMeta.get([said]);
    const priorReceipt = storedReceiverTime(previous);
    const incomingReceipt = args.receiverTime;
    if (incomingReceipt !== undefined && timestampMicros(incomingReceipt) === null) {
      throw new Error("Invalid exchange receiver time");
    }
    const receiverTime = priorReceipt ?? incomingReceipt;
    const retained = yield* abortable((signal) => this.hby.db.getEssrs(said, signal));
    const existing = previous?.essr ? retained : null;
    // First durable evidence retains its original token boundaries and multiplicity.
    const essrs = retained ?? args.essrs;
    if (typeof args.serder.a === "string") {
      let diger: Diger;
      // Commitment construction is synchronous syntax work; payload verification owns asynchronous reads.
      try {
        diger = new Diger({ qb64: args.serder.a });
      } catch (error) {
        if (!malformedEssr(error)) throw error;
        return reject(
          `Invalid exchange ESSR payload: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
      try {
        if (!essrs || !(yield* abortable((signal) => diger.verifyStream(essrRaw(essrs).open(signal))))) {
          return reject("Exchange ESSR payload digest does not match its signed commitment.");
        }
        if (
          retained && args.essrs
          && !(yield* abortable((signal) => diger.verifyStream(essrRaw(args.essrs!).open(signal))))
        ) {
          return reject("Duplicate ESSR payload digest does not match its signed commitment.");
        }
      } catch (error) {
        if (!malformedEssr(error)) throw error;
        return reject(
          `Invalid exchange ESSR payload: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
    }
    const attachments = normalizeAttachments(args.ptds ?? []);
    let retainedNests = hasNests(this.hby.db, said);
    if (args.nests?.length || retainedNests) {
      // Recover only nested work; ordinary flat exchanges need no file archive.
      yield* abortable((signal) => this.hby.db.openPayloads(signal));
      retainedNests = hasNests(this.hby.db, said);
    }
    if (
      (args.nests?.length || retainedNests)
      && (!handler?.acceptsNests || !supportsNestedExchange(args.serder.route ?? "", args.serder.pvrsn.major))
    ) {
      return reject("Nested exchange route is not implemented.");
    }
    if (retainedNests && !args.nests?.length) {
      // Signature-only retries reopen the durable evidence; fresh parsed children stay hydrated.
      nests = loadNests(this.hby.db, said);
    }
    const mailboxAid = args.mailboxAid ?? previous?.mailboxAid ?? null;
    if (approved && handler?.verify) {
      const verification = handler.verify!({
        serder: args.serder,
        attachments,
        essrs,
        nests,
        mailboxAid,
        receiverTime,
        ...(handler.acceptsSscs && approved.sscs.length ? { sscs: approved.sscs } : {}),
        ...(handler.acceptsEvidence ? { evidence: approved.supplemental } : {}),
      });
      const verified = typeof verification === "object" && Symbol.iterator in verification
        ? yield* verification
        : verification;
      if (verified === false) return reject(`Exchange route ${args.serder.route ?? ""} failed handler verification.`);
      if (typeof verified === "object") {
        pending = { ...verified, said };
        missingSchema = verified.schema;
        if (missingSchema !== undefined && new Diger({ qb64: missingSchema }).qb64 !== missingSchema) {
          throw new ValidationError("Route missing-schema dependency must be a complete SAID.");
        }
        needsProof = missingSchema === undefined;
      }
    }
    // An already accepted exchange cannot be downgraded by an incomplete duplicate.
    if (pending && this.complete(said)) {
      return pending;
    }
    if (args.nests?.length) {
      nestStage = crypto.randomUUID();
      yield* abortable((signal) => stageNests(this.hby.db, nestStage!, nests, signal));
    }
    /** Publish ordinary evidence and private provenance in the archive transaction. */
    const commit = () => {
      if (storedReceiverTime(this.hby.db.exchangeMeta.get([said])) !== priorReceipt) {
        throw new Error("Exchange receiver receipt changed during admission");
      }
      if (nestStage) publishNests(this.hby.db, said, nestStage);
      if (!pending && approved) {
        this.clearEscrow(said, true);
        this.logAcceptedEvent({
          serder: args.serder,
          ...approved.retained,
          supplemental: approved.supplemental,
          ptds: args.ptds ?? [],
        });
      } else {
        newEscrow = missingSchema === undefined
          ? this.escrowPartialSigned(args.serder, retainedFactors, args.ptds ?? [])
          : this.escrowMissingSchema(args.serder, missingSchema, retainedFactors, args.ptds ?? []);
      }
      if (essrs && !retained) {
        this.hby.db.essrs.rem([said]);
        for (const texter of essrs) {
          this.hby.db.essrs.add([said], texter);
        }
      }
      this.hby.db.exchangeMeta.pin([said], {
        mailboxAid,
        ...(receiverTime !== undefined ? { receiverTime } : {}),
        ...((existing ?? essrs)
          ? {
            essr: {
              gvrsn: previous?.essr?.gvrsn ?? args.gvrsn ?? args.serder.gvrsn ?? args.serder.pvrsn,
            },
          }
          : {}),
      });
    };
    let stored = existing ?? essrs;
    if (essrs && !existing) {
      const wire = essrs;
      stored = yield* abortable(async (signal) => {
        await (await this.hby.db.openPayloads(signal)).publish(`essr/${said}`, essrWire(wire), commit, signal);
        return (await this.hby.db.getEssrs(said, signal))!;
      });
    } else {
      yield* abortable(async (signal) => {
        signal.throwIfAborted();
        this.hby.db.env!.transactionSync(commit);
        await this.hby.db.env!.flushed;
      });
    }
    if (pending) {
      if (newEscrow) {
        if (senderQuery) this.cueMissingStates([senderQuery]);
        if (needsProof) this.cues.push({ kin: "proof", said });
        if (missingSchema) this.cues.push({ kin: "query", q: { r: "schema", said: missingSchema } });
      }
      return pending;
    }
    if (handler) {
      yield* call(() =>
        handler.handle({
          serder: args.serder,
          attachments,
          essrs: stored ?? undefined,
          nests,
          mailboxAid,
          receiverTime,
          ...(handler.acceptsSscs && approved?.sscs.length ? { sscs: approved.sscs } : {}),
        })
      );
    }
    return { kind: "accept", said };
  }

  /** Retry escrows using their persisted payload references and mailbox provenance. */
  processEscrows(): Operation<void> {
    return call(() => this.retryEscrows());
  }
  /** Retry each bounded escrow inside one structured child scope. */
  private *retryEscrows(): Operation<void> {
    if (this.processing) throw new ValidationError("Exchanger has an active admission.");
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
      if (!serder || serder.said !== said || keys.length !== (schema ? 2 : 1)) {
        throw new Error("Corrupt exchange escrow key or body.");
      }
      if (schema && new Diger({ qb64: keys[1] }).qb64 !== keys[1]) throw new Error("Corrupt schema escrow dependency.");
      if (this.complete(said)) {
        yield* call(() => this.dropEscrow(said));
        continue;
      }
      const deadline = this.hby.db.emsd?.get([said]);
      const absolute = deadline && timestampMicros(deadline.dts);
      if (deadline && absolute === null) throw new Error("Corrupt missing-schema deadline.");
      const dater = schema ? deadline : this.hby.db.epsd.get([said]);
      const date = dater && timestampMicros(dater.dts);
      if (date === null || date === undefined) {
        if (schema) throw new Error("Corrupt missing-schema deadline.");
        yield* call(() => this.dropEscrow(said));
        consoleLogger.warn("Exchanger ejected exchange escrow", {
          family: "epse",
          said,
          pre: serder.pre,
          route: serder.route,
          reason: "missingTimestamp",
          detail: "Pending exchange has no valid admission timestamp.",
        });
        continue;
      }
      const now = this.nowMicros();
      if (
        now > date + (schema ? 0n : BigInt(EXCHANGE_ESCROW_TIMEOUT_MS) * 1000n)
        || absolute !== null && absolute !== undefined && now > absolute
      ) {
        yield* call(() => this.dropEscrow(said));
        consoleLogger.warn("Exchanger ejected exchange escrow", {
          family: schema ? "emse" : "epse",
          said,
          pre: serder.pre,
          route: serder.route,
          reason: "expired",
          detail: "Exchange dependency exceeded its pending lifetime or absolute schema deadline.",
        });
        continue;
      }
      const decision = yield* this.processEvent({
        serder,
        tsgs: this.rebuildEscrowedGroups(said),
        cigars: this.storedCigars(said),
        sourceSeals: this.storedSeals(said),
        ptds: this.hby.db.epath.get([said]).map((text) => PathedMaterialGroup.fromRaw(new TextEncoder().encode(text))),
        mailboxAid: this.hby.db.exchangeMeta.get([said])?.mailboxAid,
      });
      if (decision.kind === "reject" && !decision.preserveEscrow) {
        yield* call(() => this.dropEscrow(said));
        consoleLogger.warn("Exchanger ejected exchange escrow", {
          family: schema ? "emse" : "epse",
          said,
          pre: serder.pre,
          route: serder.route,
          reason: decision.reason,
          cause: decision.cause,
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
  private *authenticate(
    serder: SerderKERI,
    resolved: ResolvedExchangeFactors,
    handler?: ExchangeRouteHandler,
  ): Operation<
    | AuthenticatedExchange
    | (
      & Exclude<ExchangeDecision, { kind: "accept" }>
      & { query?: MissingExchangeState }
    )
  > {
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
      const selected = selection && Symbol.iterator in selection ? yield* selection : selection;
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
  /** Match _cueMissingKeyState's coordinate deduplication within this invocation. */
  private cueMissingStates(missing: readonly MissingExchangeState[]): void {
    const seen = new Set<string>();
    for (const { pre, sn } of missing) {
      const key = `${pre}:${sn ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      this.cues.push({
        kin: "query",
        pre,
        route: "logs",
        q: sn === null ? {} : { s: sn.toString(16) },
      });
    }
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
    this.hby.db.epse.rem([said]);
    this.hby.db.epsd.rem([said]);
    this.hby.db.emse?.trim([said]);
    this.hby.db.emsd?.rem([said]);
    this.hby.db.esigs.trim([said, ""], { topive: false });
    this.hby.db.ecigs.rem([said]);
    this.hby.db.ests.trim([said, ""], { topive: false });
    this.hby.db.epath.rem([said]);
    if (!keepEvidence) {
      this.hby.db.essrs.rem([said]);
      this.hby.db.enst.rem([said]);
      this.hby.db.exchangeMeta.rem([said]);
    }
  }
  /** Remove pending ownership only; accepted wire evidence always remains retained. */
  private *dropEscrow(said: string): Operation<void> {
    yield* this.admission();
    if (this.complete(said)) {
      this.hby.db.epse.rem([said]);
      this.hby.db.epsd.rem([said]);
      this.hby.db.emse?.trim([said]);
      this.hby.db.emsd?.rem([said]);
      return;
    }
    if (this.hby.db.exchangeMeta.get([said])?.essr) {
      yield* abortable(async (signal) => {
        await (await this.hby.db.openPayloads(signal)).remove(`essr/${said}`, () => this.clearEscrow(said), signal);
      });
    } else this.hby.db.env!.transactionSync(() => this.clearEscrow(said));
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
