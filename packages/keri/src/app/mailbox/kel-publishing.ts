/**
 * Telling a mailbox host an identifier's KEL. A host authenticates a mailbox poll against the key state it
 * holds, which is only as new as the last KEL it was given, so a rotation it has not been told about makes it
 * refuse the owner's polls. The publisher (`KelPublisher`) and the poller's repair of a refusing mailbox use
 * the one post below and record it in the same marker, `Baser.kpub`.
 */
import { type Operation, scoped } from "npm:effection@^3.6.0";
import type { Baser } from "../../db/basing.ts";
import type { Habery } from "../identity/habbing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { buildCesrStreamRequest } from "../transport/cesr-http.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { requestWithHeaderTimeout } from "../transport/httping.ts";
import { collectKelSubmission } from "./kel-submission.ts";

/** Longest a mailbox may take to answer the post, in milliseconds. */
export const KEL_PUBLISH_HEADER_TIMEOUT_MS = 10_000;

/** What posting the KEL to one mailbox came to; a failure carries its reason (and status) and is never thrown. */
export type MailboxPublication =
  | { readonly mailbox: string; readonly outcome: "told" }
  | { readonly mailbox: string; readonly outcome: "failed"; readonly reason: string; readonly status?: number };

/** Collaborators the post needs; nothing else is reachable from here. */
export interface KelPublishingDeps {
  /** Borrowed identities and accepted-state stores. */
  readonly hby: Habery;
  /** Borrowed HTTP implementation. */
  readonly http: HttpClient;
  /** Borrowed clock for the header deadline. */
  readonly clock: RuntimeClock;
}

/**
 * Post the KEL replay of `pre` (delegation chain, KEL and the receipts stored for it) to one mailbox's CESR
 * ingress, with `CESR-DESTINATION` selecting the hosted mailbox. A separate request, never prefixed to a poll:
 * a host answers with the response to the first message of a body.
 */
export function* postKelToMailbox(
  { hby, http, clock }: KelPublishingDeps,
  pre: string,
  endpoint: { eid: string; url: string },
  { timeoutMs = KEL_PUBLISH_HEADER_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Operation<MailboxPublication> {
  const { replay } = collectKelSubmission(hby, pre);
  const request = buildCesrStreamRequest(replay, { destination: endpoint.eid });
  try {
    return yield* scoped(function*(): Operation<MailboxPublication> {
      const response = yield* requestWithHeaderTimeout(
        http,
        clock,
        endpoint.url,
        { method: "POST", headers: request.headers, body: request.body },
        timeoutMs,
      );
      if (!response) return { mailbox: endpoint.eid, outcome: "failed", reason: `no answer within ${timeoutMs} ms` };
      return response.ok
        ? { mailbox: endpoint.eid, outcome: "told" }
        : { mailbox: endpoint.eid, outcome: "failed", reason: `HTTP ${response.status}`, status: response.status };
    });
  } catch (error) {
    return { mailbox: endpoint.eid, outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Record that `mailbox` was given the KEL of `pre` up to establishment event `d`, and clear any earlier give-up.
 * The record holds coordinates only; the publisher derives what is owed by comparing it with the identifier's
 * latest establishment event.
 */
export function pinKelPublished(
  db: Baser,
  pre: string,
  mailbox: string,
  d: string,
  clock: Pick<RuntimeClock, "now">,
): void {
  db.kpub.pin([pre, mailbox], { d, dt: new Date(clock.now()).toISOString() });
}
