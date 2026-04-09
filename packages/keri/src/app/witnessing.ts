/**
 * Witness host and controller-side receipting helpers.
 *
 * This module ports the missing operational slice around already-landed
 * receipt-core behavior:
 * - witness HTTP/TCP host ingress
 * - synchronous witness receipt endpoints
 * - controller-side witness submission, catchup, and receipt fanout
 *
 * Architectural rules:
 * - normal receipt/escrow decisions stay in `Kevery` and friends
 * - parser/router ownership stays inside the shared runtime/parser seams
 * - this module coordinates transports and host policies without coupling
 *   route handlers directly to parser internals
 */
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import {
  Cigar,
  concatBytes,
  Counter,
  createParser,
  CtrDexV1,
  Ilks,
  type SerderKERI,
  type Siger,
} from "../../../cesr/mod.ts";
import type { CueEmission } from "../core/cues.ts";
import { ValidationError } from "../core/errors.ts";
import { makeReceiptSerder } from "../core/messages.ts";
import { type Scheme, Schemes } from "../core/schemes.ts";
import { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import { type AgentRuntime, createAgentRuntime, settleRuntimeIngress } from "./agent-runtime.ts";
import { buildCesrRequest, inspectCesrRequest, splitCesrStream } from "./cesr-http.ts";
import type { Hab, Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandle } from "./httping.ts";
import { envelopesFromFrames } from "./parsering.ts";

const WitnessReceiptPollAttempts = 20;
const WitnessReceiptPollDelayMs = 100;
const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

/** Supported witness-auth payloads keyed by witness AID. */
export type WitnessAuthMap = Record<string, string>;

/** Host-side decision for `POST /receipts`. */
export type WitnessReceiptPostResult =
  | { kind: "accepted"; status: 200; body: Uint8Array }
  | { kind: "escrow"; status: 202 }
  | { kind: "reject"; status: number; message: string };

/** Host-side decision for `GET /receipts`. */
export type WitnessReceiptGetResult =
  | { kind: "accepted"; status: 200; body: Uint8Array }
  | { kind: "reject"; status: number; message: string };

/** Host-side decision for `GET /query`. */
export type WitnessQueryGetResult =
  | { kind: "accepted"; status: 200; body: Uint8Array }
  | { kind: "reject"; status: number; message: string };

/** Controller-side result of posting to one witness receipt endpoint. */
export type WitnessReceiptEndpointResponse =
  | {
    kind: "accepted";
    status: 200;
    body: Uint8Array;
    wigers: readonly Siger[];
    cigars: readonly Cigar[];
  }
  | { kind: "escrow"; status: 202 }
  | { kind: "reject"; status: number; message: string };

/** Result of one full witness receipt orchestration pass. */
export interface WitnessReceiptRunResult {
  readonly witnesses: readonly string[];
  readonly statuses: Readonly<Record<string, number>>;
}

/** Build one attached `rct` message carrying detached receipt material. */
function buildDetachedReceiptMessage(
  serder: SerderKERI,
  {
    wigers = [],
    cigars = [],
  }: {
    wigers?: readonly Siger[];
    cigars?: readonly Cigar[];
  },
): Uint8Array {
  if (wigers.length === 0 && cigars.length === 0) {
    return serder.raw;
  }

  const attachments: Uint8Array[] = [];
  if (wigers.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.WitnessIdxSigs,
        count: wigers.length,
        version: KERI_V1,
      }).qb64b,
      ...wigers.map((wiger) => wiger.qb64b),
    );
  }
  if (cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...cigars.flatMap((cigar) => {
        const verfer = cigar.verfer;
        if (!verfer) {
          throw new ValidationError("Detached non-transferable receipt is missing verifier context.");
        }
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }
  const atc = concatBytes(...attachments);

  if (atc.length % 4 !== 0) {
    throw new ValidationError("Witness receipt attachment group is not quadlet aligned.");
  }

  return concatBytes(
    serder.raw,
    new Counter({
      code: CtrDexV1.AttachmentGroup,
      count: atc.length / 4,
      version: KERI_V1,
    }).qb64b,
    atc,
  );
}

/**
 * Build one KERIpy-style endpoint `rct` message without an attachment-group
 * wrapper.
 *
 * KERIpy's witness `/receipts` endpoints return `rct + counter + material`
 * directly. KLI's receiptor depends on that exact shape when it re-fans the
 * returned receipt material out to the other witnesses.
 */
function buildEndpointDetachedReceiptMessage(
  serder: SerderKERI,
  {
    wigers = [],
    cigars = [],
  }: {
    wigers?: readonly Siger[];
    cigars?: readonly Cigar[];
  },
): Uint8Array {
  const parts: Uint8Array[] = [serder.raw];
  if (wigers.length > 0) {
    parts.push(
      new Counter({
        code: CtrDexV1.WitnessIdxSigs,
        count: wigers.length,
        version: KERI_V1,
      }).qb64b,
      ...wigers.map((wiger) => wiger.qb64b),
    );
  }
  if (cigars.length > 0) {
    parts.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...cigars.flatMap((cigar) => {
        const verfer = cigar.verfer;
        if (!verfer) {
          throw new ValidationError("Endpoint receipt couple is missing verifier context.");
        }
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }
  return concatBytes(...parts);
}

/** Build one attached `rct` message carrying witness indexed signatures. */
function buildWitnessReceiptMessage(
  serder: SerderKERI,
  wigers: readonly Siger[],
): Uint8Array {
  return buildEndpointDetachedReceiptMessage(serder, { wigers });
}

/** Parse one CESR message and recover its detached receipt attachments. */
function inspectReceiptMessage(
  bytes: Uint8Array,
): { serder: SerderKERI; wigers: readonly Siger[]; cigars: readonly Cigar[] } {
  const parser = createParser({
    framed: false,
    attachmentDispatchMode: "compat",
  });
  const envelopes = envelopesFromFrames(parser.feed(bytes), false);
  const envelope = envelopes[0];
  if (!envelope) {
    throw new ValidationError("Expected one witness receipt message.");
  }
  return {
    serder: envelope.serder,
    wigers: envelope.wigers,
    cigars: envelope.cigars,
  };
}

/** Read one HTTP response body fully under Effection control. */
function* readResponseBytes(response: Response): Operation<Uint8Array> {
  const buffer = yield* action<ArrayBuffer>((resolve, reject) => {
    response.arrayBuffer().then(resolve).catch(reject);
    return () => {};
  });
  return new Uint8Array(buffer);
}

/** Sleep for one short polling interval while staying cancellable. */
function* sleepMs(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}

/** Return the active wire-message habitat or `null` when selection is ambiguous. */
function cueHab(runtime: AgentRuntime, serviceHab?: Hab): Hab | null {
  if (serviceHab) {
    return serviceHab;
  }
  const habitats = [...runtime.hby.habs.values()];
  return habitats.length === 1 ? habitats[0] ?? null : null;
}

/**
 * Drain runtime cues through the selected habitat.
 *
 * The host keeps mailbox side effects here so synchronous HTTP/TCP route
 * handlers can inspect witness/receipt wire emissions before the outer runtime
 * loop sees them.
 */
function drainWitnessCues(
  runtime: AgentRuntime,
  serviceHab?: Hab,
): CueEmission[] {
  const hab = cueHab(runtime, serviceHab);
  if (!hab) {
    return [];
  }

  const emissions: CueEmission[] = [];
  for (const emission of hab.processCuesIter(runtime.cues)) {
    runtime.mailboxDirector.handleEmission(emission);
    emissions.push(emission);
  }
  return emissions;
}

/**
 * Parse and settle one inbound witness-host payload.
 *
 * This is the witness-host counterpart to generic runtime ingress.
 *
 * Responsibilities:
 * - settle one inbound CESR payload with the correct witness-local semantics
 * - immediately drain the resulting cues through the hosted witness habitat
 * - return those cue emissions so the caller can make any request-scoped
 *   response decision
 *
 * `local=true` is the crucial switch for the witness receipt path: accepted
 * events that list the hosted witness emit `witness` cues instead of ordinary
 * `receipt` cues.
 *
 * Durable routing rule:
 * - TCP witness ingress, witness `/receipts`, and ordinary HTTP root ingress
 *   that targets the hosted witness AID should all reach this seam when the
 *   host is acting as that witness
 * - generic runtime ingress should remain separate for mailbox streaming,
 *   `/ksn` replay publication, and other non-witness-root policies
 */
export function processWitnessIngress(
  runtime: AgentRuntime,
  serviceHab: Hab,
  bytes: Uint8Array,
  { local = false }: { local?: boolean } = {},
): CueEmission[] {
  settleRuntimeIngress(runtime, [bytes], { local });
  return drainWitnessCues(runtime, serviceHab);
}

/** Resolve the authoritative witness list for one accepted event. */
function acceptedEventWitnesses(
  db: Baser,
  serder: SerderKERI,
): string[] | null {
  const pre = serder.pre;
  const said = serder.said;
  if (!pre || !said) {
    return null;
  }

  const stored = db.wits.get(dgKey(pre, said)).map((wit) => wit.qb64);
  if (stored.length > 0) {
    return stored;
  }
  if (serder.ilk === Ilks.icp || serder.ilk === Ilks.dip) {
    return [...serder.backs];
  }
  const kever = db.getKever(pre);
  return kever ? [...kever.wits] : null;
}

/** Decide whether the hosted witness can currently return a synchronous receipt. */
function witnessReceiptEligibility(
  serviceHab: Hab,
  serder: SerderKERI,
): { kind: "accept"; accepted: SerderKERI } | { kind: "escrow" } | { kind: "reject"; message: string } {
  const pre = serder.pre;
  const said = serder.said;
  if (!pre || said === null) {
    return { kind: "reject", message: "Receipted event must expose pre, sn, and said." };
  }

  const kever = serviceHab.db.getKever(pre);
  if (!kever) {
    return { kind: "escrow" };
  }
  if (!kever.wits.includes(serviceHab.pre)) {
    return {
      kind: "reject",
      message: `${serviceHab.pre} is not an authorized witness for ${pre}:${said}: wits=${JSON.stringify(kever.wits)}.`,
    };
  }

  return { kind: "accept", accepted: serder };
}

/** Handle the synchronous witness receipt POST policy. */
export function witnessReceiptPost(
  runtime: AgentRuntime,
  serviceHab: Hab,
  bytes: Uint8Array,
): WitnessReceiptPostResult {
  const serder = inspectCesrRequest(bytes);
  if (!serder) {
    return { kind: "reject", status: 400, message: "Invalid CESR request" };
  }
  if (
    serder.ilk !== Ilks.icp
    && serder.ilk !== Ilks.rot
    && serder.ilk !== Ilks.ixn
    && serder.ilk !== Ilks.dip
    && serder.ilk !== Ilks.drt
  ) {
    return {
      kind: "reject",
      status: 400,
      message: `invalid event type (${serder.ilk}) for receipting`,
    };
  }

  processWitnessIngress(runtime, serviceHab, bytes, {
    local: true,
  });
  const eligibility = witnessReceiptEligibility(serviceHab, serder);
  if (eligibility.kind === "reject") {
    return { kind: "reject", status: 400, message: eligibility.message };
  }
  if (eligibility.kind === "escrow") {
    return { kind: "escrow", status: 202 };
  }

  const inspected = inspectReceiptMessage(serviceHab.receipt(eligibility.accepted));
  const body = buildEndpointDetachedReceiptMessage(inspected.serder, {
    wigers: inspected.wigers,
    cigars: inspected.cigars,
  });
  return { kind: "accepted", status: 200, body };
}

/** Handle `GET /receipts` witness retrieval. */
export function witnessReceiptGet(
  serviceHab: Hab,
  query: { pre?: string | null; sn?: number | null; said?: string | null },
): WitnessReceiptGetResult {
  const pre = query.pre ?? null;
  if (!pre) {
    return {
      kind: "reject",
      status: 400,
      message: "query param 'pre' is required",
    };
  }

  let said = query.said ?? null;
  if (query.sn === null && !said) {
    return {
      kind: "reject",
      status: 400,
      message: "either 'sn' or 'said' query param is required",
    };
  }
  if (query.sn !== null && query.sn !== undefined) {
    said = serviceHab.db.kels.getLast(pre, query.sn);
  }
  if (!said) {
    return {
      kind: "reject",
      status: 404,
      message: `event for ${pre} at ${String(query.sn ?? "")} (${String(said)}) not found`,
    };
  }

  const serder = serviceHab.db.getEvtSerder(pre, said);
  if (!serder) {
    return {
      kind: "reject",
      status: 404,
      message: `Missing event for dig=${said}.`,
    };
  }

  const wits = acceptedEventWitnesses(serviceHab.db, serder);
  if (!wits || !wits.includes(serviceHab.pre)) {
    return {
      kind: "reject",
      status: 400,
      message: `${serviceHab.pre} is not a valid witness for ${pre} event at ${serder.sn}.`,
    };
  }

  const reserder = makeReceiptSerder(pre, serder.sn ?? 0, said);
  const body = buildWitnessReceiptMessage(
    reserder,
    serviceHab.db.wigs.get(dgKey(pre, said)),
  );
  return { kind: "accepted", status: 200, body };
}

/** Handle `GET /query` witness log replay. */
export function witnessQueryGet(
  serviceHab: Hab,
  query: { typ?: string | null; pre?: string | null; sn?: number | null },
): WitnessQueryGetResult {
  const typ = query.typ ?? null;
  if (!typ) {
    return {
      kind: "reject",
      status: 400,
      message: "'typ' query param is required",
    };
  }

  if (typ === "kel") {
    const pre = query.pre ?? null;
    if (!pre) {
      return {
        kind: "reject",
        status: 400,
        message: "'pre' query param is required",
      };
    }

    const parts: Uint8Array[] = [];
    if (query.sn !== null && query.sn !== undefined) {
      const first = serviceHab.db.kels.getLast(pre, query.sn);
      if (!first) {
        return {
          kind: "reject",
          status: 400,
          message: `non-existent event at seq-num ${query.sn}`,
        };
      }
      for (const said of serviceHab.db.kels.getAllIter(pre, query.sn)) {
        const fn = serviceHab.db.getFelFn(pre, said);
        if (fn === null) {
          continue;
        }
        try {
          parts.push(serviceHab.db.cloneEvtMsg(pre, fn, said));
        } catch {
          continue;
        }
      }
    } else {
      parts.push(...serviceHab.db.clonePreIter(pre));
    }

    return {
      kind: "accepted",
      status: 200,
      body: parts.length === 0 ? new Uint8Array() : concatBytes(...parts),
    };
  }

  if (typ === "tel") {
    return {
      kind: "reject",
      status: 501,
      message: "TEL witness query replay is not yet available in tufa.",
    };
  }

  return {
    kind: "reject",
    status: 400,
    message: "unknown query type.",
  };
}

/** Return the full advertised scheme map for one witness endpoint. */
function witnessUrls(
  hab: Hab,
  witness: string,
): Record<string, string> {
  return hab.fetchUrls(witness);
}

/** Resolve the HTTP or HTTPS witness endpoint when available. */
function witnessHttpUrl(
  hab: Hab,
  witness: string,
): string | null {
  const urls = witnessUrls(hab, witness);
  return urls[Schemes.https] ?? urls[Schemes.http] ?? null;
}

/** Resolve the TCP witness endpoint when available. */
function witnessTcpUrl(
  hab: Hab,
  witness: string,
): string | null {
  const urls = witnessUrls(hab, witness);
  return urls[Schemes.tcp] ?? null;
}

/** Choose the generic witness transport URL: HTTP first, TCP fallback second. */
function preferredWitnessTransportUrl(
  hab: Hab,
  witness: string,
): string | null {
  return witnessHttpUrl(hab, witness) ?? witnessTcpUrl(hab, witness);
}

/** Build one `loc/scheme` replay bundle for witness introductions. */
function witnessSchemeReplies(
  hab: Hab,
  eids: readonly string[],
): Uint8Array {
  const replies = eids
    .map((eid) => hab.loadLocScheme(eid))
    .filter((msg) => msg.length > 0);
  return replies.length === 0 ? new Uint8Array() : concatBytes(...replies);
}

/** Return the exact locally accepted event message at `(pre, sn)`. */
function ownEventMessage(
  hby: Habery,
  pre: string,
  sn: number,
): { serder: SerderKERI; message: Uint8Array } {
  const said = hby.db.kels.getLast(pre, sn);
  if (!said) {
    throw new ValidationError(`Missing accepted event at ${pre}:${sn.toString(16)}.`);
  }
  const serder = hby.db.getEvtSerder(pre, said);
  if (!serder) {
    throw new ValidationError(`Missing accepted event body for ${pre}:${said}.`);
  }
  const fn = hby.db.getFelFn(pre, said);
  if (fn === null) {
    throw new ValidationError(`Missing first-seen ordinal for ${pre}:${said}.`);
  }
  return { serder, message: hby.db.cloneEvtMsg(pre, fn, said) };
}

/** Post one generic witness message using HTTP or TCP according to known URLs. */
function* sendWitnessMessage(
  hab: Hab,
  witness: string,
  bytes: Uint8Array,
  auth?: string,
): Operation<void> {
  const url = preferredWitnessTransportUrl(hab, witness);
  if (!url) {
    throw new ValidationError(
      `Unable to find a valid endpoint for witness ${witness}.`,
    );
  }

  const parsed = new URL(url);
  if (parsed.protocol === "tcp:") {
    yield* sendTcpWitnessMessage(url, bytes);
    return;
  }

  for (const part of splitCesrStream(bytes)) {
    const request = buildCesrRequest(part, {
      destination: witness,
    });
    const { response } = yield* fetchResponseHandle(url, {
      method: "POST",
      headers: {
        ...request.headers,
        ...(auth ? { Authorization: auth } : {}),
      },
      body: request.body,
    });
    if (!response.ok) {
      const body = yield* readResponseBytes(response);
      throw new ValidationError(
        `Witness delivery to ${witness} failed with HTTP ${response.status}: ${new TextDecoder().decode(body)}`,
      );
    }
    yield* closeResponseBody(response);
  }
}

/** Send one raw CESR stream to a TCP witness and close the socket after flush. */
function* sendTcpWitnessMessage(
  url: string,
  bytes: Uint8Array,
): Operation<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "tcp:") {
    throw new ValidationError(`Witness TCP URL must use tcp:, got ${url}`);
  }
  const port = parsed.port.length > 0 ? Number(parsed.port) : NaN;
  if (!Number.isFinite(port)) {
    throw new ValidationError(`Witness TCP URL is missing a valid port: ${url}`);
  }

  yield* action<void>((resolve, reject) => {
    const socket = createConnection({
      host: parsed.hostname,
      port,
    });
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.end(bytes);
    });
    socket.once("close", (hadError) => {
      if (!hadError) {
        resolve(undefined);
      }
    });
    return () => {
      socket.destroy();
    };
  });
}

/** Poll one witness `GET /receipts` endpoint until the receipt becomes available. */
function* pollWitnessReceipt(
  hab: Hab,
  witness: string,
  pre: string,
  sn: number,
  said: string,
): Operation<WitnessReceiptEndpointResponse> {
  const httpUrl = witnessHttpUrl(hab, witness);
  if (!httpUrl) {
    return {
      kind: "reject",
      status: 400,
      message: `Witness ${witness} does not advertise an HTTP(S) endpoint for receipt polling.`,
    };
  }

  for (let attempt = 0; attempt < WitnessReceiptPollAttempts; attempt += 1) {
    const response = yield* getWitnessReceiptEndpoint(hab, witness, {
      pre,
      sn,
      said,
    });
    if (response.kind === "accepted") {
      return response;
    }
    if (response.kind === "reject" && response.status !== 404) {
      return response;
    }
    yield* sleepMs(WitnessReceiptPollDelayMs);
  }

  return {
    kind: "reject",
    status: 408,
    message: `Timed out waiting for witness receipt from ${witness}.`,
  };
}

/** Request one witness receipt via `POST /receipts`. */
function* postWitnessReceiptEndpoint(
  hab: Hab,
  witness: string,
  message: Uint8Array,
  auth?: string,
): Operation<WitnessReceiptEndpointResponse> {
  const url = witnessHttpUrl(hab, witness);
  if (!url) {
    return {
      kind: "reject",
      status: 400,
      message: `Witness ${witness} does not advertise an HTTP(S) receipt endpoint.`,
    };
  }

  const request = buildCesrRequest(message, {
    destination: witness,
  });
  const responseUrl = new URL(url);
  responseUrl.pathname = `${responseUrl.pathname.replace(/\/+$/, "") || ""}/receipts`;
  const { response } = yield* fetchResponseHandle(responseUrl.toString(), {
    method: "POST",
    headers: {
      ...request.headers,
      ...(auth ? { Authorization: auth } : {}),
    },
    body: request.body,
  });
  if (response.status === 202) {
    yield* closeResponseBody(response);
    return { kind: "escrow", status: 202 };
  }
  if (response.status !== 200) {
    const body = yield* readResponseBytes(response);
    return {
      kind: "reject",
      status: response.status,
      message: new TextDecoder().decode(body),
    };
  }
  const body = yield* readResponseBytes(response);
  const inspected = inspectReceiptMessage(body);
  return {
    kind: "accepted",
    status: 200,
    body,
    wigers: inspected.wigers,
    cigars: inspected.cigars,
  };
}

/** Request one stored witness receipt via `GET /receipts`. */
function* getWitnessReceiptEndpoint(
  hab: Hab,
  witness: string,
  query: { pre: string; sn?: number; said?: string },
): Operation<WitnessReceiptEndpointResponse> {
  const url = witnessHttpUrl(hab, witness);
  if (!url) {
    return {
      kind: "reject",
      status: 400,
      message: `Witness ${witness} does not advertise an HTTP(S) receipt endpoint.`,
    };
  }
  const endpoint = new URL(url);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "") || ""}/receipts`;
  endpoint.searchParams.set("pre", query.pre);
  if (query.sn !== undefined) {
    endpoint.searchParams.set("sn", String(query.sn));
  }
  if (query.said) {
    endpoint.searchParams.set("said", query.said);
  }

  const { response } = yield* fetchResponseHandle(endpoint.toString(), {
    method: "GET",
  });
  if (response.status !== 200) {
    const body = yield* readResponseBytes(response);
    return {
      kind: "reject",
      status: response.status,
      message: new TextDecoder().decode(body),
    };
  }
  const body = yield* readResponseBytes(response);
  const inspected = inspectReceiptMessage(body);
  return {
    kind: "accepted",
    status: 200,
    body,
    wigers: inspected.wigers,
    cigars: inspected.cigars,
  };
}

/**
 * Controller-side synchronous witness receipt orchestration.
 *
 * Responsibilities:
 * - publish the current event to each witness `/receipts` endpoint
 * - catch up newly added witnesses before receipting
 * - persist returned receipts locally through the shared runtime path
 * - fan witness receipts out to the complementary witnesses
 */
export class Receiptor {
  readonly hby: Habery;

  constructor(hby: Habery) {
    this.hby = hby;
  }

  /** Submit the latest or specified event to all witnesses and gather receipts. */
  *receipt(
    pre: string,
    {
      sn,
      auths = {},
    }: {
      sn?: number;
      auths?: WitnessAuthMap;
    } = {},
  ): Operation<WitnessReceiptRunResult> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }

    const eventSn = sn ?? kever.sn;
    const { serder, message } = ownEventMessage(this.hby, pre, eventSn);
    const witnesses = [...kever.wits];
    if (witnesses.length === 0) {
      return { witnesses: [], statuses: {} };
    }

    if (serder.ilk === Ilks.rot || serder.ilk === Ilks.drt) {
      for (const witness of serder.adds) {
        yield* this.catchup(pre, witness);
      }
    }

    const runtime = yield* createAgentRuntime(this.hby, { mode: "local" });
    try {
      const receiptGroups = new Map<
        string,
        { readonly wigers: readonly Siger[]; readonly cigars: readonly Cigar[] }
      >();
      const statuses: Record<string, number> = {};
      const said = serder.said;
      if (!said) {
        throw new ValidationError("Local event must expose a SAID before witness receipting.");
      }

      for (const witness of witnesses) {
        if (kever.delegated) {
          for (const dmsg of this.hby.db.cloneDelegation(kever)) {
            yield* sendWitnessMessage(hab, witness, dmsg);
          }
        }

        let response = yield* postWitnessReceiptEndpoint(
          hab,
          witness,
          message,
          auths[witness],
        );
        if (response.kind === "escrow") {
          response = yield* pollWitnessReceipt(hab, witness, pre, eventSn, said);
        }
        statuses[witness] = response.status;
        if (response.kind !== "accepted") {
          const detail = response.kind === "reject"
            ? response.message
            : "receipt remained escrowed";
          throw new ValidationError(
            `Witness ${witness} failed to receipt ${pre}:${eventSn.toString(16)}: ${detail}`,
          );
        }

        receiptGroups.set(witness, {
          wigers: response.wigers,
          cigars: response.cigars,
        });
        settleRuntimeIngress(runtime, [response.body], { local: false });
      }

      for (const witness of witnesses) {
        const complements = [...receiptGroups.entries()]
          .filter(([current]) => current !== witness)
          .map(([, evidence]) => evidence);
        const otherWigers = complements.flatMap((evidence) => [...evidence.wigers]);
        const otherCigars = complements.flatMap((evidence) => [...evidence.cigars]);
        if (otherWigers.length === 0 && otherCigars.length === 0) {
          continue;
        }

        const introWitnesses = witnesses.filter((current) => current !== witness && receiptGroups.has(current));
        const parts: Uint8Array[] = [];
        if (
          serder.ilk === Ilks.icp
          || serder.ilk === Ilks.dip
          || ((serder.ilk === Ilks.rot || serder.ilk === Ilks.drt) && serder.adds.includes(witness))
        ) {
          const schemes = witnessSchemeReplies(hab, introWitnesses);
          if (schemes.length > 0) {
            parts.push(schemes);
          }
        }
        parts.push(
          buildDetachedReceiptMessage(
            makeReceiptSerder(pre, eventSn, said),
            {
              wigers: otherWigers,
              cigars: otherCigars,
            },
          ),
        );
        yield* sendWitnessMessage(hab, witness, concatBytes(...parts));
      }

      return { witnesses, statuses };
    } finally {
      yield* runtime.close();
    }
  }

  /** Query a stored witness receipt and apply it to local state when found. */
  *get(
    pre: string,
    {
      sn,
      said,
    }: {
      sn?: number;
      said?: string;
    } = {},
  ): Operation<boolean> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const witness = [...kever.wits].sort()[0];
    if (!witness) {
      return false;
    }

    const response = yield* getWitnessReceiptEndpoint(hab, witness, {
      pre,
      sn: sn ?? kever.sn,
      said,
    });
    if (response.kind !== "accepted") {
      return false;
    }

    const runtime = yield* createAgentRuntime(this.hby, { mode: "local" });
    try {
      settleRuntimeIngress(runtime, [response.body], { local: false });
      return true;
    } finally {
      yield* runtime.close();
    }
  }

  /** Catch one witness up to the current accepted KEL before receipting. */
  *catchup(
    pre: string,
    witness: string,
  ): Operation<void> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }

    const kever = hab.kever;
    if (kever?.delegated) {
      for (const msg of this.hby.db.cloneDelegation(kever)) {
        yield* sendWitnessMessage(hab, witness, msg);
      }
    }
    for (const msg of this.hby.db.clonePreIter(pre)) {
      yield* sendWitnessMessage(hab, witness, msg);
    }
  }
}

/**
 * Higher-level full witness submission helper.
 *
 * This keeps the KERIpy mental model visible at the API boundary even though
 * the current TS implementation reuses the synchronous receipt endpoint path
 * internally for receipt gathering.
 */
export class WitnessReceiptor {
  readonly receiptor: Receiptor;
  readonly hby: Habery;
  readonly force: boolean;

  constructor(
    hby: Habery,
    { force = false }: { force?: boolean } = {},
  ) {
    this.hby = hby;
    this.force = force;
    this.receiptor = new Receiptor(hby);
  }

  /** Ensure the current event reaches full witness receipt convergence. */
  *submit(
    pre: string,
    {
      sn,
      auths = {},
    }: {
      sn?: number;
      auths?: WitnessAuthMap;
    } = {},
  ): Operation<WitnessReceiptRunResult> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const eventSn = sn ?? kever.sn;
    const said = this.hby.db.kels.getLast(pre, eventSn);
    const currentWitnessCount = said
      ? this.hby.db.wigs.get(dgKey(pre, said)).length
      : 0;
    if (!this.force && currentWitnessCount >= kever.wits.length) {
      const statuses = Object.fromEntries(
        kever.wits.map((witness: string) => [witness, 200]),
      );
      return { witnesses: [...kever.wits], statuses };
    }
    return yield* this.receiptor.receipt(pre, { sn: eventSn, auths });
  }
}

/** Minimal close/wait contract for the TCP witness server. */
interface RunningWitnessTcpServer {
  readonly finished: Promise<void>;
  close(): void;
}

/** Read the whole inbound TCP payload before handing it to the runtime. */
async function readSocketBytes(socket: Socket): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.on("data", (chunk) => {
      chunks.push(new Uint8Array(chunk));
    });
    socket.once("end", resolve);
    socket.once("error", reject);
    socket.once("close", () => resolve());
  });
  return chunks.length === 0 ? new Uint8Array() : concatBytes(...chunks);
}

/** Process one accepted TCP witness connection. */
async function handleWitnessSocket(
  socket: Socket,
  runtime: AgentRuntime,
  serviceHab: Hab,
): Promise<void> {
  try {
    const bytes = await readSocketBytes(socket);
    if (bytes.length > 0) {
      processWitnessIngress(runtime, serviceHab, bytes, { local: true });
    }
  } finally {
    socket.destroy();
  }
}

/** Open one raw TCP witness ingress host. */
function openWitnessTcpServer(
  port: number,
  hostname: string,
  runtime: AgentRuntime,
  serviceHab: Hab,
): RunningWitnessTcpServer {
  const server: Server = createServer((socket) => {
    void handleWitnessSocket(socket, runtime, serviceHab).catch(() => {
      socket.destroy();
    });
  });

  const finished = new Promise<void>((resolve, reject) => {
    server.once("close", resolve);
    server.once("error", reject);
  });
  server.listen(port, hostname);

  return {
    finished,
    close() {
      if (server.listening) {
        server.close();
      }
    },
  };
}

/** Adapt the TCP server promise lifecycle into Effection. */
export function* startWitnessTcpServer(
  port: number,
  hostname: string,
  runtime: AgentRuntime,
  serviceHab: Hab,
): Operation<void> {
  const server = openWitnessTcpServer(port, hostname, runtime, serviceHab);
  try {
    yield* action((resolve, reject) => {
      server.finished.then(resolve).catch(reject);
      return () => {};
    });
  } finally {
    server.close();
  }
}
