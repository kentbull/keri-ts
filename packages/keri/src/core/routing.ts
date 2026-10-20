import { Cigar, Dater, Diger, NumberPrimitive, Prefixer, SerderKERI, Siger } from "cesr-ts";
import { Baser } from "../db/basing.ts";
import { encodeDateTimeToDater, timestampMicros } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import type { QueryCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import { type DispatchOrdinal, TransIdxSigGroup } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import {
  acceptEscrow,
  dropEscrow,
  type EscrowProcessDecision,
  keepEscrow,
  logEscrowDecision,
} from "./kever-decisions.ts";
import { EndpointRecord, LocationRecord } from "./records.ts";
import { isRole } from "./roles.ts";

/** Live reply outcome for one reply that was accepted this pass. */
export interface ReplyAccept {
  kind: "accept";
}

/** Unaccepted proof; proofPending hands recoverable evidence back to the caller. */
export interface ReplyUnverified {
  kind: "unverified";
  reason: "notAccepted" | "proofPending";
  message: string;
}

/** Proof verification cannot choose a semantic receiver's dependency family. */
export type ReplyProofDecision = ReplyAccept | ReplyUnverified;

/**
 * Route handlers own their closed escrow-family types. The shared dispatcher
 * transports the family name without importing higher-level receiver policy.
 */
export type ReplyProcessDecision<Family extends string = string> =
  | ReplyProofDecision
  | {
    kind: "unverified";
    reason: "dependencyPending";
    family: Family;
    message: string;
  };

/** Verified reply material has either one cigar or a complete transferable signer group. */
export type ReplyProof =
  & {
    serder: SerderKERI;
    saider: Diger;
    dater: Dater;
  }
  & (
    | { kind: "nontransferable"; cigar: Cigar }
    | {
      kind: "transferable";
      prefixer: Prefixer;
      seqner: DispatchOrdinal;
      diger: Diger;
      sigers: Siger[];
    }
  );

/**
 * Plain proof effects and queries discovered without writes or cue ownership.
 * Consume in the same synchronous owner turn; do not suspend or mutate borrowed
 * proof material between evaluation and persistence.
 */
export type ReplyPlan =
  & {
    escrows: ReadonlyArray<Parameters<Revery["escrowReply"]>[0]>;
    cues: readonly QueryCue[];
  }
  & (
    | (ReplyAccept & { accepted: ReplyProof; previous: Diger | null })
    | ReplyUnverified
  );

/** Builder for one accepted live reply decision. */
export function acceptReplyDecision(): ReplyAccept {
  return { kind: "accept" };
}

/** Builder for one unverified live reply decision. */
export function unverifiedReplyDecision(
  message: string,
): ReplyUnverified {
  return { kind: "unverified", reason: "notAccepted", message };
}

/** Validate a reflective route result before it enters typed reply processing. */
function isReplyDecision(value: unknown): value is ReplyProcessDecision {
  if (!value || typeof value !== "object") return false;
  if (!("kind" in value)) return false;
  if (value.kind === "accept") return true;
  if (value.kind !== "unverified" || !("message" in value) || typeof value.message !== "string") return false;
  if (!("reason" in value)) return false;
  switch (value.reason) {
    case "notAccepted":
    case "proofPending":
      return true;
    case "dependencyPending":
      return "family" in value && typeof value.family === "string";
    default:
      return false;
  }
}

/** Return true when a reply signer has usable threshold material for its key set. */
function hasValidReplyThreshold(
  serder: SerderKERI,
): boolean {
  return serder.tholder !== null
    && serder.verfers.length >= serder.tholder.size;
}

/** Return the hex ordinal text used for DB keys from either Seqner or Number. */
export function encodeOrdinalHex(ordinal: DispatchOrdinal): string {
  return "snh" in ordinal ? ordinal.snh : ordinal.numh;
}

function requireReplyCigarVerfer(cigar: Cigar) {
  const verfer = cigar.verfer;
  if (!verfer) {
    throw new ValidationError("Reply cigar is missing verifier context.");
  }
  return verfer;
}

/**
 * Return true when a new reply timestamp is strictly newer than the accepted one.
 *
 * BADA rule used here:
 * - when two reply updates are otherwise comparable, later datetimes win
 * - equality is intentionally not accepted, because same-SAID idempotence is
 *   handled by the route processors before this comparison is reached
 */
function sameOrNewerReply(
  nextDater: Dater,
  oldDater: Dater | null,
): boolean {
  if (!oldDater) {
    return true;
  }
  const next = timestampMicros(nextDater.dts), previous = timestampMicros(oldDater.dts);
  if (next === null || previous === null) throw new ValidationError("Invalid BADA reply timestamp.");
  return next > previous;
}

/**
 * Rebuild transferable signature groups for one stored message SAID from
 * `ssgs.`.
 *
 * This is used both by reply escrow reprocessing and by query-not-found
 * continuation, because both flows persist transferable attachment groups under
 * the same `(said, pre, snh, dig)` key shape.
 *
 * Reconstruction steps:
 * - walk the stored signature rows under one message SAID
 * - regroup rows by `(pre, snh, dig)` back into transferable signature groups
 * - reconstruct ordinals directly from stored keys, even while signer KEL
 *   evidence is missing; ordinary reply verification owns that dependency check
 *
 * Ordering rule:
 * - groups are returned newest-first by establishment sequence number so reply
 *   verification sees the same lead-group precedence KERIpy expects
 */
export function fetchStoredTsgs(
  db: Baser,
  said: string,
): TransIdxSigGroup[] {
  const grouped = new Map<string, TransIdxSigGroup>();

  for (
    const [keys, siger] of db.ssgs.getTopItemIter([said], { topive: true })
  ) {
    const prefix = keys[1];
    const snh = keys[2];
    const dig = keys[3];
    if (!prefix || !snh || !dig) {
      continue;
    }
    const seqner = NumberPrimitive.fromNum(BigInt(`0x${snh}`));
    const prefixer = new Prefixer({ qb64: prefix });
    const diger = new Diger({ qb64: dig });
    const key = `${prefix}.${snh}.${dig}`;
    let group = grouped.get(key);
    if (!group) {
      group = new TransIdxSigGroup(prefixer, seqner, diger, []);
      grouped.set(key, group);
    }
    group.sigers.push(siger);
  }

  return [...grouped.values()].sort((a, b) => Number(b.sn - a.sn));
}

/**
 * Registered reply-route metadata used by `Router`.
 *
 * Each route stores the compiled regexp, extracted template fields, the target
 * resource, and an optional suffix that maps one URI family onto a more
 * specific `processReply{Suffix}` method.
 */
export class Route {
  readonly regex: RegExp;
  readonly fields: Set<string>;
  readonly resource: object;
  readonly suffix?: string;

  /** Create one registered route entry from a compiled template and resource. */
  constructor(
    regex: RegExp,
    fields: Set<string>,
    resource: object,
    suffix?: string,
  ) {
    this.regex = regex;
    this.fields = fields;
    this.resource = resource;
    this.suffix = suffix;
  }
}

/**
 * Compile one simple URI template into the regexp/field tuple used by `Router`.
 *
 * Supported template feature:
 * - path parameters in `{name}` form
 *
 * Current limitation:
 * - this deliberately implements only the route syntax needed by KERI reply
 *   dispatch and does not attempt RFC-6570 generality
 */
export function compileUriTemplate(template: string): [Set<string>, RegExp] {
  if (!template.startsWith("/")) {
    throw new ValidationError("uri_template must start with '/'");
  }
  if (template.includes("//")) {
    throw new ValidationError("uri_template may not contain '//'");
  }

  const normalized = template !== "/" && template.endsWith("/")
    ? template.slice(0, -1)
    : template;
  const expressionPattern = /{([a-zA-Z]\w*)}/g;
  const fields = new Set(
    [...normalized.matchAll(expressionPattern)].map((match) => match[1]),
  );
  const escaped = normalized.replace(/[\.\(\)\[\]\?\*\+\^\|]/g, "\\$&");
  const pattern = escaped.replace(expressionPattern, "(?<$1>[^/]+)");
  return [fields, new RegExp(`^${pattern}$`, "i")];
}

/**
 * Reply-message router.
 *
 * KERIpy correspondence:
 * - mirrors `keri.core.routing.Router`
 *
 * Routing rule:
 * - reply handlers are selected purely by the `r` field of an already-saidified
 *   `rpy` event
 * - route-specific semantic validation happens inside the selected handler, not
 *   here
 */
export class Router {
  static readonly defaultResourceFunc = "processReply";
  readonly routes: Route[];

  /** Create one router with an optional pre-registered route table. */
  constructor(routes: Route[] = []) {
    this.routes = routes;
  }

  /**
   * Register one route template against one resource object.
   *
   * The target resource must implement either `processReply()` or
   * `processReply{suffix}()` depending on the optional suffix argument.
   */
  addRoute(routeTemplate: string, resource: object, suffix?: string): void {
    const [fields, regex] = compileUriTemplate(routeTemplate);
    this.routes.push(new Route(regex, fields, resource, suffix));
  }

  /**
   * Dispatch one already-parsed reply event to its route-specific handler.
   *
   * This method is intentionally small:
   * - verify the route exists
   * - match URI parameters
   * - invoke the resource method
   *
   * It does not do BADA or signature acceptance itself; those belong to
   * `Revery` and the route handler.
   *
   * @throws ValidationError for a missing or unregistered incoming route.
   * @throws TypeError for an invalid configured handler or its return contract.
   */
  dispatch(args: {
    serder: SerderKERI;
    diger: Diger;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProcessDecision {
    const route = args.serder.route;
    if (!route) {
      throw new ValidationError("Reply message is missing route 'r'.");
    }

    for (const candidate of this.routes) {
      const match = candidate.regex.exec(route);
      if (!match) {
        continue;
      }

      const funcName = candidate.suffix
        ? `${Router.defaultResourceFunc}${candidate.suffix}`
        : Router.defaultResourceFunc;
      const fn = Reflect.get(candidate.resource, funcName);
      if (typeof fn !== "function") {
        throw new TypeError(
          `Resource for route ${route} does not implement ${funcName}.`,
        );
      }
      const params = match.groups ?? {};
      for (const field of candidate.fields) {
        if (!(field in params)) {
          throw new TypeError(
            `parameter ${field} not found in route ${route}`,
          );
        }
      }
      const decision: unknown = fn.call(candidate.resource, {
        ...args,
        route,
        ...params,
      });
      if (!isReplyDecision(decision)) {
        throw new TypeError(
          `Reply route ${route} did not return a valid reply decision.`,
        );
      }
      return decision;
    }

    throw new ValidationError(
      `No resource is registered to handle route ${route}`,
    );
  }
}

/**
 * Reply-message verification and escrow processor.
 *
 * KERIpy correspondence:
 * - mirrors `keri.core.routing.Revery`
 *
 * Responsibilities:
 * - verify `rpy` envelopes are well-formed and route-dispatchable
 * - apply BADA acceptance rules against existing accepted reply state
 * - persist accepted reply artifacts into `sdts.`, `rpys.`, `scgs.`, `ssgs.`
 * - escrow partially verifiable transferable replies into `rpes.`
 * - emit `query` cues when missing signer state blocks verification
 *
 * Current `keri-ts` differences:
 * - only the Gate E bootstrap reply families are currently routed
 * - `lax` / `local` flags exist for future parity, but the present bootstrap
 *   slice does not yet implement the full KERIpy own-attachment policy matrix
 */
export class Revery {
  static readonly TimeoutRPE = 3600_000;

  readonly db: Baser;
  readonly rtr: Router;
  readonly cues: Deck<AgentCue>;
  readonly lax: boolean;
  readonly local: boolean;

  /**
   * Create one reply verifier bound to one `Baser` and optional shared router.
   *
   * The same `cues` deck should be shared with the surrounding runtime so
   * missing-signer queries and later reply-driven work flow through the same
   * cue loop as KEL events.
   */
  constructor(
    db: Baser,
    {
      rtr,
      cues,
      lax = true,
      local = false,
    }: {
      rtr?: Router;
      cues?: Deck<AgentCue>;
      lax?: boolean;
      local?: boolean;
    } = {},
  ) {
    this.db = db;
    this.rtr = rtr ?? new Router();
    this.cues = cues ?? new Deck();
    this.lax = lax;
    this.local = local;
  }

  /** Local prefixes used for self-attachment policy decisions. */
  get prefixes(): string[] {
    return [...this.db.prefixes];
  }

  /**
   * Verify one reply envelope and hand it to the route-specific processor.
   *
   * Boundary rule:
   * - this verifies the reply SAID and manufactures the canonical `Diger`
   *   for the reply body
   * - route-specific semantic checks and BADA acceptance happen after dispatch
   */
  processReply(args: {
    serder: SerderKERI;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProcessDecision {
    // Missing signer groups can each request state; the accepted route may also emit one cue.
    if (!args.serder.verify()) {
      throw new ValidationError(
        `Invalid said for reply msg=${JSON.stringify(args.serder.ked)}.`,
      );
    }
    const said = args.serder.said;
    if (!said) {
      throw new ValidationError("Reply message is missing SAID.");
    }
    return this.rtr.dispatch({
      ...args,
      diger: new Diger({ qb64: said }),
    });
  }

  /**
   * Apply BADA acceptance rules to one reply and its attached signatures.
   *
   * Acceptance model for this bootstrap slice:
   * - non-transferable reply cigars must come from the authorizing AID and be
   *   newer by datetime than the accepted reply they replace
   * - transferable groups must come from the authorizing AID and either use a
   *   later establishment event or, at the same establishment sequence number,
   *   a newer datetime
   * - missing signer establishment state or partial transferable signatures are
   *   escrowed rather than treated as terminal failure
   *
   * Route processors are responsible for same-SAID idempotence by nulling out
   * `osaider` before they call this method.
   */
  acceptReply(args: {
    serder: SerderKERI;
    saider: Diger;
    route: string;
    aid: string;
    osaider?: Diger | null;
    /** Semantic owners retain the prior evidence until their own publication succeeds. */
    retainPrevious?: boolean;
    /** The semantic owner persists/retries pending proofs instead of the legacy RPE adapter. */
    externalEscrow?: boolean;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProofDecision {
    const plan = this.decideReply(args);

    this.writeReply(plan);
    if (plan.cues.length) this.cues.extend(plan.cues);
    if (plan.kind === "accept") return acceptReplyDecision();
    return { kind: plan.kind, reason: plan.reason, message: plan.message };
  }

  /** Persist a plain proof plan before the caller publishes its cues. */
  writeReply(plan: ReplyPlan): void {
    for (const escrow of plan.escrows) this.escrowReply(escrow);
    if (plan.kind === "accept") {
      this.updateReply(plan.accepted);
      this.removeReply(plan.previous);
    }
  }

  /** Evaluate ordered proof groups with a virtual escrow view before any durable reply effects. */
  decideReply(args: Parameters<Revery["acceptReply"]>[0]): ReplyPlan {
    const escrows: Array<Parameters<Revery["escrowReply"]>[0]> = [];
    const cues: QueryCue[] = [];
    // Same-call groups see the last staged pin exactly as they previously saw the durable write.
    const staged = new Map<string, Parameters<Revery["escrowReply"]>[0]>();
    const groupKey = (pre: string, snh: string, said: string) => `${pre}.${snh}.${said}`;
    const daterText = args.serder.ked?.dt;
    if (typeof daterText !== "string") {
      throw new ValidationError("Reply message is missing 'dt'.");
    }
    const dater = new Dater({ qb64: encodeDateTimeToDater(daterText) });
    const odater = args.osaider ? this.db.sdts.get([args.osaider.qb64]) : null;
    let pending = false;
    const escrow = (material: Parameters<Revery["escrowReply"]>[0]) => {
      if (!material.sigers.length) return;
      pending = true;
      if (!args.externalEscrow) {
        escrows.push(material);
        staged.set(groupKey(material.prefixer.qb64, encodeOrdinalHex(material.seqner), material.diger.qb64), material);
      }
    };

    for (const cigar of args.cigars ?? []) {
      const verfer = requireReplyCigarVerfer(cigar);
      if (verfer.qb64 !== args.aid) {
        continue;
      }
      if (!sameOrNewerReply(dater, odater)) {
        continue;
      }
      if (!verfer.verify(cigar.raw, args.serder.raw)) {
        continue;
      }

      return {
        kind: "accept",
        previous: args.retainPrevious ? null : args.osaider ?? null,
        escrows,
        cues,
        accepted: { kind: "nontransferable", serder: args.serder, saider: args.saider, dater, cigar },
      };
    }

    const oldTsgs = args.osaider
      ? fetchStoredTsgs(this.db, args.osaider.qb64)
      : [];
    // Reconstruction retains missing-key groups for retry. Only a group whose
    // claimed ordinal matches its establishment event can lead prior BADA proof.
    const oldLead = oldTsgs.find(tsg => this.db.getEvtSerder(tsg.pre, tsg.said)?.sner?.num === tsg.sn);
    for (const tsg of args.tsgs ?? []) {
      if (tsg.pre !== args.aid) {
        continue;
      }
      if (
        oldLead
        && (tsg.sn < oldLead.sn
          || (tsg.sn === oldLead.sn && !sameOrNewerReply(dater, odater)))
      ) {
        continue;
      }

      const estSaid = this.db.kels.getLast(tsg.pre, Number(tsg.sn));
      if (!estSaid || estSaid !== tsg.said) {
        escrow({
          serder: args.serder,
          saider: args.saider,
          dater,
          route: args.route,
          prefixer: tsg.prefixer,
          seqner: tsg.seqner,
          diger: tsg.diger,
          sigers: [...tsg.sigers],
        });
        cues.push({ kin: "query", pre: tsg.pre, route: "logs", q: {} });
        continue;
      }

      const estEvent = this.db.getEvtSerder(tsg.pre, tsg.said);
      if (!estEvent) {
        escrow({
          serder: args.serder,
          saider: args.saider,
          dater,
          route: args.route,
          prefixer: tsg.prefixer,
          seqner: tsg.seqner,
          diger: tsg.diger,
          sigers: [...tsg.sigers],
        });
        continue;
      }

      const escrowed = staged.get(groupKey(tsg.pre, tsg.snh, tsg.said))?.sigers ?? this.db.ssgs.get([
        args.saider.qb64,
        tsg.pre,
        tsg.snh,
        tsg.said,
      ]);
      if (!hasValidReplyThreshold(estEvent)) {
        throw new ValidationError(
          `Invalid threshold material on reply signer state ${tsg.pre}:${tsg.said}.`,
        );
      }
      const tholder = estEvent.tholder;
      if (!tholder || estEvent.verfers.length < tholder.size) {
        throw new ValidationError(
          `Invalid threshold material on reply signer state ${tsg.pre}:${tsg.said}.`,
        );
      }
      const verified: Siger[] = [];
      const seen = new Set<number>();
      for (const siger of [...tsg.sigers, ...escrowed]) {
        const verfer = estEvent.verfers[siger.index];
        if (!verfer || seen.has(siger.index)) {
          continue;
        }
        if (!verfer.verify(siger.raw, args.serder.raw)) {
          continue;
        }
        verified.push(
          new Siger(
            {
              code: siger.code,
              raw: siger.raw,
              index: siger.index,
              ondex: siger.ondex,
            },
            verfer,
          ),
        );
        seen.add(siger.index);
      }

      if (tholder.satisfy([...seen])) {
        return {
          kind: "accept",
          previous: args.retainPrevious ? null : args.osaider ?? null,
          escrows,
          cues,
          accepted: {
            kind: "transferable",
            serder: args.serder,
            saider: args.saider,
            dater,
            prefixer: tsg.prefixer,
            seqner: tsg.seqner,
            diger: tsg.diger,
            sigers: verified,
          },
        };
      }

      escrow({
        serder: args.serder,
        saider: args.saider,
        dater,
        route: args.route,
        prefixer: tsg.prefixer,
        seqner: tsg.seqner,
        diger: tsg.diger,
        sigers: verified,
      });
    }

    return {
      escrows,
      cues,
      kind: "unverified",
      reason: args.externalEscrow && pending ? "proofPending" : "notAccepted",
      message: `Reply ${args.saider.qb64} at route ${args.route} was not accepted.`,
    };
  }

  /**
   * Persist one accepted reply and any verified attachment artifacts.
   *
   * Stores touched:
   * - `sdts.` for acceptance datetime
   * - `rpys.` for the reply serder
   * - `scgs.` for stored verfer+cigar tuples
   * - `ssgs.` for transferable signature groups
   */
  updateReply(args: ReplyProof): void {
    const said = args.saider.qb64;
    this.db.sdts.pin([said], args.dater);
    this.db.rpys.pin([said], args.serder);
    if (args.kind === "nontransferable") {
      this.db.scgs.pin([said], [[
        requireReplyCigarVerfer(args.cigar),
        args.cigar,
      ]]);
    } else {
      this.db.ssgs.pin(
        [
          said,
          args.prefixer.qb64,
          encodeOrdinalHex(args.seqner),
          args.diger.qb64,
        ],
        args.sigers,
      );
    }
  }

  /**
   * Remove all persisted artifacts for one previously accepted reply SAID.
   *
   * This is used when a later reply supersedes an older accepted reply for the
   * same semantic route/data pair.
   */
  removeReply(saider: Diger | null): void {
    if (!saider) {
      return;
    }
    const said = saider.qb64;
    this.db.ssgs.trim([said], { topive: true });
    this.db.scgs.rem([said]);
    this.db.rpys.rem([said]);
    this.db.sdts.rem([said]);
  }

  /**
   * Persist one partially verifiable transferable reply in route-based escrow.
   *
   * Only transferable signatures are escrowed here. Non-transferable reply
   * cigars either verify immediately or are ignored; they do not participate
   * in Gate E reply escrow.
   */
  escrowReply(args: {
    serder: SerderKERI;
    saider: Diger;
    dater: Dater;
    route: string;
    prefixer: Prefixer;
    seqner: DispatchOrdinal;
    diger: Diger;
    sigers: Siger[];
  }): void {
    if (args.sigers.length === 0) {
      return;
    }
    const said = args.saider.qb64;
    this.db.sdts.pin([said], args.dater);
    this.db.rpys.pin([said], args.serder);
    this.db.ssgs.pin(
      [
        said,
        args.prefixer.qb64,
        encodeOrdinalHex(args.seqner),
        args.diger.qb64,
      ],
      args.sigers,
    );
    this.db.rpes.add([args.route], args.saider);
  }

  /**
   * Reprocess all pending reply escrows from `rpes.`.
   *
   * Lifecycle:
   * - reload stored reply + signatures by SAID
   * - drop incomplete or stale escrow entries
   * - rerun normal reply processing
   * - keep escrow only when verification is still blocked by a recoverable
   *   live reply `unverified` decision
   */
  /**
   * Process escrowed reply messages.
   *
   * Pass outline:
   * - walk `rpes.` rows keyed by reply route
   * - rebuild stored attachments and reply artifacts
   * - replay the reply through normal verification
   * - remove the escrow row on `accept` and `drop`, keep it on `keep`
   */
  processEscrowReply(): void {
    for (const [keys, diger] of this.db.rpes.getTopItemIter()) {
      const route = keys[0];
      if (!route) {
        continue;
      }
      const decision = this.reprocessEscrowedReply(diger);
      switch (decision.kind) {
        case "accept":
          this.db.rpes.rem([route], diger);
          break;
        case "drop": {
          const removed = this.db.rpes.rem([route], diger);
          this.removeReply(diger);
          if (removed) logEscrowDecision(`Revery RPE said=${diger.qb64} route=${route}`, decision);
          break;
        }
        case "keep":
          break;
      }
    }
  }

  /**
   * Replay one escrowed transferable reply through the normal verification path.
   *
   * Typed replay decisions make the Gate E control flow explicit:
   * - `keep` mirrors recoverable live `unverified` reply outcomes
   * - `drop` mirrors stale/corrupt escrow rows that should be removed
   * - `accept` mirrors successful reply verification on replay
   *
   * Stored-artifact model:
   * - `sdts.` holds the local escrow timestamp
   * - `rpys.` holds the escrowed reply serder
   * - `ssgs.` holds the transferable endorsement groups
   *
   * Steps:
   * - load and validate the escrow artifacts
   * - reject stale or malformed rows
   * - replay through `processReply()` exactly as if the reply re-arrived
   * - map recoverable live reply `unverified` decisions into `keep`
   * - retain unexpected failures and their escrow evidence for the caller
   *
   * @param diger SAID identifying the stored reply and detached proof material.
   * @returns The ordinary keep/drop/accept result; this method does not remove
   *   the current escrow membership.
   * @throws The original unexpected handler or infrastructure failure.
   */
  public reprocessEscrowedReply(
    diger: Diger,
  ): EscrowProcessDecision {
    const dater = this.db.sdts.get([diger.qb64]);
    const serder = this.db.rpys.get([diger.qb64]);
    const tsgs = fetchStoredTsgs(this.db, diger.qb64);
    if (!dater || !serder || tsgs.length === 0) {
      return dropEscrow(
        "missingEscrowArtifact",
        `Missing reply escrow artifacts at said=${diger.qb64}: dater=${!!dater}, serder=${!!serder}, tsgs=${tsgs.length}.`,
      );
    }
    if (Date.now() - new Date(dater.dts).getTime() > Revery.TimeoutRPE) {
      return dropEscrow("stale", `Stale reply escrow at said=${diger.qb64}, route=${serder.route ?? "<unknown>"}.`);
    }
    try {
      const decision = this.processReply({ serder, tsgs });
      if (decision.kind === "unverified") {
        return keepEscrow("unverifiedReply", `${decision.message} (said=${diger.qb64}, route=${serder.route})`);
      }
      return acceptEscrow();
    } catch (error) {
      // Remote validation may eject this reply; storage and handler defects must
      // escape unchanged so the owning loop does not discard recoverable evidence.
      if (!(error instanceof ValidationError)) throw error;
      return dropEscrow(
        "processingError",
        `${error.message} (said=${diger.qb64}, route=${serder.route})`,
        error,
      );
    }
  }
}

/**
 * Reply-route handlers for endpoint authorization and location replies.
 *
 * Maintainer note:
 * - KERIpy currently hangs these on `Kevery`
 * - `keri-ts` keeps them isolated so Gate E can land before the broader
 *   `Kevery` port is complete
 */
export class BasicReplyRouteHandler {
  /** Create one reply-route handler bound to one reply verifier and database. */
  constructor(readonly rvy: Revery) {}

  /**
   * Register the Gate E reply routes handled by this bootstrap handler.
   *
   * Current scope:
   * - `/end/role/{action}`
   * - `/loc/scheme`
   *
   * Deferred parity:
   * - `/ksn` and the wider reply families still belong to later Gate E work
   */
  registerReplyRoutes(router = this.rvy.rtr): void {
    router.addRoute("/end/role/{action}", this, "EndRole");
    router.addRoute("/loc/scheme", this, "LocScheme");
  }

  /**
   * Update endpoint authorization state after one accepted `/end/role/*` reply.
   *
   * Stores touched:
   * - `eans.` remembers the accepted reply SAID
   * - `ends.` stores the latest allowed/disallowed authorization projection
   */
  updateEnd(
    keys: [string, string, string],
    saider: Diger,
    allowed: boolean,
  ): void {
    this.rvy.db.eans.pin(keys, saider);
    const existing = this.rvy.db.ends.get(keys);
    this.rvy.db.ends.pin(keys, new EndpointRecord({ ...existing?.asDict(), allowed }));
  }

  /**
   * Update endpoint location state after one accepted `/loc/scheme` reply.
   *
   * Stores touched:
   * - `lans.` remembers the accepted reply SAID
   * - `locs.` stores the latest URL projection by endpoint and scheme
   */
  updateLoc(keys: [string, string], saider: Diger, url: string): void {
    this.rvy.db.lans.pin(keys, saider);
    const existing = this.rvy.db.locs.get(keys);
    this.rvy.db.locs.pin(keys, new LocationRecord({ ...existing?.asDict(), url }));
  }

  /**
   * Process one `/end/role/add` or `/end/role/cut` reply.
   *
   * This method:
   * - validates route/body shape
   * - derives the BADA route base `/end/role`
   * - applies same-SAID idempotence before acceptance
   * - evaluates proof and updates proof/`eans.`/`ends.` in its own transaction
   * - publishes queries only after that commit; caller-owned writers are refused
   */
  processReplyEndRole(args: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProcessDecision {
    const allowed = args.route.startsWith("/end/role/add")
      ? true
      : args.route.startsWith("/end/role/cut")
      ? false
      : null;
    if (allowed === null) {
      throw new ValidationError(
        `Unsupported route=${args.route} in reply message.`,
      );
    }

    const data = args.serder.ked?.a;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ValidationError("Missing one of cid/role/eid in /end/role reply.");
    }
    const cid = "cid" in data && typeof data.cid === "string" ? new Prefixer({ qb64: data.cid }).qb64 : null;
    const role = "role" in data && typeof data.role === "string" ? data.role : null;
    const eid = "eid" in data && typeof data.eid === "string" ? new Prefixer({ qb64: data.eid }).qb64 : null;
    if (!cid || !role || !eid) {
      throw new ValidationError(
        "Missing one of cid/role/eid in /end/role reply.",
      );
    }
    if (!isRole(role)) {
      throw new ValidationError(`Invalid endpoint role ${role}.`);
    }

    const keys: [string, string, string] = [cid, role, eid];
    if (this.rvy.db.inWriteTransaction) {
      throw new Error("Endpoint handler must own the reply transaction; process replies outside caller-owned writers");
    }

    let queryCues: readonly QueryCue[] = [];

    const decision = this.rvy.db.env!.transactionSync(() => {
      let osaider = this.rvy.db.eans.get(keys);
      if (osaider?.qb64 === args.diger.qb64) osaider = null;
      const plan = this.rvy.decideReply({
        serder: args.serder,
        saider: args.diger,
        route: "/end/role",
        aid: cid,
        osaider,
        cigars: args.cigars,
        tsgs: args.tsgs,
      });
      queryCues = plan.cues;
      this.rvy.writeReply(plan);
      if (plan.kind === "unverified") {
        return unverifiedReplyDecision(`Unverified end role reply = ${args.serder.said} role = ${role}`);
      }
      this.updateEnd(keys, args.diger, allowed);
      return acceptReplyDecision();
    });
    if (queryCues.length) this.rvy.cues.extend(queryCues);
    return decision;
  }

  /**
   * Process one `/loc/scheme` reply.
   *
   * BADA/idempotence rules mirror `/end/role`:
   * - route base is `/loc/scheme`
   * - same-SAID replay is treated as idempotent, not stale
   * - URL/scheme consistency is validated before reply acceptance
   *
   * Proof, `lans.` and `locs.` commit together in this owner's transaction;
   * query publication follows commit. Caller-owned writers are refused.
   */
  processReplyLocScheme(args: {
    serder: SerderKERI;
    diger: Diger;
    route: string;
    cigars?: Cigar[];
    tsgs?: TransIdxSigGroup[];
  }): ReplyProcessDecision {
    if (!args.route.startsWith("/loc/scheme")) {
      throw new ValidationError(
        `Unsupported route=${args.route} in reply message.`,
      );
    }
    const data = args.serder.ked?.a;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ValidationError("Missing one of eid/scheme/url in /loc/scheme reply.");
    }
    const eid = "eid" in data && typeof data.eid === "string" ? new Prefixer({ qb64: data.eid }).qb64 : null;
    const scheme = "scheme" in data && typeof data.scheme === "string" ? data.scheme : null;
    const url = "url" in data && typeof data.url === "string" ? data.url : null;
    if (!eid || !scheme || url === null) {
      throw new ValidationError(
        "Missing one of eid/scheme/url in /loc/scheme reply.",
      );
    }
    if (url) {
      const parsed = new URL(url);
      if (parsed.protocol && parsed.protocol.slice(0, -1) !== scheme) {
        throw new ValidationError(
          `URL ${url} does not match declared scheme ${scheme}.`,
        );
      }
    }

    const keys: [string, string] = [eid, scheme];
    if (this.rvy.db.inWriteTransaction) {
      throw new Error("Endpoint handler must own the reply transaction; process replies outside caller-owned writers");
    }

    let queryCues: readonly QueryCue[] = [];

    const decision = this.rvy.db.env!.transactionSync(() => {
      let osaider = this.rvy.db.lans.get(keys);
      if (osaider?.qb64 === args.diger.qb64) osaider = null;
      const plan = this.rvy.decideReply({
        serder: args.serder,
        saider: args.diger,
        route: "/loc/scheme",
        aid: eid,
        osaider,
        cigars: args.cigars,
        tsgs: args.tsgs,
      });
      queryCues = plan.cues;
      this.rvy.writeReply(plan);
      if (plan.kind === "unverified") {
        return unverifiedReplyDecision(`Unverified loc scheme reply URL=${url} SAID=${args.serder.said}`);
      }
      this.updateLoc(keys, args.diger, url);
      return acceptReplyDecision();
    });
    if (queryCues.length) this.rvy.cues.extend(queryCues);
    return decision;
  }
}
