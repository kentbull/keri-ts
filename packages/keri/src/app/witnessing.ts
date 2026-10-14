/**
 * Witness host and controller-side receipting helpers.
 *
 * This module ports the missing operational slice around already-landed
 * receipt-core behavior:
 * - witness receipt/query decision helpers
 * - witness-local ingress processing
 * - synchronous witness receipt endpoints
 * - controller-side witness submission, catchup, and receipt fanout
 *
 * Architectural rules:
 * - normal receipt/escrow decisions stay in `Kevery` and friends
 * - parser/router ownership stays inside the shared runtime/parser seams
 * - concrete listener ownership lives in `tufa`; this module stays on the
 *   protocol/runtime side of that boundary
 */
import {
  Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
  discardFrame,
  Ilks,
  type SerderKERI,
  type Siger,
} from "cesr-ts";
import { toEffectionFrames } from "cesr-ts/effection";
import { action, call, each, type Operation, resource, spawn } from "npm:effection@^3.6.0";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { ValidationError } from "../core/errors.ts";
import { receipt as receiptEvent, reply as replyEvent } from "../core/protocol-eventing.ts";
import { type Scheme, Schemes } from "../core/schemes.ts";
import { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import { abortable } from "./abortable.ts";
import { type AgentRuntime, createAgentRuntime, settleRuntimeIngress } from "./agent-runtime.ts";
import { chunkBytes, collectBytes, streamBytes } from "./byte-source.ts";
import { postCesr } from "./cesr-egress.ts";
import {
  buildCesrRequest,
  CESR_CONTENT_TYPE,
  inspectCesrRequest,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "./cesr-http.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "./habbing.ts";
import { closeResponseBody, fetchResponseHandle } from "./httping.ts";
import { envelopeFromFrame } from "./parsering.ts";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { sendCesrTcp } from "./tcp-egress.ts";

const WitnessReceiptPollAttempts = 20;
const WitnessReceiptPollDelayMs = 100;
const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);
const KERIPY_CONTENT_TYPE_ERROR = "content type";
const WITNESS_HTTP_CONTENT_TYPES = [
  CESR_CONTENT_TYPE,
  KERIPY_CESR_JSON_CONTENT_TYPE,
] as const;

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
  | { kind: "accepted"; status: 200; messages: Iterable<Uint8Array> }
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
          throw new ValidationError(
            "Detached non-transferable receipt is missing verifier context.",
          );
        }
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }
  const atc = concatBytes(...attachments);

  if (atc.length % 4 !== 0) {
    throw new ValidationError(
      "Witness receipt attachment group is not quadlet aligned.",
    );
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
          throw new ValidationError(
            "Endpoint receipt couple is missing verifier context.",
          );
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

/** Parse exactly one finite receipt while keeping parser and payload cleanup inside this operation. */
function inspectReceiptMessage(
  bytes: Uint8Array,
): Operation<{ serder: SerderKERI; wigers: readonly Siger[]; cigars: readonly Cigar[] }> {
  return call(function*() {
    const channel = yield* toEffectionFrames((signal) => chunkBytes(bytes, { signal }));
    let result: { serder: SerderKERI; wigers: readonly Siger[]; cigars: readonly Cigar[] } | undefined;
    for (const frame of yield* each(channel.frames)) {
      if (frame.essr || frame.nests?.length) {
        yield* resource<void>(function*(provide) {
          try {
            yield* provide();
          } finally {
            yield* call(() => discardFrame(frame));
          }
        });
      }
      if (result) throw new ValidationError("Expected one witness receipt message.");
      const envelope = envelopeFromFrame(frame, false);
      result = { serder: envelope.serder, wigers: envelope.wigers, cigars: envelope.cigars };
      yield* each.next();
    }
    if (!result) throw new ValidationError("Expected one witness receipt message.");
    return result;
  });
}

/** Receipt endpoints return one finite proof; cancellation joins the reader before leaving this operation. */
function* readResponseBytes(response: Response, limit = 1024 * 1024): Operation<Uint8Array> {
  return yield* abortable((signal) => collectBytes(streamBytes(response.body, { signal }), limit));
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
 * Consume explicit cues under Reactor.settle, using the selected habitat.
 *
 * The host keeps mailbox side effects here so synchronous HTTP/TCP route
 * handlers can inspect witness/receipt wire emissions before the outer runtime
 * loop sees them.
 */
export function* drainWitnessCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Iterable<AgentCue>,
  {
    deliver = true,
  }: {
    deliver?: boolean;
  } = {},
): Operation<CueEmission[]> {
  const emissions: CueEmission[] = [];
  yield* consumeWitnessCues(runtime, serviceHab, cues, deliver, function*(emission) {
    emissions.push(emission);
  });
  return emissions;
}

/** Consume each borrowed emission under its current settle turn without an aggregate result. */
function* consumeWitnessCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Iterable<AgentCue>,
  deliver: boolean,
  consume?: (emission: CueEmission) => Operation<void>,
): Operation<void> {
  const hab = cueHab(runtime, serviceHab);
  if (!hab) return;
  for (const emission of hab.processCuesIter(cues)) {
    if (deliver) yield* runtime.respondant.sendWithHab(emission, hab);
    if (consume) yield* consume(emission);
  }
}

/** Witness-local dispatch and existing responder delivery policy for one ingress source. */
export interface WitnessIngressOptions {
  /** Accept with witness-local semantics; default false preserves ordinary ingress policy. */
  local?: boolean;
  /** Deliver through the existing responder; receipts use false to produce their own finite proof. */
  deliver?: boolean;
}

/**
 * Own one progressive witness parser and settle each frame before requesting more input.
 * Consume emissions individually, without retaining an aggregate result. The callback
 * borrows its emission under Reactor's guard/current frame lifetime. Retaining work
 * requires independently admitted ownership transfer; never retain lazy owners or
 * reenter guarded Reactor work. Source abort/cleanup belongs to the
 * parser scope. Existing responder delivery stays guarded until bounded handoff adoption.
 */
export function* processWitnessIngressSource(
  runtime: AgentRuntime,
  serviceHab: Hab,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  { local = false, deliver = true }: WitnessIngressOptions = {},
  consume?: (emission: CueEmission) => Operation<void>,
): Operation<void> {
  yield* runtime.reactor.process(source, { local, escrows: true }, function*() {
    yield* consumeWitnessCues(runtime, serviceHab, runtime.cues, deliver, consume);
  });
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
export function* processWitnessIngress(
  runtime: AgentRuntime,
  serviceHab: Hab,
  bytes: Uint8Array,
  options: WitnessIngressOptions = {},
): Operation<CueEmission[]> {
  const emissions: CueEmission[] = [];
  yield* processWitnessIngressSource(
    runtime,
    serviceHab,
    (signal) => chunkBytes(bytes, { signal }),
    options,
    function*(emission) {
      emissions.push(emission);
    },
  );
  return emissions;
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
): { kind: "accept"; accepted: SerderKERI } | { kind: "escrow" } | {
  kind: "reject";
  message: string;
} {
  const pre = serder.pre;
  const said = serder.said;
  if (!pre || said === null) {
    return {
      kind: "reject",
      message: "Receipted event must expose pre, sn, and said.",
    };
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
export function* witnessReceiptPost(
  runtime: AgentRuntime,
  serviceHab: Hab,
  bytes: Uint8Array,
): Operation<WitnessReceiptPostResult> {
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

  yield* processWitnessIngress(runtime, serviceHab, bytes, {
    local: true,
    deliver: false,
  });
  const eligibility = witnessReceiptEligibility(serviceHab, serder);
  if (eligibility.kind === "reject") {
    return { kind: "reject", status: 400, message: eligibility.message };
  }
  if (eligibility.kind === "escrow") {
    return { kind: "escrow", status: 202 };
  }

  const inspected = yield* inspectReceiptMessage(
    serviceHab.receipt(eligibility.accepted),
  );
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

  const reserder = receiptEvent(pre, serder.sn ?? 0, said);
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
  maxMessageBytes = 8 * 1024 ** 2,
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

    if (query.sn !== null && query.sn !== undefined) {
      const first = serviceHab.db.kels.getLast(pre, query.sn);
      if (!first) {
        return {
          kind: "reject",
          status: 400,
          message: `non-existent event at seq-num ${query.sn}`,
        };
      }
    }

    return {
      kind: "accepted",
      status: 200,
      messages: serviceHab.db.witnessReplay(pre, query.sn ?? null, maxMessageBytes) ?? [],
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

/** Post one generic witness message using HTTP or TCP according to known URLs. */
export function* sendWitnessMessage(
  hab: Hab,
  witness: string,
  bytes: Uint8Array,
  auth?: string,
  services: RuntimeServices = defaultRuntimeServices,
): Operation<void> {
  const url = preferredWitnessTransportUrl(hab, witness);
  if (!url) {
    throw new ValidationError(
      `Unable to find a valid endpoint for witness ${witness}.`,
    );
  }

  const parsed = new URL(url);
  if (parsed.protocol === "tcp:") {
    yield* sendCesrTcp(url, bytes, { services });
    return;
  }

  yield* postCesr(url, (signal) => chunkBytes(bytes, { signal }), {
    bodyMode: "header",
    destination: witness,
    headers: auth ? { Authorization: auth } : undefined,
    services,
  });
}

function isKeripyContentTypeRejection(
  status: number,
  contentType: string,
  responseText: string,
): boolean {
  return status === 406
    && contentType === CESR_CONTENT_TYPE
    && responseText.toLowerCase().includes(KERIPY_CONTENT_TYPE_ERROR);
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
    const response = yield* call(() =>
      getWitnessReceiptEndpoint(hab, witness, {
        pre,
        sn,
        said,
      })
    );
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

  const responseUrl = new URL(url);
  responseUrl.pathname = `${responseUrl.pathname.replace(/\/+$/, "") || ""}/receipts`;
  let lastStatus = 0;
  let lastText = "";
  for (const contentType of WITNESS_HTTP_CONTENT_TYPES) {
    const request = buildCesrRequest(message, {
      contentType,
      destination: witness,
    });
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
    if (response.status === 200) {
      const body = yield* readResponseBytes(response);
      const inspected = yield* inspectReceiptMessage(body);
      return {
        kind: "accepted",
        status: 200,
        body,
        wigers: inspected.wigers,
        cigars: inspected.cigars,
      };
    }
    const body = yield* readResponseBytes(response, 16 * 1024);
    lastStatus = response.status;
    lastText = new TextDecoder().decode(body);
    if (isKeripyContentTypeRejection(response.status, contentType, lastText)) {
      continue;
    }
    return { kind: "reject", status: response.status, message: lastText };
  }
  return {
    kind: "reject",
    status: lastStatus,
    message: lastText,
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
    const body = yield* readResponseBytes(response, 16 * 1024);
    return {
      kind: "reject",
      status: response.status,
      message: new TextDecoder().decode(body),
    };
  }
  const body = yield* readResponseBytes(response);
  const inspected = yield* inspectReceiptMessage(body);
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
    const { serder, message } = acceptedEventReplayMessage(
      this.hby,
      pre,
      eventSn,
    );
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
        throw new ValidationError(
          "Local event must expose a SAID before witness receipting.",
        );
      }

      for (const witness of witnesses) {
        if (kever.delegated) {
          for (const dmsg of this.hby.db.cloneDelegation(kever)) {
            yield* sendWitnessMessage(hab, witness, dmsg);
          }
        }

        // A single receipt attempt owns its response until parsing and collection finish.
        let response = yield* call(() =>
          postWitnessReceiptEndpoint(
            hab,
            witness,
            message,
            auths[witness],
          )
        );
        if (response.kind === "escrow") {
          response = yield* pollWitnessReceipt(
            hab,
            witness,
            pre,
            eventSn,
            said,
          );
        }
        statuses[witness] = response.status;
        if (response.kind !== "accepted") {
          const detail = response.kind === "reject" ? response.message : "receipt remained escrowed";
          throw new ValidationError(
            `Witness ${witness} failed to receipt ${pre}:${eventSn.toString(16)}: ${detail}`,
          );
        }

        receiptGroups.set(witness, {
          wigers: response.wigers,
          cigars: response.cigars,
        });
        yield* settleRuntimeIngress(runtime, [response.body], { local: false });
      }

      for (const witness of witnesses) {
        const complements = [...receiptGroups.entries()]
          .filter(([current]) => current !== witness)
          .map(([, evidence]) => evidence);
        const otherWigers = complements.flatMap((
          evidence,
        ) => [...evidence.wigers]);
        const otherCigars = complements.flatMap((
          evidence,
        ) => [...evidence.cigars]);
        if (otherWigers.length === 0 && otherCigars.length === 0) {
          continue;
        }

        const introWitnesses = witnesses.filter((current) => current !== witness && receiptGroups.has(current));
        const parts: Uint8Array[] = [];
        if (
          serder.ilk === Ilks.icp
          || serder.ilk === Ilks.dip
          || ((serder.ilk === Ilks.rot || serder.ilk === Ilks.drt)
            && serder.adds.includes(witness))
        ) {
          const schemes = witnessSchemeReplies(hab, introWitnesses);
          if (schemes.length > 0) {
            parts.push(schemes);
          }
        }
        parts.push(
          buildDetachedReceiptMessage(
            receiptEvent(pre, eventSn, said),
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

    const response = yield* call(() =>
      getWitnessReceiptEndpoint(hab, witness, {
        pre,
        sn: sn ?? kever.sn,
        said,
      })
    );
    if (response.kind !== "accepted") {
      return false;
    }

    const runtime = yield* createAgentRuntime(this.hby, { mode: "local" });
    try {
      yield* settleRuntimeIngress(runtime, [response.body], { local: false });
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
    const currentWitnessCount = said ? this.hby.db.wigs.get(dgKey(pre, said)).length : 0;
    if (!this.force && currentWitnessCount >= kever.wits.length) {
      const statuses = Object.fromEntries(
        kever.wits.map((witness: string) => [witness, 200]),
      );
      return { witnesses: [...kever.wits], statuses };
    }
    return yield* this.receiptor.receipt(pre, { sn: eventSn, auths });
  }
}

/** Host-side decision for an endorsed, fully witnessed key-state notice. */
export type WitnessKeyStateGetResult =
  | { kind: "accepted"; status: 200; body: Uint8Array }
  | { kind: "reject"; status: number; message: string };

/** Return an actual signed KERI reply; unknown or incompletely witnessed state is not advertised. */
export function witnessKeyStateGet(
  serviceHab: Hab,
  query: { pre?: string | null; destination?: string | null },
): WitnessKeyStateGetResult {
  if (!query.destination || query.destination !== serviceHab.pre) {
    return { kind: "reject", status: 400, message: "Recognized CESR destination required" };
  }
  if (!query.pre) return { kind: "reject", status: 400, message: "'pre' query param is required" };
  const kever = serviceHab.db.getKever(query.pre, { refresh: true });
  if (!kever || !serviceHab.db.fullyWitnessed(kever.serder)) {
    return { kind: "reject", status: 404, message: "Fully witnessed key state not found" };
  }
  return {
    kind: "accepted",
    status: 200,
    body: serviceHab.endorse(replyEvent(`/ksn/${serviceHab.pre}`, kever.state().asDict())),
  };
}
