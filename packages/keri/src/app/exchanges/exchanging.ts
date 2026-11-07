import {
  type AttachmentGroup,
  b,
  bytesEqual,
  type CesrFrame,
  Cigar,
  Counter,
  Dater,
  DeserializeError,
  Diger,
  essrChunks,
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
import { call, type Operation } from "npm:effection@^3.6.0";
import { resolveAttachmentGvrsn } from "../../core/attachment-countering.ts";
import type { AgentCue } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import { PathedMaterialGroup, TransIdxSigGroup, type TransLastIdxSigGroup } from "../../core/dispatch.ts";
import { ValidationError } from "../../core/errors.ts";
import {
  type ExchangeFactors,
  type MissingExchangeState,
  verifyExchangeProofs,
} from "../../core/exchange/exchange-proofing.ts";
import { nestedIpexRoute, supportsNestedExchange } from "../../core/exchange/protocol-exchanging.ts";
import { Kever } from "../../core/kel/kever.ts";
import { consoleLogger } from "../../core/logger.ts";
import { messageAttachmentGroups, serializeMessage } from "../../core/protocol-serialization.ts";
import { hasNests, loadNests, prepareNests, publishNests } from "../../db/exchange/exchange-nests.ts";
import type { ExchangeRegistryStateShape } from "../../db/exchange/exchange-records.ts";
import { encodeDateTimeToDater, makeNowIso8601, timestampMicros } from "../../time/mod.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { groupMemberHasKey } from "../multisig/group-members.ts";
import { abortable } from "../runtime/abortable.ts";

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
export type ExchangeRouteVerification =
  | boolean
  | { kind: "accept"; registryStates: readonly (readonly [node: string, record: ExchangeRegistryStateShape])[] }
  | { kind: "escrow"; reason: string; schema?: string };

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
/** Exact disclosed node SAIDs authorized for each issuer registry in a live Grant. */
export type PresentationScope = ReadonlyMap<string, readonly string[]>;

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
    /** Read-only retained inspection may select exact issuer prefixes from its carried openings. */
    historical?: boolean;
  }): ExchangeRouteVerification;
  /** Read fresh issuance registry scope after shared context checks; Exchanger authenticates the sender first. */
  pendingGrant?(args: Parameters<NonNullable<ExchangeRouteHandler["verify"]>>[0]): readonly string[] | null;
  /** Read auxiliary presentation scope after Exchanger authenticates the exact retained sender evidence. */
  presentationContext?(args: Parameters<NonNullable<ExchangeRouteHandler["verify"]>>[0]): PresentationScope | null;
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
  /**
   * Retry this route's own escrow of accepted exchanges awaiting later local
   * work (for example `RegistryRoot`). The Exchanger calls it after its own
   * escrows, as KERIpy `Exchanger.processEscrow` does for handlers that define it.
   */
  processEscrows?(): void;
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
  /** Incoming qualified fragments; persistence uses main's insertion-ordered set. */
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
/** Concrete evidence passed to the synchronous admission turn. */
interface PreparedExchangeEvidence {
  attachments: ExchangeAttachment[];
  nests?: readonly Uint8Array[];
}

/** Decision and committed follow-up data; asynchronous handlers execute outside the writer. */
interface ExchangeAdmission {
  decision: ExchangeDecision;
  cues: AgentCue[];
  handling?: Parameters<ExchangeRouteHandler["handle"]>[0];
  ejection?: EscrowEjection;
}

/** Diagnostic fact emitted only after committed escrow removal. */
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
 * Refuse every exchange on one route so nothing about it is persisted.
 *
 * Ports KERIpy `exchanging.RouteRefuser`. A role that must never accept a
 * route (a service or verifier offered `/registry/root`) registers this
 * instead of leaving the route unhandled: an unhandled route is still
 * authenticated, stored in `exns`/`essrs` and never revisited, while `verify`
 * returning false here makes the Exchanger reject it before any write. It is
 * unversioned, so it refuses every protocol major of the route. Sender
 * authentication and its partial-signature escrow still run first, as for any
 * route.
 */
export class RouteRefuser implements ExchangeRouteHandler {
  readonly resource: string;

  constructor(resource: string) {
    this.resource = resource;
  }

  /** Log the refusal and reject the exchange. */
  verify(args: { serder: SerderKERI }): boolean {
    consoleLogger.info("Exchange route refused by local policy", {
      route: this.resource,
      said: args.serder.said,
      sender: args.serder.pre,
    });
    return false;
  }

  /** Unreachable: a refused exchange is never dispatched. */
  handle(): void {}
}

/**
 * Peer-to-peer XIP/EXN processor for one `Habery`.
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
 *
 * Admission prepares actual nested evidence before entering a synchronous LMDB
 * writer, then re-reads retry state and authenticates/persists against that current
 * view. Accepted and pending EXNs share ordinary Baser evidence tables, including
 * main's `essrs.` Texter set. There is no external payload authority to publish
 * or reclaim. Join the LMDB flush before exposing cues or invoking asynchronous
 * handlers; a handler failure does not roll back an already accepted EXN.
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

  /** Resolve the configured body-version route owner without dispatching or changing evidence. */
  handlerFor(serder: SerderKERI): ExchangeRouteHandler | undefined {
    const route = serder.route ?? "";
    return this.versionedRoutes.get(route)?.get(serder.pvrsn.major) ?? this.routes.get(route);
  }

  /**
   * Verify, persist, and dispatch one inbound `exn`.
   *
   * Accepted messages are durably logged before any route-specific side
   * effects run so later reopen and verification paths can reuse the same
   * stored evidence.
   * Returning a reject/escrow decision describes this attempt, not necessarily
   * the absence of an earlier accepted copy; complete(said) checks durable
   * acceptance. Infrastructure and handler errors remain exceptions, so callers
   * must not interpret every thrown error as a remote protocol rejection.
   */
  processEvent(args: ExchangeInput): Operation<ExchangeDecision> {
    return call(function*(this: Exchanger) {
      const attempt = yield* this.admit(args);
      if (!attempt) throw new Error("A direct exchange input cannot become an obsolete escrow retry");
      return attempt.decision;
    }.bind(this));
  }

  /** Complete only a still-live pending Grant with added proof; serialization cannot extend its original lifetime. */
  acceptPendingGrantProof(args: ExchangeInput): Operation<ExchangeDecision> {
    return call(function*(this: Exchanger) {
      const attempt = yield* this.admit(args, false, "proof");
      if (!attempt) throw new Error("A selected pending Grant proof cannot become an obsolete escrow retry");
      return attempt.decision;
    }.bind(this));
  }
  /** Add authentication to a live prepared Grant without replacing its exact disclosure or renewing its deadline. */
  acceptPreparedGrantContribution(args: ExchangeInput): Operation<ExchangeDecision> {
    return call(function*(this: Exchanger) {
      const attempt = yield* this.admit(args, false, "contribution");
      if (!attempt) throw new Error("A selected prepared Grant contribution cannot become an obsolete escrow retry");
      return attempt.decision;
    }.bind(this));
  }
  /**
   * Prepare nested serialization outside the writer, then decide and persist in
   * one uninterrupted transaction. A retry re-reads current escrow evidence in
   * that writer: work may have accepted/expired while preparation suspended.
   * Flush committed storage before publishing cues and awaiting the route handler.
   * The caller must keep the Baser open through all these completion boundaries.
   */
  private *admit(
    args: ExchangeInput,
    retry = false,
    selectedGrant?: "proof" | "contribution",
  ): Operation<ExchangeAttempt | undefined> {
    const said = args.serder.said ?? "<unknown>";
    const reject = (reason: string): ExchangeAdmission => ({ decision: { kind: "reject", said, reason }, cues: [] });
    if (this.hby.db.inWriteTransaction) throw new Error("Exchanger must own the admission transaction");
    if (args.serder.ilk !== "exn" && args.serder.ilk !== "xip") {
      return reject(`Unsupported exchange ilk ${args.serder.ilk}.`);
    }
    if (!args.serder.pre || !args.serder.said) return reject("Exchange message is missing sender or SAID.");
    if (args.receiverTime !== undefined && timestampMicros(args.receiverTime) === null) {
      throw new Error("Invalid exchange receiver time");
    }
    const route = args.serder.route ?? "";
    const handler = this.handlerFor(args.serder);
    // Freeze implied last-establishment coordinates at receipt, not after child serialization.
    const resolved = this.resolveProofs(args);
    const nests = args.nests?.length
      ? yield* abortable((signal) => prepareNests(args.nests!, signal))
      : undefined;
    const result = this.hby.db.env!.transactionSync((): ExchangeAdmission | undefined => {
      if (selectedGrant) {
        const db = this.hby.db;
        const stored = selectedGrant === "proof" ? db.epse.get([said]) : db.exns.get([said]) ?? db.epse.get([said]);
        const deadline = stored && this.exchangeDeadline(stored);
        const expiry = deadline ? timestampMicros(deadline) : null;
        const live = stored && this.isV2Grant(stored) && !db.erpy.get([said])
          && expiry !== null && this.nowMicros() < expiry;
        const original = !live ? null : selectedGrant === "proof"
          ? this.retainedInput(said, { pending: true })
          : { serder: stored, nests: loadNests(db, said) };
        const before = original?.nests ?? [], after = args.nests ?? [];
        if (
          !original || !bytesEqual(original.serder.raw, args.serder.raw) || before.length !== after.length
          || before.some((node, index) => !bytesEqual(node.body.raw, after[index].body.raw))
        ) return reject("Selected pending Grant proof is expired, terminated or changes the original disclosure");
        if (selectedGrant === "contribution") {
          const retained = db.enst.get([said]);
          if (retained.length !== nests?.length || retained.some((raw, index) => !bytesEqual(b(raw), nests![index]))) {
            return reject("Prepared Grant contribution changes the original nested evidence");
          }
        }
      }
      let status: EscrowStatus | undefined;
      if (retry) {
        status = this.escrowStatus(said);
        if (status.kind === "accepted") {
          this.clearPending(args.serder);
          return undefined;
        }
        if (status.kind === "absent") return undefined;
        if (status.kind !== "pending") {
          return {
            ...reject(status.kind),
            ejection: this.retireCurrent(args.serder, this.expiryReport(status)),
          };
        }
      }
      const current = retry ? this.escrowInput(args.serder) : args;
      const failure = this.verifyEssr(current.serder, current.essrs);
      const admission = failure
        ? { decision: failure, cues: [] }
        : this.admitCurrent(current, retry ? this.resolveProofs(current) : resolved, handler, {
          attachments: normalizeAttachments(current.ptds ?? []),
          nests,
        }, selectedGrant === "contribution");
      if (status?.kind === "pending" && admission.decision.kind === "reject" && !admission.decision.preserveEscrow) {
        return {
          ...admission,
          ejection: this.retireCurrent(args.serder, {
            family: status.family,
            reason: admission.decision.reason,
            cause: admission.decision.cause,
          }),
        };
      }
      return admission;
    });
    // Durable completion joins the actual LMDB flush; no external file lifetime remains.
    yield* abortable(async () => {
      await this.hby.db.env!.flushed;
    });
    if (!result) return undefined;
    for (const cue of result.cues) this.cues.push(cue);
    if (result.handling && handler) yield* call(() => handler.handle(result.handling!));
    return { decision: result.decision, ejection: result.ejection };
  }

  /**
   * Check the signed commitment over this attempt's raw fragment concatenation
   * before persistence. On retry these inputs come from retained set members.
   * Match main's separation: valid incoming bytes need not remain reconstructable
   * after equal Texters deduplicate or alternate fragmentations accumulate.
   * Do not normalize parser input or weaken digest verification to conceal that
   * known persistence limitation. Malformed remote CESR yields reject; storage,
   * hashing and other infrastructure errors propagate.
   */
  private verifyEssr(
    serder: SerderKERI,
    fragments: readonly Texter[] | undefined,
  ): Extract<ExchangeDecision, { kind: "reject" }> | undefined {
    if (typeof serder.a !== "string") return undefined;
    const said = serder.said!;
    try {
      const diger = new Diger({ qb64: serder.a });
      if (!fragments || !diger.verifyChunks(fragments.map((texter) => texter.raw))) {
        return { kind: "reject", said, reason: "Exchange ESSR payload digest does not match its signed commitment." };
      }
    } catch (cause) {
      if (!malformedEssr(cause)) throw cause;
      return {
        kind: "reject",
        said,
        reason: `Invalid exchange ESSR payload: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      };
    }
  }

  /** Authenticate, validate route policy and write evidence in one uninterrupted owner turn. */
  private admitCurrent(
    args: ExchangeInput,
    resolved: ResolvedExchangeFactors,
    handler: ExchangeRouteHandler | undefined,
    prepared: PreparedExchangeEvidence,
    preparedContribution = false,
  ): ExchangeAdmission {
    const said = args.serder.said!;
    const authentication = this.authenticate(args.serder, resolved, handler, this.cues);
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
    let registryStates: Extract<ExchangeRouteVerification, { kind: "accept" }>["registryStates"] = [];
    let missingSchema: string | undefined;
    let needsProof = false;
    const handling = {
      serder: args.serder,
      attachments: prepared.attachments,
      essrs: args.essrs,
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
      if (typeof verified === "object" && verified.kind === "accept") registryStates = verified.registryStates;
      if (typeof verified === "object" && verified.kind === "escrow") {
        pending = { ...verified, said };
        missingSchema = verified.schema;
        if (missingSchema !== undefined && new Diger({ qb64: missingSchema }).qb64 !== missingSchema) {
          throw new ValidationError("Route missing-schema dependency must be a complete SAID.");
        }
        needsProof = missingSchema === undefined;
      }
    }
    if (pending && this.complete(said)) {
      // The exact prepared-file writer may retain verified added consent while
      // current issuer openings remain unresolved; accepted proof rows stay untouched.
      if (preparedContribution && approved) {
        this.logAcceptedEvent({
          serder: args.serder,
          ...approved.retained,
          supplemental: approved.supplemental,
          ptds: args.ptds ?? [],
        });
      }
      return { decision: pending, cues };
    }
    const retainedIpex = args.serder.pvrsn.major === 2 && nestedIpexRoute(args.serder.route ?? "")
      && this.complete(said);
    if (prepared.nests && !retainedIpex) publishNests(this.hby.db, said, prepared.nests);
    let newEscrow = false;
    if (!pending && approved) {
      this.clearEscrow(args.serder, true);
      for (const [node, record] of registryStates) this.hby.db.exrs.pin([said, node], record);
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
    // False means an existing qualified member, not a failed write. Exceptions abort the writer.
    for (const texter of args.essrs ?? []) this.hby.db.essrs.add([said], texter);
    this.hby.db.exchangeMeta.pin([said], {
      mailboxAid,
      ...(receiverTime !== undefined ? { receiverTime } : {}),
      gvrsn: previous?.gvrsn ?? args.gvrsn ?? args.serder.gvrsn ?? args.serder.pvrsn,
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

  /** Retry escrows using ordinary LMDB evidence and retained mailbox provenance. */
  processEscrows(): Operation<void> {
    return call(() => this.retryEscrows());
  }
  /** Retry each bounded escrow inside one structured child scope, then each opted-in route handler's own escrow. */
  private *retryEscrows(): Operation<void> {
    if (this.hby.db.inWriteTransaction) throw new Error("Exchanger must own escrow transactions");
    yield* this.retryEscrowType(false);
    if (this.hby.db.emse) yield* this.retryEscrowType(true);
    const versioned = [...this.versionedRoutes.values()].flatMap(versions => [...versions.values()]);
    for (const handler of new Set([...this.routes.values(), ...versioned])) handler.processEscrows?.();
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
      if (
        !serder || (serder.ilk !== "exn" && serder.ilk !== "xip") || !serder.pre || serder.said !== said
        || keys.length !== (schema ? 2 : 1)
      ) {
        throw new Error("Corrupt exchange escrow key or body.");
      }
      if (schema && new Diger({ qb64: keys[1] }).qb64 !== keys[1]) throw new Error("Corrupt schema escrow dependency.");
      const expired = yield* call(() => this.expirePending(serder));
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
  /**
   * Reconstruct accepted signed wire from ordinary Baser evidence, preserving
   * attachment genus independently of the signed body's protocol version.
   * Revalidate stored sender proofs, then encode retained pathed/nested/ESSR
   * material. ESSR set members follow stored order, which can differ from the
   * originally committed sequence under the documented set limitation; receiving
   * protocol/recipient processing remains responsible for its digest check.
   *
   * @param said Accepted outer EXN SAID; escrow-only evidence cannot be replayed here.
   * @param signal Optional caller cancellation between reconstruction/output steps.
   * @yields Ordinary owned wire chunks; no archive handle or plaintext is created.
   * @throws Missing acceptance, invalid retained authentication and genuine
   * storage/encoding failures remain visible to the consumer.
   */
  async *replay(said: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    signal?.throwIfAborted();
    const serder = this.hby.db.exns.get([said]);
    if (!serder) throw new ValidationError("Cannot replay an unaccepted exchange.");
    const args = this.retainedInput(said);
    if (!args) throw new ValidationError("Invalid stored exchange authentication or evidence.");
    const essrs = args.essrs;
    signal?.throwIfAborted();
    const gvrsn = resolveAttachmentGvrsn(serder, this.hby.db.exchangeMeta.get([said])?.gvrsn);
    // epath retains complete groups; serialization supplies the destination
    // genus's counter and therefore consumes only the path-and-proof payload.
    const evidence = {
      tsgs: args.tsgs,
      cigars: args.cigars,
      sourceSeals: args.sourceSeals,
      pathed: (args.ptds ?? []).map((group) =>
        group.raw.slice(new Counter({ qb64b: group.raw, version: gvrsn }).fullSize)
      ),
    };
    const nested = hasNests(this.hby.db, said);
    {
      const groups = nested ? messageAttachmentGroups(evidence, gvrsn) : [];
      const nests = nested ? [...args.nests ?? []] : [];
      if (nests.length) {
        // Reuse the stored Serder and hydrated endorsements; the shared encoder builds real leaf groups.
        const parent: CesrFrame = {
          body: serder,
          attachments: groups,
          gvrsn,
          nests,
          essrs: essrs ? [...essrs] : undefined,
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

  /** Original accepted KRAM lifetime; partial-escrow timestamps never authorize live auxiliary work. */
  exchangeDeadline(serder: SerderKERI): string | null {
    const said = serder.said, sender = serder.pre;
    const xid = serder.ilk === "xip" ? said : serder.sad?.x;
    if (!said || !sender || typeof xid !== "string" || !xid) return null;
    const cache = this.hby.db.tmsc.get([sender, xid, said]);
    if (!cache?.rdt) return null;
    const opener = timestampMicros(cache.xdt);
    if (timestampMicros(cache.rdt) === null || opener === null || !Number.isSafeInteger(cache.xl) || cache.xl! < 0) {
      throw new Error("Corrupt accepted exchange transaction lifetime.");
    }
    return this.deadlineDater(opener + BigInt(cache.xl!) * 1000n).dts;
  }

  /**
   * Rehydrate authenticated retained factors without route handling or writes.
   * Pending-only access also enforces the original deadline with this owner's
   * clock and refuses terminal responses. It does not require fresh RIP state:
   * an approved issuance may need these exact factors after its BUP arrives.
   */
  retainedInput(said: string, { pending = false }: { pending?: boolean } = {}): ExchangeInput | null {
    const db = this.hby.db;
    const serder = pending ? db.epse.get([said]) : db.exns.get([said]) ?? db.epse.get([said]);
    if (!serder || serder.said !== said || !serder.verify()) return null;
    if (pending) {
      const deadline = this.exchangeDeadline(serder);
      if (!deadline || this.complete(said) || db.erpy.get([said])) return null;
      const expiry = timestampMicros(deadline);
      if (expiry === null) throw new Error("Corrupt accepted exchange deadline.");
      if (this.nowMicros() >= expiry) return null;
    }
    const args = this.escrowInput(serder);
    const verified = verifyExchangeProofs(db, serder, args);
    if (
      verified.invalid || verified.missing.length || !(verified.tsgs.some((group) => group.pre === serder.pre)
        || verified.cigars.some((cigar) => cigar.verfer?.qb64 === serder.pre)
        || verified.sourceSeals.some((seal) => seal.i.qb64 === serder.pre))
    ) return null;
    return {
      ...args,
      tsgs: verified.tsgs,
      cigars: verified.cigars,
      sourceSeals: verified.sourceSeals,
      nests: loadNests(db, said),
    };
  }

  /**
   * Reauthenticate one accepted body and its exact retained view through its
   * registered route. No queries, writes, handling or notices occur. Historical
   * mode proves retained issuer prefixes, not current standing, graph policy or
   * consent; the default continues to require current issuer history.
   */
  verifyAccepted(said: string, route: string, { historical = false }: { historical?: boolean } = {}): boolean {
    const serder = this.hby.db.exns.get([said]);
    if (!serder || serder.route !== route || !serder.verify()) return false;
    const handler = this.handlerFor(serder);
    if (!handler?.verify) return false;
    const args = this.escrowInput(serder);
    if (this.verifyEssr(serder, args.essrs)) return false;
    const approved = this.authenticate(serder, this.resolveProofs(args), handler, new Deck<AgentCue>());
    if (approved.kind !== "verified") return false;
    const meta = this.hby.db.exchangeMeta.get([said]);
    const verified = handler.verify({
      serder,
      attachments: normalizeAttachments(args.ptds ?? []),
      essrs: args.essrs,
      nests: loadNests(this.hby.db, said),
      mailboxAid: meta?.mailboxAid,
      receiverTime: storedReceiverTime(meta),
      historical,
      ...(handler.acceptsSscs ? { sscs: approved.sscs } : {}),
      ...(handler.acceptsEvidence ? { evidence: approved.supplemental } : {}),
    });
    return verified === true || (typeof verified === "object" && verified.kind === "accept");
  }

  /**
   * Reverify replacement proofs for one live accepted Grant through its ordinary
   * route. Bodies and order stay exact; this returns current observations without
   * writes, handling or new consent. The Unblind owner publishes inside its own
   * synchronous transaction after comparing the retained evidence snapshot.
   */
  verifyGrantProofs(said: string, nests: readonly CesrFrame[]): ExchangeRouteVerification {
    const serder = this.hby.db.exns.get([said]);
    if (!serder || !this.isV2Grant(serder)) return false;
    const xid = serder.ilk === "xip" ? said : serder.sad!.x, recipient = serder.sad!.ri;
    if (typeof xid !== "string" || typeof recipient !== "string" || !serder.pre) return false;
    const context = this.presentationContext(said, { xid, sender: serder.pre, recipient });
    if (
      !context || nests.length !== context.nests.length
      || nests.some((nest, index) => !bytesEqual(nest.body.raw, context.nests[index].body.raw))
    ) return false;
    const handler = this.handlerFor(serder);
    if (!handler?.verify) return false;
    const args = this.escrowInput(serder);
    const approved = this.authenticate(serder, this.resolveProofs(args), handler, new Deck<AgentCue>());
    if (approved.kind !== "verified") return false;
    const meta = this.hby.db.exchangeMeta.get([said]);
    return handler.verify({
      serder,
      attachments: normalizeAttachments(args.ptds ?? []),
      essrs: args.essrs,
      nests,
      mailboxAid: meta?.mailboxAid,
      receiverTime: storedReceiverTime(meta),
      ...(handler.acceptsSscs ? { sscs: approved.sscs } : {}),
      ...(handler.acceptsEvidence ? { evidence: approved.supplemental } : {}),
    });
  }

  /**
   * Read one selected live pending issuance Grant and its exact registry scope.
   * Escrow presence grants no authority: reauthenticate retained sender factors,
   * then reuse the v2 route's context checks. This changes no stores or cues
   * and never accepts the Grant. Auxiliary authority expires at deadline equality.
   */
  pendingGrant(
    said: string,
    { xid, sender, recipient }: { xid: string; sender: string; recipient: string },
  ): { serder: SerderKERI; registries: readonly string[] } | null {
    const serder = this.hby.db.epse.get([said]);
    const deadline = serder && this.exchangeDeadline(serder);
    if (
      !serder || !deadline || serder.said !== said || !serder.verify() || !this.isV2Grant(serder)
      || serder.pre !== sender || serder.sad!.ri !== recipient
      || (serder.ilk === "xip" ? said : serder.sad!.x) !== xid
      || this.complete(said) || this.hby.db.erpy.get([said])
    ) return null;
    const expiry = timestampMicros(deadline);
    if (expiry === null) throw new Error("Corrupt accepted exchange deadline.");
    if (this.nowMicros() >= expiry) return null;
    const handler = this.handlerFor(serder);
    if (handler?.protocolMajor !== 2 || !handler.pendingGrant) return null;
    const args = this.escrowInput(serder);
    if (this.verifyEssr(serder, args.essrs)) return null;
    const approved = this.authenticate(serder, this.resolveProofs(args), handler, new Deck<AgentCue>());
    if (approved.kind !== "verified") return null;
    const meta = this.hby.db.exchangeMeta.get([said]);
    const registries = handler.pendingGrant({
      serder,
      attachments: normalizeAttachments(args.ptds ?? []),
      essrs: args.essrs,
      nests: loadNests(this.hby.db, said),
      mailboxAid: meta?.mailboxAid,
      receiverTime: storedReceiverTime(meta),
      ...(handler.acceptsSscs ? { sscs: approved.sscs } : {}),
      ...(handler.acceptsEvidence ? { evidence: approved.supplemental } : {}),
    });
    return registries?.length ? { serder, registries } : null;
  }

  /**
   * Reauthenticate a live accepted or pending Grant and its exact retained disclosure.
   * Scope is per registry, not permission to use every disclosed node or Admit.
   * The original deadline and terminal response bound authority; inspection never
   * writes, renews lifetime, emits cues or hydrates a fuller credential view.
   */
  presentationContext(
    said: string,
    { xid, sender, recipient }: { xid: string; sender: string; recipient: string },
  ): { serder: SerderKERI; nests: readonly CesrFrame[]; registries: PresentationScope } | null {
    const serder = this.hby.db.exns.get([said]) ?? this.hby.db.epse.get([said]);
    const deadline = serder && this.exchangeDeadline(serder);
    if (
      !serder || !deadline || serder.said !== said || !serder.verify() || !this.isV2Grant(serder)
      || serder.pre !== sender || serder.sad!.ri !== recipient
      || (serder.ilk === "xip" ? said : serder.sad!.x) !== xid
      || this.hby.db.erpy.get([said])
    ) return null;
    const expiry = timestampMicros(deadline);
    if (expiry === null) throw new Error("Corrupt accepted exchange deadline.");
    if (this.nowMicros() >= expiry) return null;
    const handler = this.handlerFor(serder);
    if (handler?.protocolMajor !== 2 || !handler.presentationContext) return null;
    const args = this.escrowInput(serder);
    if (this.verifyEssr(serder, args.essrs)) return null;
    const approved = this.authenticate(serder, this.resolveProofs(args), handler, new Deck<AgentCue>());
    if (approved.kind !== "verified") return null;
    const meta = this.hby.db.exchangeMeta.get([said]);
    const nests = loadNests(this.hby.db, said);
    const registries = handler.presentationContext({
      serder,
      attachments: normalizeAttachments(args.ptds ?? []),
      essrs: args.essrs,
      nests,
      mailboxAid: meta?.mailboxAid,
      receiverTime: storedReceiverTime(meta),
      ...(handler.acceptsSscs ? { sscs: approved.sscs } : {}),
      ...(handler.acceptsEvidence ? { evidence: approved.supplemental } : {}),
    });
    return registries?.size ? { serder, nests, registries } : null;
  }

  /**
   * Elect the lowest verified index in the first authenticated sender proof group.
   *
   * Like KERIpy, choose one stored establishment group deterministically. Require
   * an accepted exchange, or explicitly opt into a live pending presentation,
   * before reverifying sender proofs against accepted historical establishment state.
   * Resolve the winning key at that proof's accepted establishment, not the current
   * group state. The local member's accepted KEL identifies its historical keys;
   * rotating that member must not transfer or erase an existing approval's lead.
   * Partial signatures elect no sender. Election alone does not authorize sending
   * the selected disclosure; callers still approve its complete registry scope.
   */
  lead(hab: Hab, said: string, { pendingPresentation = false }: { pendingPresentation?: boolean } = {}): boolean {
    const record = this.hby.db.getHab(hab.pre);
    if (!record?.mid) return true;
    const db = this.hby.db;
    let serder = db.exns.get([said]);
    if (!serder && pendingPresentation) {
      const candidate = db.epse.get([said]);
      if (candidate?.pre === hab.pre && typeof candidate.sad?.ri === "string") {
        const xid = candidate.ilk === "xip" ? candidate.said : candidate.sad.x;
        if (
          typeof xid === "string" && this.presentationContext(said, {
            xid,
            sender: candidate.pre!,
            recipient: candidate.sad.ri,
          })
        ) serder = candidate;
      }
    }
    if (!serder || serder.pre !== hab.pre) return false;
    const verified = verifyExchangeProofs(db, serder, {
      tsgs: this.rebuildEscrowedGroups(said).filter(group => group.pre === hab.pre),
    });
    const proof = verified.tsgs[0];
    if (!proof) return false;
    let index = Infinity;
    for (const siger of proof.sigers) index = Math.min(index, siger.index);
    const establishment = db.getEvtSerder(hab.pre, proof.said);
    const leadKey = establishment?.verfers[index]?.qb64;
    if (!leadKey) return false;
    return groupMemberHasKey(db, record.mid, leadKey);
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
  /** Match sender-factor precedence; the caller supplies live admission or isolated inspection cues. */
  private authenticate(
    serder: SerderKERI,
    resolved: ResolvedExchangeFactors,
    handler: ExchangeRouteHandler | undefined,
    queries: Deck<AgentCue>,
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
    for (const cue of this.missingStateCues(resolved.missing)) queries.push(cue);
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
      for (const cue of this.missingStateCues(sealed.missing)) queries.push(cue);
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
      for (const cue of this.missingStateCues(missing)) queries.push(cue);
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

  /** Classify sender endorsements without publishing exchange evidence. */
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
    this.retainPartialDeadline(serder);
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
      const xid = serder.ilk === "xip" ? said : serder.sad!.x;
      const cache = typeof xid === "string" && xid ? this.hby.db.tmsc.get([serder.pre!, xid, said]) : null;
      const opener = cache && timestampMicros(cache.xdt);
      if (cache && (opener === null || opener === undefined || !Number.isSafeInteger(cache.pxl) || cache.pxl! < 0)) {
        throw new Error("Corrupt missing-schema transaction lifetime.");
      }
      const expiry = cache ? opener! + BigInt(cache.pxl!) * 1000n : this.nowMicros() + 20_000_000n;
      emsd.put([said], this.deadlineDater(expiry));
    }
    this.storeEscrowEvidence(serder, factors, ptds);
    this.hby.db.epse.rem([said]);
    this.hby.db.epsd.rem([said]);
    const stored = emse.get([said, schema]) === null;
    emse.trim([said]);
    emse.put([said, schema], serder);
    return stored;
  }
  /** V2 Grant validity survives dependency changes and acceptance; it is not cache retention. */
  private isV2Grant(serder: SerderKERI): boolean {
    return serder.pvrsn.major >= 2 && serder.route === "/ipex/grant";
  }

  /**
   * Bound PSE cleanup by the accepted v2 Grant lifetime (xdt + xl) once KRAM
   * records sender-threshold receipt; before that, freeze one local PSE timeout
   * that retransmission never extends. Mirrors KERIpy `_partialSignedDeadline`.
   */
  private retainPartialDeadline(serder: SerderKERI): void {
    const said = serder.said!, prior = this.hby.db.epsd.get([said]);
    if (prior && timestampMicros(prior.dts) === null) throw new Error("Corrupt exchange partial deadline.");
    const accepted = this.isV2Grant(serder) ? this.exchangeDeadline(serder) : null;
    if (accepted) {
      if (prior?.dts !== accepted) this.hby.db.epsd.pin([said], this.deadlineDater(timestampMicros(accepted)!));
      return;
    }
    if (prior) return;
    this.hby.db.epsd.put([said], this.deadlineDater(this.nowMicros() + BigInt(EXCHANGE_ESCROW_TIMEOUT_MS) * 1000n));
  }

  /** Preserve the original microsecond deadline without truncating its TMSC opener. */
  private deadlineDater(expiry: bigint): Dater {
    const remainder = (expiry % 1000n + 1000n) % 1000n;
    const text = makeNowIso8601(new Date(Number((expiry - remainder) / 1000n)))
      .replace(/\d{6}\+/, ((expiry % 1_000_000n + 1_000_000n) % 1_000_000n).toString().padStart(6, "0") + "+");
    if (timestampMicros(text) !== expiry) throw new Error("Exchange deadline exceeds supported date range.");
    return new Dater({ qb64: encodeDateTimeToDater(text) });
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
    const retainedIpex = args.serder.pvrsn.major === 2 && nestedIpexRoute(args.serder.route ?? "")
      && this.complete(said);
    if (!retainedIpex) {
      this.hby.db.epath.pin([said], args.ptds.map((group) => textDecoder.decode(group.raw)));
    }
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
  private clearEscrow(serder: SerderKERI, keepEvidence = false): void {
    const said = serder.said!;
    this.clearPending(serder);
    // First acceptance replaces provisional factors; accepted duplicates accumulate verified proofs.
    if (!keepEvidence || !this.complete(said)) {
      this.hby.db.esigs.trim([said, ""], { topive: false });
      this.hby.db.ecigs.rem([said]);
      this.hby.db.ests.trim([said, ""], { topive: false });
    }
    const accepted = keepEvidence ? this.hby.db.exns.get([said]) : null;
    const retainedIpex = accepted?.pvrsn.major === 2 && nestedIpexRoute(accepted.route ?? "");
    if (!retainedIpex) this.hby.db.epath.rem([said]);
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
      essrs: this.hby.db.getEssrs(said) ?? undefined,
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
    const partialDeadline = this.hby.db.epsd.get([said]);
    const partialExpiry = partialDeadline && timestampMicros(partialDeadline.dts);
    if (!partial && partialDeadline && partialExpiry === null) throw new Error("Corrupt exchange partial deadline.");
    const date = partial ? partialExpiry : absolute;
    if (date === null || date === undefined) {
      if (!partial) throw new Error("Corrupt missing-schema deadline.");
      return { kind: "missingTimestamp", family };
    }
    const now = this.nowMicros();
    if (
      now > date || partialExpiry !== null && partialExpiry !== undefined && now > partialExpiry
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

  /** Remove pending LMDB evidence inside its owning writer and return the committed diagnostic. */
  private retireCurrent(serder: SerderKERI, ejection: EscrowEjection): EscrowEjection {
    this.clearEscrow(serder);
    return ejection;
  }

  /** Decide expiry and remove pending rows in the same native transaction. */
  private *expirePending(serder: SerderKERI): Operation<EscrowEjection | undefined> {
    const said = serder.said!;
    const result = this.hby.db.env!.transactionSync(() => {
      const status = this.escrowStatus(said);
      if (status.kind === "accepted") {
        this.clearPending(serder);
        return undefined;
      }
      if (status.kind === "absent" || status.kind === "pending") return undefined;
      return this.retireCurrent(serder, this.expiryReport(status));
    });
    yield* abortable(async () => {
      await this.hby.db.env!.flushed;
    });
    return result;
  }

  /** Clear only dependency markers, keeping all accepted evidence and metadata intact. */
  private clearPending(serder: SerderKERI): void {
    const said = serder.said!;
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
