import {
  type AttachmentGroup,
  b,
  type CesrFrame,
  type Cigar,
  Dater,
  Diger,
  essrChunks,
  type EssrPayload,
  essrPayload,
  essrTexters,
  framePayload,
  Prefixer,
  Saider,
  Seqner,
  type SerderKERI,
  type Siger,
} from "cesr-ts";
import { call, type Operation, type Provide, resource } from "npm:effection@^3.6.0";
import { resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { PathedMaterialGroup, TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { Kever } from "../core/kever.ts";
import { exchange as exchangeMessage, nestedMultisigIlks } from "../core/protocol-exchanging.ts";
import { messageAttachmentGroups, serializeMessage } from "../core/protocol-serialization.ts";
import { Roles } from "../core/roles.ts";
import {
  chargeNests,
  discardNests,
  hasNests,
  loadNests,
  type NestBudget,
  publishNests,
  stageNests,
} from "../db/exchange-nests.ts";
import type { FilePayload } from "../db/payload-store.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import { abortable } from "./abortable.ts";
import { chunkBytes } from "./byte-source.ts";
import { postCesr } from "./cesr-egress.ts";
import type { Hab, Habery } from "./habbing.ts";

const textDecoder = new TextDecoder();
const EXCHANGE_ESCROW_TIMEOUT_MS = 10_000;

/** Delivery mode used when choosing a remote exchange transport endpoint. */
export type ExchangeTransport = "auto" | "direct" | "indirect";

/** Pathed attachment projection exposed to exchange-route handlers. */
export interface ExchangeAttachment {
  raw: Uint8Array;
  text: string;
}

/** Route-handler contract for accepted exchange messages. */
export interface ExchangeRouteHandler {
  readonly resource: string;
  /** Opt in only after route-specific child validation and durable replay are implemented. */
  readonly acceptsNests?: boolean;
  /** Validate route policy before publishing accepted evidence. */
  verify?(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    /** Borrowed payload views valid for this route invocation. */
    essr?: EssrPayload;
    /** Borrowed children, with evidence kept on its original message. */
    nests?: readonly CesrFrame[];
    /** Hosted endpoint provenance, distinct from the signed sender. */
    mailboxAid?: string | null;
  }): boolean | Operation<boolean>;
  /** Consume already durable evidence within the caller's Effection scope. */
  handle(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    /** Borrowed payload views valid for this route invocation. */
    essr?: EssrPayload;
    /** Borrowed children, with evidence kept on its original message. */
    nests?: readonly CesrFrame[];
    /** Hosted endpoint provenance, distinct from the signed sender. */
    mailboxAid?: string | null;
  }): void | Operation<void>;
}

/** One signed exchange and its bounded attachment views at runtime admission. */
export interface ExchangeInput {
  /** Signed exchange body, including any ESSR byte commitment. */
  serder: SerderKERI;
  /** Transferable sender endorsements. */
  tsgs?: readonly TransIdxSigGroup[];
  /** Nontransferable sender endorsements. */
  cigars?: readonly Cigar[];
  /** Ordinary bounded pathed attachments. */
  ptds?: readonly PathedMaterialGroup[];
  /** Caller-owned wire; successful publication transfers local file ownership. */
  essr?: EssrPayload;
  /** Parent-owned children; admission borrows and snapshots their original wire. */
  nests?: readonly CesrFrame[];
  /** Hosted endpoint provenance, retained across escrow. */
  mailboxAid?: string | null;
}

/** Result of one `Exchanger` processing attempt. */
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
  /** At most one active admission; the runtime owns bounded waiting and backpressure. */
  private processing = false;
  /** Finite decoded-byte limit, independent of total stream length. */
  private readonly maxEssrBytes: number;
  /** Finite token count, including empty Texters. */
  private readonly maxEssrItems: number;

  /** Bind route handlers and explicit per-message resource budgets to one habitat database. */
  constructor(
    hby: Habery,
    {
      handlers = [],
      cues,
      maxEssrBytes = 8 * 1024 ** 2,
      maxEssrItems = 16384,
    }: {
      handlers?: readonly ExchangeRouteHandler[];
      cues?: Deck<AgentCue>;
      maxEssrBytes?: number;
      maxEssrItems?: number;
    } = {},
  ) {
    for (const limit of [maxEssrBytes, maxEssrItems, 4 * Math.ceil(maxEssrBytes / 3) + 12 * maxEssrItems]) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid exchange ESSR limit");
    }
    this.maxEssrBytes = maxEssrBytes;
    this.maxEssrItems = maxEssrItems;
    this.hby = hby;
    this.cues = cues ?? new Deck();
    for (const handler of handlers) {
      this.addHandler(handler);
    }
  }

  /** Register one route handler for accepted exchange messages. */
  addHandler(handler: ExchangeRouteHandler): void {
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
    const reject = (reason: string): ExchangeDecision => ({ kind: "reject", reason, said });
    // A foreign or in-memory wire is snapshotted before verification and disposed on rejection.
    let staged: FilePayload | undefined;
    let evidenceStarted = false;
    let nestStage: string | undefined;
    let reopenedNests: CesrFrame[] = [];
    let nests: readonly CesrFrame[] = args.nests ?? [];
    // Resources unwind in reverse order: I/O, payload cleanup, then admission release.
    yield* this.admission();
    yield* resource(function*(this: Exchanger, provide: Provide<void>) {
      try {
        yield* provide(undefined);
      } finally {
        if (evidenceStarted && !this.hby.db.exchangeMeta.get([said])?.essr) this.hby.db.essrs.rem([said]);
        if (nestStage) this.hby.db.enstStaging.rem([nestStage]);
        try {
          yield* call(() => discardNests(reopenedNests));
        } finally {
          if (staged) yield* call(() => staged!.discard());
        }
      }
    }.bind(this));
    if (args.serder.ilk !== "exn") return reject(`Unsupported exchange ilk ${args.serder.ilk}.`);
    const sender = args.serder.pre;
    if (!sender || !args.serder.said) return reject("Exchange message is missing sender or SAID.");
    const signatures = this.verifySignatures({
      serder: args.serder,
      sender,
      tsgs: args.tsgs ?? [],
      cigars: args.cigars ?? [],
    });
    if (signatures.kind === "reject") return signatures;

    const previous = this.hby.db.exchangeMeta.get([said]);
    const retained = yield* abortable((signal) =>
      this.hby.db.getEssr(said, signal, { maxEssrBytes: this.maxEssrBytes, maxEssrItems: this.maxEssrItems })
    );
    const existing = previous?.essr ? retained : null;
    let essr = args.essr ?? retained ?? undefined;
    if (essr) {
      if (
        !Number.isSafeInteger(essr.count) || essr.count < 0 || essr.count > this.maxEssrItems
        || !Number.isSafeInteger(essr.raw.size) || essr.raw.size < 0 || essr.raw.size > this.maxEssrBytes
        || !Number.isSafeInteger(essr.wire.size) || essr.wire.size < 0
        || essr.wire.size > 4 * Math.ceil(essr.raw.size / 3) + 12 * essr.count
      ) {
        return reject("Exchange ESSR exceeds admission limits.");
      }
    }
    if (args.essr || (retained && !existing)) {
      // Keep the first retained representation; a duplicate may use different legal fragment boundaries.
      const incoming = retained && !existing ? retained : args.essr!;
      essr = yield* abortable(async (signal) => {
        const archive = await this.hby.db.openPayloads(signal);
        let wire = incoming.wire;
        if (!archive.files.owns(wire)) {
          const sink = await archive.files.stage(wire.size, signal);
          try {
            let copied = 0;
            for await (const chunk of wire.open(signal)) {
              await sink.write(chunk);
              copied += chunk.length;
            }
            if (copied !== wire.size) throw new ValidationError("ESSR wire size changed during admission.");
            staged = await sink.finish();
            wire = staged;
          } finally {
            await sink.abort();
          }
        }
        // Derive authenticated bytes from the immutable wire, never from a caller-supplied raw view.
        return essrPayload(
          {
            size: wire.size,
            /** Reopen the immutable snapshot without transferring mutation rights. */
            open: (signal) => wire.open(signal),
            /** Admission or archive ownership outlives this borrowed decoding view. */
            discard: async () => {},
          },
          incoming.count,
          incoming.raw.size,
          incoming.gvrsn,
        );
      });
    }
    if (typeof args.serder.a === "string") {
      try {
        const diger = new Diger({ qb64: args.serder.a });
        const raw = essr?.raw;
        if (!raw || !(yield* abortable((signal) => diger.verifyStream(raw.open(signal))))) {
          return reject("Exchange ESSR payload digest does not match its signed commitment.");
        }
        const supplied = args.essr;
        if (retained && !existing && supplied) {
          // Imported rows and the supplied duplicate must both match; never trust its caller-provided raw view.
          const duplicate = essrPayload(
            {
              size: supplied.wire.size,
              /** Read the candidate wire without adopting its request-owned payload. */
              open: (signal) => supplied.wire.open(signal),
              /** Verification leaves disposal with the caller. */
              discard: async () => {},
            },
            supplied.count,
            supplied.raw.size,
            supplied.gvrsn,
          );
          if (!(yield* abortable((signal) => diger.verifyStream(duplicate.raw.open(signal))))) {
            return reject("Duplicate ESSR payload digest does not match its signed commitment.");
          }
        }
      } catch (error) {
        return reject(`Invalid exchange ESSR payload: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const attachments = normalizeAttachments(args.ptds ?? []);
    const handler = this.routes.get(args.serder.route ?? "");
    let retainedNests = hasNests(this.hby.db, said);
    if (args.nests?.length || retainedNests) {
      // Recover only nested work; ordinary flat exchanges need no file archive.
      yield* abortable((signal) => this.hby.db.openPayloads(signal));
      retainedNests = hasNests(this.hby.db, said);
    }
    if (
      (args.nests?.length || retainedNests)
      && (args.serder.pvrsn.major < 2 || !handler?.acceptsNests
        || (args.serder.route !== "/fwd" && !nestedMultisigIlks(args.serder.route ?? "")))
    ) {
      return reject("Nested exchange route is not implemented.");
    }
    if (args.nests?.length) {
      try {
        chargeNests(args.nests, this.nestBudget(args, essr));
      } catch (error) {
        return reject(error instanceof Error ? error.message : String(error));
      }
    }
    if (retainedNests && !args.nests?.length) {
      // Signature-only retries reopen the durable evidence; fresh parsed children stay hydrated.
      yield* abortable(async (signal) => {
        reopenedNests = await loadNests(this.hby.db, said, this.nestBudget(args, essr), signal);
      });
      nests = reopenedNests;
    }
    const mailboxAid = args.mailboxAid ?? previous?.mailboxAid ?? null;
    if (signatures.kind === "verified" && handler?.verify) {
      const verified = yield* call(() =>
        handler.verify!({ serder: args.serder, attachments, essr, nests, mailboxAid })
      );
      if (!verified) return reject(`Exchange route ${args.serder.route ?? ""} failed handler verification.`);
    }
    // An already accepted exchange cannot be downgraded by an incomplete duplicate.
    if (signatures.kind !== "verified" && this.complete(said)) return { kind: "accept", said };
    if (args.nests?.length) {
      nestStage = crypto.randomUUID();
      yield* abortable((signal) => stageNests(this.hby.db, nestStage!, nests, signal));
    }
    /** Publish ordinary evidence and private provenance in the archive transaction. */
    const commit = () => {
      if (nestStage) publishNests(this.hby.db, said, nestStage);
      if (signatures.kind === "verified") {
        this.clearEscrow(said, true);
        this.logAcceptedEvent({
          serder: args.serder,
          tsgs: signatures.tsgs,
          cigars: signatures.cigars,
          ptds: args.ptds ?? [],
        });
      } else {
        this.escrowPartialSigned(args.serder, args.tsgs ?? [], args.ptds ?? []);
      }
      this.hby.db.exchangeMeta.pin([said], {
        mailboxAid,
        ...((existing ?? essr)
          ? {
            essr: {
              count: (existing ?? essr)!.count,
              size: (existing ?? essr)!.raw.size,
              gvrsn: (existing ?? essr)!.gvrsn,
            },
          }
          : {}),
      });
    };
    let stored = existing ?? essr;
    if (essr && !existing) {
      const wire = essr;
      // KERIpy-origin rows already have accepted/escrow ownership; failed import must preserve them.
      if (!retained) {
        this.hby.db.essrs.rem([said]);
        evidenceStarted = true;
      }
      stored = yield* abortable(async (signal) => {
        if (!retained) {
          // Populate new KERIpy evidence one bounded Texter at a time.
          for await (const texter of essrTexters(wire, this.maxEssrBytes, signal)) {
            this.hby.db.essrs.add([said], texter);
          }
        }
        await (await this.hby.db.openPayloads(signal)).publish(
          `essr/${said}`,
          staged ?? args.essr?.wire ?? wire.wire,
          commit,
          signal,
        );
        return (await this.hby.db.getEssr(said, signal, {
          maxEssrBytes: this.maxEssrBytes,
          maxEssrItems: this.maxEssrItems,
        }))!;
      });
    } else {
      yield* abortable(async (signal) => {
        signal.throwIfAborted();
        this.hby.db.env!.transactionSync(commit);
        await this.hby.db.env!.flushed;
      });
    }
    if (signatures.kind !== "verified") return signatures;
    if (handler) {
      yield* call(() =>
        handler.handle({ serder: args.serder, attachments, essr: stored ?? undefined, nests, mailboxAid })
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
    let end: Uint8Array | undefined;
    // Capture a finite key horizon without retaining bodies or holding a cursor across mutations.
    for (const key of this.hby.db.epse.sdb.getKeys({ reverse: true, limit: 1 })) {
      end = b(`${textDecoder.decode(key)}\0`);
    }
    if (!end) return;
    let start: Uint8Array | undefined;
    for (;;) {
      let said: string | undefined;
      for (const key of this.hby.db.epse.sdb.getKeys({ start, end, limit: 1 })) {
        said = textDecoder.decode(key);
      }
      if (!said) break;
      // A zero suffix sorts immediately after this ASCII SAID and before the next SAID.
      start = b(`${said}\0`);
      const serder = this.hby.db.epse.get([said]);
      if (!serder) throw new Error("Exchange escrow disappeared during retry.");
      const dater = this.hby.db.epsd.get([said]);
      if (!dater || Date.now() - new Date(dater.dts).getTime() > EXCHANGE_ESCROW_TIMEOUT_MS) {
        yield* call(() => this.dropEscrow(said));
        continue;
      }
      const decision = yield* this.processEvent({
        serder,
        tsgs: this.rebuildEscrowedGroups(said),
        cigars: this.hby.db.ecigs.get([said]).map(([, cigar]) => cigar),
        ptds: this.hby.db.epath.get([said]).map((text) => PathedMaterialGroup.fromRaw(new TextEncoder().encode(text))),
        mailboxAid: this.hby.db.exchangeMeta.get([said])?.mailboxAid,
      });
      if (decision.kind === "reject") yield* call(() => this.dropEscrow(said));
    }
  }

  /** Share parent metadata and ESSR credit across all retained child rows. */
  private nestBudget(
    args: ExchangeInput,
    essr?: EssrPayload | null,
    prepared?: readonly AttachmentGroup[],
  ): NestBudget {
    const groups = prepared ?? messageAttachmentGroups({
      tsgs: args.tsgs,
      cigars: args.cigars,
      pathed: (args.ptds ?? []).map((group) => group.raw),
    }, resolveAttachmentGvrsn(args.serder));
    return {
      bytes: 8 * 1024 ** 2 - args.serder.raw.length - groups.reduce((size, group) => size + group.raw.length, 0),
      groups: 4096 - groups.length,
      nodes: 255,
      essrBytes: this.maxEssrBytes - (essr?.raw.size ?? 0),
      essrItems: this.maxEssrItems - (essr?.count ?? 0),
    };
  }

  /** Stream accepted evidence; reopened child ESSR stages survive until output cancellation or completion. */
  async *replay(said: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    signal?.throwIfAborted();
    const serder = this.hby.db.exns.get([said]);
    if (!serder) throw new ValidationError("Cannot replay an unaccepted exchange.");
    const essr = await this.hby.db.getEssr(said, signal, {
      maxEssrBytes: this.maxEssrBytes,
      maxEssrItems: this.maxEssrItems,
    });
    const gvrsn = resolveAttachmentGvrsn(serder, essr?.gvrsn);
    const args = {
      serder,
      tsgs: this.rebuildEscrowedGroups(said),
      cigars: this.hby.db.ecigs.get([said]).map(([, cigar]) => cigar),
      ptds: this.hby.db.epath.get([said]).map((text) => PathedMaterialGroup.fromRaw(new TextEncoder().encode(text))),
    };
    const evidence = { tsgs: args.tsgs, cigars: args.cigars, pathed: args.ptds.map((group) => group.raw) };
    const nested = hasNests(this.hby.db, said);
    const groups = nested ? messageAttachmentGroups(evidence, gvrsn) : [];
    const nests = nested ? await loadNests(this.hby.db, said, this.nestBudget(args, essr, groups), signal) : [];
    try {
      if (nests.length) {
        // Reuse the stored Serder and hydrated endorsements; the shared encoder builds real leaf groups.
        const parent: CesrFrame = {
          body: serder,
          attachments: groups,
          gvrsn,
          nests,
          essr: essr ?? undefined,
        };
        yield* framePayload(parent).open(signal);
      } else {
        yield serializeMessage(serder, { ...evidence, gvrsn, genusify: gvrsn.major >= 2 });
        if (essr) yield* essrChunks(essr, { gvrsn, signal });
      }
    } finally {
      await discardNests(nests);
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
      if (keys[0] === said) {
        indices.push(siger.index);
      }
    }
    if (indices.length === 0) {
      return false;
    }

    const leadKey = groupKever.verfers[Math.min(...indices)]?.qb64;
    return leadKey === memberKey;
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
    | ExchangeDecision
  {
    if (args.tsgs.length > 0) {
      const verifiedGroups: TransIdxSigGroup[] = [];
      const grouped = aggregateTransIdxSigGroups(args.tsgs);

      for (const tsg of grouped) {
        if (tsg.pre !== args.sender) {
          return {
            kind: "reject",
            reason: `Exchange signer ${tsg.pre} does not match sender ${args.sender}.`,
            said: args.serder.said ?? "<unknown>",
          };
        }

        const estSaid = this.hby.db.kels.getLast(tsg.pre, Number(tsg.sn));
        const estEvent = this.hby.db.getEvtSerder(tsg.pre, tsg.said);
        if (!estSaid || estSaid !== tsg.said || !estEvent) {
          this.cues.push({ kin: "query", pre: tsg.pre, q: { pre: tsg.pre } });
          return {
            kind: "escrow",
            reason: `Missing accepted establishment state for ${tsg.pre}:${tsg.said}.`,
            said: args.serder.said ?? "<unknown>",
          };
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
          this.cues.push({ kin: "query", pre: tsg.pre, q: { pre: tsg.pre } });
          return {
            kind: "escrow",
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
        if (!cigar.verfer.verify(cigar.raw, args.serder.raw)) {
          return {
            kind: "reject",
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
    tsgs: readonly TransIdxSigGroup[],
    ptds: readonly PathedMaterialGroup[],
  ): void {
    const said = serder.said;
    if (!said) {
      throw new ValidationError("Cannot escrow an exchange without a SAID.");
    }

    for (const tsg of tsgs) {
      const quadKey = [said, tsg.pre, tsg.snh, tsg.said] as const;
      for (const siger of tsg.sigers) {
        this.hby.db.esigs.add(quadKey, siger);
      }
    }

    this.hby.db.epse.pin([said], serder);
    // Preserve first admission time so repeated retries cannot keep stale wire alive forever.
    this.hby.db.epsd.put(
      [said],
      new Dater({
        qb64: encodeDateTimeToDater(makeNowIso8601()),
      }),
    );
    this.hby.db.epath.pin(
      [said],
      ptds.map((group) => textDecoder.decode(group.raw)),
    );
  }

  /** Persist protocol evidence inside the admission transaction before route handling. */
  private logAcceptedEvent(args: {
    serder: SerderKERI;
    tsgs: readonly TransIdxSigGroup[];
    cigars: readonly Cigar[];
    ptds: readonly PathedMaterialGroup[];
  }): void {
    const said = args.serder.said;
    if (!said) {
      throw new ValidationError("Cannot log an exchange without a SAID.");
    }

    for (const tsg of args.tsgs) {
      const quadKey = [said, tsg.pre, tsg.snh, tsg.said] as const;
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
    this.hby.db.esigs.trim([said, ""], { topive: false });
    this.hby.db.ecigs.rem([said]);
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
      return;
    }
    if (this.hby.db.exchangeMeta.get([said])?.essr) {
      yield* abortable(async (signal) => {
        await (await this.hby.db.openPayloads(signal)).remove(`essr/${said}`, () => this.clearEscrow(said), signal);
      });
    } else this.clearEscrow(said);
  }
}

/**
 * Create and deliver one signed exchange message through the selected
 * controller-to-controller transport path.
 */
export function* sendSignedExchangeMessage(
  hab: Hab,
  args: {
    route: string;
    payload: Record<string, unknown>;
    recipient: string;
    transport?: ExchangeTransport;
    modifiers?: Record<string, unknown>;
    date?: string;
    dig?: string;
  },
): Operation<{ serder: SerderKERI; url: string }> {
  const url = resolveExchangeTransportUrl(
    hab,
    args.recipient,
    args.transport ?? "auto",
  );
  if (!url) {
    throw new ValidationError(
      `No ${args.transport ?? "auto"} exchange endpoint is available for ${args.recipient}.`,
    );
  }

  const [serder] = exchangeMessage(args.route, args.payload, {
    sender: hab.pre,
    recipient: args.recipient,
    modifiers: args.modifiers,
    stamp: args.date,
    dig: args.dig,
  });
  const message = hab.endorse(serder, { pipelined: false });
  yield* postCesr(url, (signal) => chunkBytes(message, { signal }), {
    bodyMode: "header",
    destination: args.recipient,
  });

  return { serder, url };
}

/**
 * Choose the remote URL that should receive one outbound exchange message.
 *
 * Current transport policy:
 * - `direct` sends to the recipient controller location
 * - `indirect` sends to an authorized mailbox endpoint, then falls back to
 *   agent endpoints when no mailbox URL is available
 * - `auto` prefers direct delivery because this codebase has not yet landed
 *   full witness-forwarding mailbox orchestration
 */
export function resolveExchangeTransportUrl(
  hab: Hab,
  recipient: string,
  transport: ExchangeTransport,
): string | null {
  const directUrl = preferredUrl(hab.fetchUrls(recipient));
  const ends = hab.endsFor(recipient);
  const mailboxUrl = preferredRoleUrl(ends[Roles.mailbox]);
  const agentUrl = preferredRoleUrl(ends[Roles.agent]);

  switch (transport) {
    case "direct":
      return directUrl;
    case "indirect":
      return mailboxUrl ?? agentUrl;
    case "auto":
    default:
      return directUrl ?? mailboxUrl ?? agentUrl;
  }
}

function preferredRoleUrl(
  roleUrls?: Record<string, Record<string, string>>,
): string | null {
  if (!roleUrls) {
    return null;
  }
  for (const urls of Object.values(roleUrls)) {
    const preferred = preferredUrl(urls);
    if (preferred) {
      return preferred;
    }
  }
  return null;
}

function preferredUrl(urls: Record<string, string>): string | null {
  return urls.https ?? urls.http ?? Object.values(urls)[0] ?? null;
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
    const key = `${group.pre}\0${group.snh}\0${group.said}`;
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
