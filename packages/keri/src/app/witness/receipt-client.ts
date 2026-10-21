/** Controller-side witness transport: HTTP receipts, explicit media fallback and optional duplex TCP intake. */
import { Cigar, type Siger } from "cesr-ts";
import { action, call, type Operation, scoped } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Schemes } from "../../core/schemes.ts";
import { type Hab } from "../identity/habbing.ts";
import { type ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { abortable } from "../runtime/abortable.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { collectBytes } from "../transport/byte-source.ts";
import { buildCesrRequest, CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE } from "../transport/cesr-http.ts";
import type { HttpClient, HttpStreamResponse } from "../transport/http-client.ts";
import { HTTPMessenger } from "../transport/http-messenger.ts";
import { TCPMessenger } from "../transport/tcp-messenger.ts";
import { inspectReceiptMessage } from "./receipt-messages.ts";

const WitnessReceiptPollAttempts = 20;

const WitnessReceiptPollDelayMs = 100;

const KERIPY_CONTENT_TYPE_ERROR = "content type";

const WITNESS_HTTP_CONTENT_TYPES = [
  CESR_CONTENT_TYPE,
  KERIPY_CESR_JSON_CONTENT_TYPE,
] as const;

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

/** Return the full advertised scheme map for one witness endpoint. */
function witnessUrls(
  hab: Hab,
  witness: string,
): Record<string, string> {
  return hab.fetchUrls(witness);
}

/** Resolve the HTTP or HTTPS witness endpoint when available. */
export function witnessHttpUrl(
  hab: Hab,
  witness: string,
): string | null {
  const urls = witnessUrls(hab, witness);
  return urls[Schemes.https] ?? urls[Schemes.http] ?? null;
}

/** Resolve the TCP witness endpoint when available. */
export function witnessTcpUrl(
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
export function* pollWitnessReceipt(
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
export function* postWitnessReceiptEndpoint(
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
export function* getWitnessReceiptEndpoint(
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
