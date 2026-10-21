/** Witness HTTP semantic policies for receipts, log queries and endorsed key state; adapters format decisions. */
import { Ilks, type SerderKERI } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { receipt as receiptEvent, reply as replyEvent } from "../../core/protocol-eventing.ts";
import { dgKey } from "../../db/core/keys.ts";
import { type Hab } from "../identity/habbing.ts";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";
import { inspectCesrRequest } from "../transport/cesr-http.ts";
import { processWitnessIngress } from "./ingress.ts";
import {
  buildEndpointDetachedReceiptMessage,
  buildWitnessReceiptMessage,
  inspectReceiptMessage,
} from "./receipt-messages.ts";

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
