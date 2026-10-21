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
import type { HttpClient, HttpStreamResponse } from "../transport/http-client.ts";

import { Cigar, concatBytes, Counter, CtrDexV1, Ilks, parse, parseBytes, type SerderKERI, type Siger } from "cesr-ts";
import { action, call, ensure, type Operation, resource, scoped, spawn } from "npm:effection@^3.6.0";
import type { AgentCue } from "../../core/cues.ts";
import { type Deck } from "../../core/deck.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Kevery } from "../../core/eventing.ts";
import { receipt as receiptEvent, reply as replyEvent } from "../../core/protocol-eventing.ts";
import { type Scheme, Schemes } from "../../core/schemes.ts";
import { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../identity/habbing.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import { type ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { abortable, rethrowCleanupFailure } from "../runtime/abortable.ts";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { chunkBytes, collectBytes } from "../transport/byte-source.ts";
import {
  buildCesrRequest,
  CESR_CONTENT_TYPE,
  inspectCesrRequest,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "../transport/cesr-http.ts";
import { HTTPMessenger } from "../transport/http-messenger.ts";
import { processMessages } from "../transport/message-source.ts";
import { TCPMessenger } from "../transport/tcp-messenger.ts";

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
function buildDetachedReceiptMessage(serder: SerderKERI, { wigers = [], cigars = [] }: {
  wigers?: readonly Siger[];
  cigars?: readonly Cigar[];
}): Uint8Array {
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
function buildEndpointDetachedReceiptMessage(serder: SerderKERI, { wigers = [], cigars = [] }: {
  wigers?: readonly Siger[];
  cigars?: readonly Cigar[];
}): Uint8Array {
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
/** Inspect one complete receipt; hydrated proof values have no asynchronous lifetime. */
function inspectReceiptMessage(
  bytes: Uint8Array,
): { serder: SerderKERI; wigers: readonly Siger[]; cigars: readonly Cigar[] } {
  const frames = parseBytes(bytes);
  if (frames.length !== 1) throw new ValidationError("Expected one witness receipt message.");
  const envelope = envelopeFromFrame(frames[0], false);
  return { serder: envelope.serder, wigers: envelope.wigers, cigars: envelope.cigars };
}

/**
 * Receipt endpoints return one finite proof; cancellation joins the reader before leaving this operation.
 *
 * @param response Borrowed finite receipt-proof HTTP response.
 * @returns Complete proof bytes after read cleanup.
 */
function* readResponseBytes(response: HttpStreamResponse): Operation<Uint8Array> {
  return yield* abortable((signal) => collectBytes(response.body(signal)));
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
  const habitats = runtime.hby.habs.values();
  const first = habitats.next();
  return first.done || !habitats.next().done ? null : first.value;
}
/**
 * Route one initial witness cue batch, leaving saved key-state facts for the
 * application cue worker and its optional command-owned noticer destination.
 * Respondant publishes Poster work; this ingress helper never drains Poster
 * network delivery. Query network I/O stays with the independent sender.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Optional hosted witness signer; absent selection must be unambiguous.
 * @param cues Exact runtime application Deck; foreign Decks are rejected.
 * @param options deliver defaults true: publish outgoing work for the independent senders. False performs local signing side effects only.
 */
export function* drainWitnessCues(
  runtime: AgentRuntime,
  serviceHab: Hab | undefined,
  cues: Deck<AgentCue>,
  { deliver = true }: { deliver?: boolean } = {},
): Operation<void> {
  if (cues !== runtime.cues) throw new RangeError("Witness cue drain requires the runtime source deck");
  const hab = cueHab(runtime, serviceHab);
  if (!hab) return;
  const count = cues.length;
  for (let index = 0; index < count; index++) {
    const cue = cues.peekHead();
    if (!cue) break;
    if (cue.kin === "keyStateSaved") {
      cues.pull();
      cues.append(cue);
      continue;
    }
    if (deliver) {
      if (cue.kin === "query") {
        runtime.querying.enqueueCue(cue, hab);
      } else if (cue.kin === "stream") {
        runtime.mailboxDirector.retainQueryCue(cue);
      } else if (["receipt", "witness", "replay", "reply"].includes(cue.kin)) {
        const msgs = [...hab.processCuesIter([cue])];
        runtime.respondant.enqueueMsgs(hab, cue, msgs);
      }
    } else {
      // Exhaust local signing side effects without collecting discarded wire.
      for (const _msg of hab.processCuesIter([cue])) { /* local proof persisted */ }
    }
    cues.pull();
  }
}
/** Witness-local dispatch and existing responder delivery policy for one ingress source. */
export interface WitnessIngressOptions {
  /** Accept with witness-local semantics; default false preserves ordinary ingress policy. */
  local?: boolean;
  /** Route queries/replies through their owners; receipts use false to produce their own finite proof. */
  deliver?: boolean;
}
/**
 * Own one witness input and settle each frame before requesting more input.
 * Each complete frame publishes its prepared replies before requesting more input.
 * Source abort and cleanup belong to this input scope.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Hosted witness/controller habitat used for local replies.
 * @param source Creates cancellation-aware wire input owned by this operation.
 * @param options local defaults false; deliver defaults true and controls cue publication, not Poster queue draining.
 */
export function* processWitnessIngressSource(
  runtime: AgentRuntime,
  serviceHab: Hab,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  { local = false, deliver = true }: WitnessIngressOptions = {},
): Operation<void> {
  yield* call(function*() {
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      signal.throwIfAborted();
      const frames = parse(source(signal));
      let pending: ReturnType<typeof frames.next> | undefined;
      // The earlier resource joins the read after processing children stop.
      yield* ensure(function*() {
        try {
          if (pending) {
            try {
              yield* call(() => pending!);
            } catch (error) {
              rethrowCleanupFailure(error, signal);
            }
          }
        } finally {
          yield* call(() => frames.return());
        }
      });
      while (true) {
        signal.throwIfAborted();
        pending = frames.next();
        let result: Awaited<typeof pending>;
        try {
          result = yield* call(() => pending!);
        } catch (error) {
          pending = undefined;
          throw error;
        }
        pending = undefined;
        signal.throwIfAborted();
        if (result.done) break;
        const frame = result.value;
        yield* runtime.protocol.dispatch(frame, { local, escrows: true });
        yield* drainWitnessCues(runtime, serviceHab, runtime.cues, { deliver });
      }
    } finally {
      controller.abort();
    }
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
 * - leave request-scoped receipt construction with the endpoint owner
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
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param serviceHab Hosted reply signer.
 * @param bytes Finite signed input bytes adapted to the same source path.
 * @param options Witness intake/local-production policy forwarded to processWitnessIngressSource.
 */
export function* processWitnessIngress(
  runtime: AgentRuntime,
  serviceHab: Hab,
  bytes: Uint8Array,
  options: WitnessIngressOptions = {},
): Operation<void> {
  yield* processWitnessIngressSource(
    runtime,
    serviceHab,
    (signal) => chunkBytes(bytes, { signal }),
    options,
  );
}

/** Authorize the hosted witness against the accepted event, retaining pending dependencies in escrow. */
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

  const acceptedSaid = serder.sn === null ? null : serviceHab.db.kels.getLast(pre, serder.sn);
  if (!acceptedSaid) return { kind: "escrow" };
  if (acceptedSaid !== said) return { kind: "reject", message: "Receipted event is not the accepted KEL event." };
  const witnesses = serviceHab.db.acceptedEventWitnesses(serder);
  if (!witnesses) return { kind: "escrow" };
  if (!witnesses.includes(serviceHab.pre)) {
    return {
      kind: "reject",
      message: `${serviceHab.pre} is not an authorized witness for ${pre}:${said}: wits=${JSON.stringify(witnesses)}.`,
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

  const inspected = inspectReceiptMessage(
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

  const wits = serviceHab.db.acceptedEventWitnesses(serder);
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
      messages: serviceHab.db.witnessReplay(pre, query.sn ?? null) ?? [],
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
/**
 * Send via HTTP first; an explicit protocol processor processes same-socket TCP replies.
 * Without a protocol processor TCP reports local transmission only. Actual socket/parser
 * cleanup finishes before this borrowed protocol processor can be released.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param witness Target witness AID whose accepted locations choose HTTP-first/TCP fallback.
 * @param bytes Complete signed event/introduction wire.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param protocol Optional same-socket reply processor; null selects transmit-only TCP.
 * @param auth Optional HTTP Authorization header value.
 * @throws Missing endpoint, peer refusal, transport/parser or cleanup failures propagate.
 */
export function* sendWitnessMessage(
  hab: Hab,
  witness: string,
  bytes: Uint8Array,
  http: HttpClient,
  clock: RuntimeClock,
  protocol: ProtocolProcessor | null,
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
    yield* new TCPMessenger(url, clock, protocol).send(bytes, {
      replies: Boolean(protocol),
      local: true,
    });
    return;
  }

  const outcome = yield* new HTTPMessenger(url, http, {
    destination: witness,
    headers: auth ? { Authorization: auth } : undefined,
  }).send(bytes);
  if (outcome.kind === "refuse") throw outcome.error;
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

/**
 * Poll one witness `GET /receipts` endpoint until the receipt becomes available.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param witness Witness AID whose HTTP receipt endpoint is selected.
 * @param pre Event subject AID.
 * @param sn Event sequence number.
 * @param said Exact event SAID to verify against returned proof.
 * @param http Borrowed HTTP implementation selected by composition.
 * @returns Receipt endpoint status and wire result for later verification; HTTP success alone is not accepted witness state.
 */
function* pollWitnessReceipt(
  hab: Hab,
  witness: string,
  pre: string,
  sn: number,
  said: string,
  http: HttpClient,
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
      }, http)
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

/**
 * Request one witness receipt via `POST /receipts`.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param witness Witness AID whose HTTP receipt endpoint is selected.
 * @param message Complete signed event wire requesting a witness receipt.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param auth Optional witness HTTP Authorization value.
 * @returns Receipt endpoint status and wire result for later verification; HTTP success alone is not accepted witness state.
 */
function* postWitnessReceiptEndpoint(
  hab: Hab,
  witness: string,
  message: Uint8Array,
  http: HttpClient,
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
    const response = yield* scoped(function*() {
      const response = yield* http.open(responseUrl.toString(), {
        method: "POST",
        headers: { ...request.headers, ...(auth ? { Authorization: auth } : {}) },
        body: request.body,
      });
      // Escrow is a status-only result. Other outcomes require their complete proof/diagnostic body.
      const body = response.status === 202 ? new Uint8Array() : yield* readResponseBytes(response);
      return { status: response.status, body };
    });
    if (response.status === 202) {
      return { kind: "escrow", status: 202 };
    }
    if (response.status === 200) {
      const body = response.body;
      const inspected = inspectReceiptMessage(body);
      return {
        kind: "accepted",
        status: 200,
        body,
        wigers: inspected.wigers,
        cigars: inspected.cigars,
      };
    }
    const body = response.body;
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

/**
 * Request one stored witness receipt via `GET /receipts`.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param witness Witness AID whose HTTP receipt endpoint is selected.
 * @param query Receipt lookup subject, sequence and digest fields.
 * @param http Borrowed HTTP implementation selected by composition.
 * @returns Receipt endpoint status and wire result for later verification; HTTP success alone is not accepted witness state.
 */
function* getWitnessReceiptEndpoint(
  hab: Hab,
  witness: string,
  query: { pre: string; sn?: number; said?: string },
  http: HttpClient,
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

  const response = yield* http.request(endpoint.toString(), {
    method: "GET",
  });
  if (response.status !== 200) {
    const body = response.body;
    return {
      kind: "reject",
      status: response.status,
      message: new TextDecoder().decode(body),
    };
  }
  const body = response.body;
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
 * - publish through HTTP receipt endpoints (generic submission opts into TCP reply intake)
 * - catch up newly added witnesses before receipting
 * - persist returned receipts locally through the protocol processor
 * - fan witness receipts out to the complementary witnesses
 */
export class Receiptor {
  /** Borrowed accepted state and local signer collection. */
  readonly hby: Habery;
  /** Shared receipt verification, cue publication and escrow processing. */
  readonly protocol: ProtocolProcessor;
  /** Input-owned Kevery (kvy) for request-owned receipt GET/POST evidence. */
  private readonly kvy: Kevery;
  /** Borrowed HTTP and clock services used by actual receipt operations. */
  readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  readonly clock: RuntimeClock;

  /**
   * Bind configured intake over the same Habery; acquire no stores or background workers.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param protocol Borrowed same-database protocol owner for receipt intake.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   */
  constructor(hby: Habery, protocol: ProtocolProcessor, http: HttpClient, clock: RuntimeClock) {
    const kvy = protocol.makeKevery();
    if (kvy.db !== hby.db) throw new RangeError("Receiptor protocol must use the same database");
    this.hby = hby;
    this.protocol = protocol;
    this.kvy = kvy;
    this.http = http;
    this.clock = clock;
  }
  /** Submit the latest or specified event to all witnesses and gather receipts. */
  *receipt(pre: string, { sn, auths = {}, allowTcp = false }: {
    sn?: number;
    auths?: WitnessAuthMap;
    /** Generic WitnessReceiptor permits TCP; explicit receipt endpoints remain HTTP-only. */
    allowTcp?: boolean;
  } = {}): Operation<WitnessReceiptRunResult> {
    return yield* call(() => this.receiptOnce(pre, { sn, auths }, allowTcp));
  }
  /**
   * One scoped attempt joins actual receipt HTTP/TCP work before returning.
   *
   * @param pre Local event subject AID.
   * @param options Optional event sequence and witness Authorization map.
   * @param allowTcp Whether missing HTTP receipt routes may use TCP message delivery.
   * @returns Receipt-attempt result based on verified local witness proof.
   */
  private *receiptOnce(pre: string, { sn, auths }: {
    sn?: number;
    auths: WitnessAuthMap;
  }, allowTcp: boolean): Operation<WitnessReceiptRunResult> {
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
    const witnesses = this.hby.db.acceptedEventWitnesses(serder)!;
    if (witnesses.length === 0) {
      return { witnesses: [], statuses: {} };
    }

    if (serder.ilk === Ilks.rot || serder.ilk === Ilks.drt) {
      for (const witness of serder.adds) {
        yield* this.catchup(pre, witness);
      }
    }
    const receiptGroups = new Map<string, readonly Siger[]>();
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
          yield* sendWitnessMessage(hab, witness, dmsg, this.http, this.clock, this.protocol);
        }
      }

      if (allowTcp && !witnessHttpUrl(hab, witness) && witnessTcpUrl(hab, witness)) {
        yield* sendWitnessMessage(hab, witness, message, this.http, this.clock, this.protocol);
        statuses[witness] = 200;
      } else {
        // A single receipt attempt owns its response until parsing and collection finish.
        let response = yield* call(() =>
          postWitnessReceiptEndpoint(
            hab,
            witness,
            message,
            this.http,
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
            this.http,
          );
        }
        statuses[witness] = response.status;
        if (response.kind !== "accepted") {
          const detail = response.kind === "reject" ? response.message : "receipt remained escrowed";
          throw new ValidationError(
            `Witness ${witness} failed to receipt ${pre}:${eventSn.toString(16)}: ${detail}`,
          );
        }
        yield* processMessages((signal) => chunkBytes(response.body, { signal }), this.protocol, this.kvy, {
          local: false,
        });
        yield* this.protocol.processEscrowsOnce();
      }
      // HTTP status and socket drain are transport facts; only accepted witness proof counts.
      const index = witnesses.indexOf(witness);
      const wigers = this.hby.db.wigs.get(dgKey(pre, said)).filter((siger) => siger.index === index);
      if (wigers.length === 0) {
        throw new ValidationError(`Witness ${witness} did not receipt ${pre}:${eventSn.toString(16)}.`);
      }
      receiptGroups.set(witness, wigers);
    }

    for (const witness of witnesses) {
      const otherWigers = [...receiptGroups.entries()]
        .flatMap(([current, wigers]) => current === witness ? [] : [...wigers]);
      if (otherWigers.length === 0) {
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
          { wigers: otherWigers },
        ),
      );
      yield* sendWitnessMessage(hab, witness, concatBytes(...parts), this.http, this.clock, this.protocol);
    }

    return { witnesses, statuses };
  }
  /**
   * Query a stored witness receipt and apply it to local state when found.
   *
   * @param pre Event subject AID.
   * @param options Optional sequence/SAID selection; defaults follow current accepted state.
   * @returns Whether matching verified witness receipt state was obtained.
   */
  *get(pre: string, { sn, said }: {
    sn?: number;
    said?: string;
  } = {}): Operation<boolean> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const eventSn = sn ?? kever.sn;
    const knownSaid = this.hby.db.kels.getLast(pre, eventSn);
    const known = knownSaid ? this.hby.db.getEvtSerder(pre, knownSaid) : null;
    const witnesses = known ? this.hby.db.acceptedEventWitnesses(known)! : kever.wits;
    const witness = [...witnesses].sort()[0];
    if (!witness) {
      return false;
    }

    const response = yield* call(() => getWitnessReceiptEndpoint(hab, witness, { pre, sn: eventSn, said }, this.http));
    if (response.kind !== "accepted") {
      return false;
    }

    yield* processMessages((signal) => chunkBytes(response.body, { signal }), this.protocol, this.kvy, {
      local: false,
    });
    yield* this.protocol.processEscrowsOnce();
    const expectedSaid = this.hby.db.kels.getLast(pre, eventSn);
    const accepted = expectedSaid ? this.hby.db.getEvtSerder(pre, expectedSaid) : null;
    const index = accepted ? this.hby.db.acceptedEventWitnesses(accepted)?.indexOf(witness) : -1;
    return !!expectedSaid && (said === undefined || said === expectedSaid)
      && this.hby.db.wigs.get(dgKey(pre, expectedSaid)).some((siger) => siger.index === index);
  }

  /**
   * Catch one witness up through the same protocol processor used for receipt intake.
   *
   * @param pre Local KEL subject to replay.
   * @param witness Witness AID to catch up.
   */
  *catchup(pre: string, witness: string): Operation<void> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (kever?.delegated) {
      for (const msg of this.hby.db.cloneDelegation(kever)) {
        yield* sendWitnessMessage(hab, witness, msg, this.http, this.clock, this.protocol);
      }
    }
    for (const msg of this.hby.db.clonePreIter(pre)) {
      yield* sendWitnessMessage(hab, witness, msg, this.http, this.clock, this.protocol);
    }
  }
}
/**
 * Higher-level full witness submission helper.
 *
 * HTTP uses finite receipt endpoints; TCP uses same-socket local reply intake
 * and requires the requested witness signature to be persisted before fanout.
 */
export class WitnessReceiptor {
  /** Actual receipt-intake/fanout owner over the same shared protocol domain. */
  readonly receiptor: Receiptor;
  /** Borrowed identities and accepted witness cohorts. */
  readonly hby: Habery;
  /** Existing explicit request to publish even when cached receipt completion is available. */
  readonly force: boolean;

  /**
   * Bind actual protocol/I/O dependencies; only the scalar force choice is optional.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param protocol Borrowed same-database protocol owner for receipt intake.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   * @param options force defaults false; true requests the existing forced witness submission policy.
   */
  constructor(hby: Habery, protocol: ProtocolProcessor, http: HttpClient, clock: RuntimeClock, { force = false }: {
    force?: boolean;
  } = {}) {
    this.hby = hby;
    this.force = force;
    this.receiptor = new Receiptor(hby, protocol, http, clock);
  }
  /** Ensure the current event reaches full witness receipt convergence. */
  *submit(pre: string, { sn, auths = {} }: {
    sn?: number;
    auths?: WitnessAuthMap;
  } = {}): Operation<WitnessReceiptRunResult> {
    const hab = this.hby.habs.get(pre) ?? null;
    if (!hab) {
      throw new ValidationError(`${pre} not a valid local AID.`);
    }
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${pre}.`);
    }
    const eventSn = sn ?? kever.sn;
    const { serder } = acceptedEventReplayMessage(this.hby, pre, eventSn);
    const witnesses = this.hby.db.acceptedEventWitnesses(serder)!;
    const currentWitnessCount = this.hby.db.wigs.get(dgKey(pre, serder.said!)).length;
    if (!this.force && currentWitnessCount >= witnesses.length) {
      const statuses = Object.fromEntries(witnesses.map((witness) => [witness, 200]));
      return { witnesses, statuses };
    }
    return yield* this.receiptor.receipt(pre, { sn: eventSn, auths, allowTcp: true });
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
