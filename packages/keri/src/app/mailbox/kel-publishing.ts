/**
 * Telling a mailbox host an identifier's KEL. A host authenticates a mailbox poll against the key state it
 * holds, which is only as new as the last KEL it was given, so a rotation it has not been told about makes it
 * refuse the owner's polls. Both the completion of a rotation and the poller's repair of a refusing mailbox
 * use the one post below.
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { Habery } from "../identity/habbing.ts";
import { buildCesrStreamRequest } from "../transport/cesr-http.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { collectKelSubmission } from "./kel-submission.ts";
import { authorizedMailboxes, fetchEndpointUrls, preferredUrl } from "./mailboxing.ts";

/** What posting the KEL to one mailbox came to; a failure carries its reason and is never thrown. */
export type MailboxPublication =
  | { readonly mailbox: string; readonly outcome: "told" }
  | { readonly mailbox: string; readonly outcome: "failed"; readonly reason: string };

/** Collaborators the post needs; nothing else is reachable from here. */
export interface KelPublishingDeps {
  /** Borrowed identities and accepted-state stores. */
  readonly hby: Habery;
  /** Borrowed HTTP implementation. */
  readonly http: HttpClient;
}

/**
 * Post the KEL replay of `pre` (delegation chain, KEL and the receipts stored for it) to one mailbox's CESR
 * ingress, with `CESR-DESTINATION` selecting the hosted mailbox. A separate request, never prefixed to a poll:
 * a host answers with the response to the first message of a body.
 */
export function* postKelToMailbox(
  { hby, http }: KelPublishingDeps,
  pre: string,
  endpoint: { eid: string; url: string },
): Operation<MailboxPublication> {
  const { replay } = collectKelSubmission(hby, pre);
  const request = buildCesrStreamRequest(replay, { destination: endpoint.eid });
  try {
    const response = yield* http.request(endpoint.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });
    return response.ok
      ? { mailbox: endpoint.eid, outcome: "told" }
      : { mailbox: endpoint.eid, outcome: "failed", reason: `HTTP ${response.status}` };
  } catch (error) {
    return { mailbox: endpoint.eid, outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Tell every mailbox `pre` currently has an authorized role with its KEL. Idempotent: a host that already
 * holds the events drops the duplicates. One mailbox failing does not stop the others.
 */
export function* tellMailboxes(deps: KelPublishingDeps, pre: string): Operation<MailboxPublication[]> {
  const told: MailboxPublication[] = [];
  for (const eid of authorizedMailboxes(deps.hby.db, pre)) {
    const url = preferredUrl(fetchEndpointUrls(deps.hby, eid));
    told.push(
      url
        ? yield* postKelToMailbox(deps, pre, { eid, url })
        : { mailbox: eid, outcome: "failed", reason: "no endpoint URL is stored for the mailbox" },
    );
  }
  return told;
}
