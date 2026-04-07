import { action, type Operation } from "npm:effection@^3.6.0";
import {
  type Cigar,
  Dater,
  Diger,
  Prefixer,
  Saider,
  Seqner,
  type SerderKERI,
  type Siger,
  type Texter,
} from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { PathedMaterialGroup, TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { Kever } from "../core/kever.ts";
import { makeExchangeSerder } from "../core/messages.ts";
import { Roles } from "../core/roles.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import { buildCesrRequest, type CesrBodyMode, splitCesrStream } from "./cesr-http.ts";
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
  verify?(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    essrs: readonly Texter[];
  }): boolean;
  handle(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
    essrs: readonly Texter[];
  }): void;
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

  constructor(
    hby: Habery,
    {
      handlers = [],
      cues,
    }: {
      handlers?: readonly ExchangeRouteHandler[];
      cues?: Deck<AgentCue>;
    } = {},
  ) {
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
  processEvent(args: {
    serder: SerderKERI;
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    ptds?: readonly PathedMaterialGroup[];
    essrs?: readonly Texter[];
  }): ExchangeDecision {
    const said = args.serder.said ?? "<unknown>";
    if (args.serder.ilk !== "exn") {
      return {
        kind: "reject",
        reason: `Unsupported exchange ilk ${args.serder.ilk}.`,
        said,
      };
    }

    const sender = args.serder.pre;
    if (!sender) {
      return {
        kind: "reject",
        reason: "Exchange message is missing sender AID.",
        said,
      };
    }

    const attachments = normalizeAttachments(args.ptds ?? []);
    const essrs = [...(args.essrs ?? [])];
    const route = args.serder.route ?? "";
    const handler = this.routes.get(route);

    const verification = this.verifySignatures({
      serder: args.serder,
      sender,
      tsgs: [...(args.tsgs ?? [])],
      cigars: [...(args.cigars ?? [])],
      ptds: [...(args.ptds ?? [])],
      essrs,
    });
    if (verification.kind !== "verified") {
      return verification;
    }

    if (
      handler?.verify && !handler.verify({
        serder: args.serder,
        attachments,
        essrs,
      })
    ) {
      return {
        kind: "reject",
        reason: `Exchange route ${route} failed handler verification.`,
        said,
      };
    }

    this.removeEscrow(said);
    this.logAcceptedEvent({
      serder: args.serder,
      tsgs: verification.tsgs,
      cigars: verification.cigars,
      ptds: [...(args.ptds ?? [])],
      essrs,
    });

    handler?.handle({
      serder: args.serder,
      attachments,
      essrs,
    });

    return { kind: "accept", said };
  }

  /** Retry any partially signed exchange escrows that are still fresh enough to matter. */
  processEscrows(): void {
    for (const [keys, serder] of this.hby.db.epse.getTopItemIter()) {
      const said = keys[0];
      if (!said) {
        continue;
      }

      const dater = this.hby.db.epsd.get([said]);
      if (!dater) {
        this.removeEscrow(said);
        continue;
      }
      if (
        Date.now() - new Date(dater.iso8601).getTime()
          > EXCHANGE_ESCROW_TIMEOUT_MS
      ) {
        this.removeEscrow(said);
        continue;
      }

      const decision = this.processEvent({
        serder,
        tsgs: this.rebuildEscrowedGroups(said),
        cigars: this.hby.db.ecigs.get([said]).map(([, cigar]) => cigar),
        ptds: this.hby.db.epath.get([said]).map((text) => PathedMaterialGroup.fromRaw(new TextEncoder().encode(text))),
        essrs: this.hby.db.essrs.get([said]),
      });

      if (decision.kind === "accept" || decision.kind === "reject") {
        this.removeEscrow(said);
      }
    }
  }

  /** Return true once the named exchange SAID is durably stored as accepted. */
  complete(said: string): boolean {
    return this.hby.db.exns.get([said])?.said === said;
  }

  private verifySignatures(args: {
    serder: SerderKERI;
    sender: string;
    tsgs: readonly TransIdxSigGroup[];
    cigars: readonly Cigar[];
    ptds: readonly PathedMaterialGroup[];
    essrs: readonly Texter[];
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

      for (const tsg of args.tsgs) {
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
          this.escrowPartialSigned(
            args.serder,
            args.tsgs,
            args.ptds,
            args.essrs,
          );
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
          this.escrowPartialSigned(
            args.serder,
            args.tsgs,
            args.ptds,
            args.essrs,
          );
          this.cues.push({ kin: "query", pre: tsg.pre, q: { pre: tsg.pre } });
          return {
            kind: "escrow",
            reason: `Exchange ${args.serder.said ?? "<unknown>"} does not yet satisfy sender threshold.`,
            said: args.serder.said ?? "<unknown>",
          };
        }

        verifiedGroups.push(
          new PathedTransIdxSigGroup(tsg, verified.sigers).group,
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

    this.escrowPartialSigned(args.serder, args.tsgs, args.ptds, args.essrs);
    return {
      kind: "escrow",
      reason: "Exchange message has no signatures yet.",
      said: args.serder.said ?? "<unknown>",
    };
  }

  private escrowPartialSigned(
    serder: SerderKERI,
    tsgs: readonly TransIdxSigGroup[],
    ptds: readonly PathedMaterialGroup[],
    essrs: readonly Texter[],
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
    this.hby.db.epsd.pin(
      [said],
      new Dater({
        qb64: encodeDateTimeToDater(makeNowIso8601()),
      }),
    );
    this.hby.db.epath.pin(
      [said],
      ptds.map((group) => textDecoder.decode(group.raw)),
    );
    for (const essr of essrs) {
      this.hby.db.essrs.add([said], essr);
    }
  }

  private logAcceptedEvent(args: {
    serder: SerderKERI;
    tsgs: readonly TransIdxSigGroup[];
    cigars: readonly Cigar[];
    ptds: readonly PathedMaterialGroup[];
    essrs: readonly Texter[];
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
    for (const essr of args.essrs) {
      this.hby.db.essrs.add([said], essr);
    }

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

  private removeEscrow(said: string): void {
    this.hby.db.epse.rem([said]);
    this.hby.db.epsd.rem([said]);
    this.hby.db.esigs.trim([said, ""], { topive: false });
    this.hby.db.ecigs.rem([said]);
    this.hby.db.epath.rem([said]);
    this.hby.db.essrs.rem([said]);
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

  const serder = makeExchangeSerder(args.route, args.payload, {
    sender: hab.pre,
    recipient: args.recipient,
    modifiers: args.modifiers,
    stamp: args.date,
    dig: args.dig,
  });
  const message = hab.endorse(serder, { pipelined: false });
  const response = yield* postCesrMessage(
    url,
    message,
    "header",
    args.recipient,
  );
  yield* closeResponseBody(response);
  if (!response.ok) {
    throw new ValidationError(
      `Exchange delivery to ${url} failed with HTTP ${response.status}.`,
    );
  }

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

function* postCesrMessage(
  url: string,
  body: Uint8Array,
  bodyMode: CesrBodyMode,
  destination?: string,
): Operation<Response> {
  const requests = bodyMode === "header" ? splitCesrStream(body) : [body];
  let lastResponse: Response | null = null;

  for (const currentBody of requests) {
    const request = buildCesrRequest(currentBody, {
      bodyMode,
      destination,
    });
    const response = yield* action<Response>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      fetch(url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      }).then((current) => {
        settled = true;
        resolve(current);
      }).catch(reject);

      return () => {
        if (!settled) {
          controller.abort();
        }
      };
    });

    if (lastResponse) {
      yield* closeResponseBody(lastResponse);
    }
    lastResponse = response;
    if (!response.ok) {
      return response;
    }
  }

  if (!lastResponse) {
    throw new ValidationError("No CESR HTTP request was generated for delivery.");
  }

  return lastResponse;
}

function* closeResponseBody(response: Response): Operation<void> {
  if (!response.body) {
    return;
  }

  yield* action((resolve, reject) => {
    response.body!.cancel().then(() => resolve(undefined)).catch(reject);
    return () => {};
  });
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

/**
 * Small helper that keeps group reconstruction intent readable when replacing
 * one raw parser group with its verified signature subset.
 */
class PathedTransIdxSigGroup {
  readonly group: TransIdxSigGroup;

  constructor(group: TransIdxSigGroup, sigers: readonly Siger[]) {
    this.group = new TransIdxSigGroup(
      group.prefixer,
      group.seqner,
      group.diger,
      sigers,
    );
  }
}
