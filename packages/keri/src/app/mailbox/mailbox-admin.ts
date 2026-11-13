/**
 * Mailbox administration for a single-signature controller: authorize or revoke
 * a remote mailbox through a provider's admin endpoint, owned by the library so
 * that every host (CLI, wallet, service) runs one implementation.
 *
 * Operations follow the workflow contract: `addMailbox` and `removeMailbox`
 * are explicit, sign the endpoint-role reply, post it to the provider and
 * return after the reply is accepted locally. `mailboxStatus` is a pure read of
 * the accepted end-role state. `waitForMailboxState` only observes: it never
 * starts workers and returns a timed-out value instead of throwing.
 *
 * Boundaries:
 * - Dependencies are the concrete collaborators below, not an AgentRuntime
 *   (ADR-0013). The host owns their lifetimes.
 * - The provider is reached through the supplied fetch-only `HttpClient`; nothing
 *   here needs TCP, files or `node:` modules, so a browser can call it.
 * - Group controllers do not use these operations: their propose/complete split
 *   needs the Poster worker (to deliver the proposal to co-signers) and the
 *   group coordinator, which a library `proposeMailbox` would have to take as
 *   collaborators. `completeMailboxAdmin` is the shared tail they reuse.
 */
import { concatBytes } from "cesr-ts";
import { call, type Operation, sleep } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Roles } from "../../core/roles.ts";
import type { Poster } from "../delivery/forwarding.ts";
import {
  endpointRoleAccepted,
  type GroupRoleResult,
  loadAcceptedEndpointRole,
  proposeGroupEndpointRole,
} from "../identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import type { WaitResult } from "../runtime/workflow-contract.ts";
import { buildCesrStreamRequest } from "../transport/cesr-http.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { pinKelPublished } from "./kel-publishing.ts";
import { collectKelSubmission, type KelSubmission } from "./kel-submission.ts";
import { fetchEndpointUrls, preferredUrl } from "./mailboxing.ts";

/** Collaborators mailbox administration needs; nothing else is reachable from here. */
export interface MailboxAdminDeps {
  /** Borrowed identities and accepted-state stores. */
  readonly hby: Habery;
  /** Borrowed HTTP implementation used for the provider admin request. */
  readonly http: HttpClient;
  /** Parser/dispatcher that accepts the signed reply into local state. */
  readonly reactor: Reactor;
  /** Escrow processing over the same database as `hby`. */
  readonly protocol: ProtocolProcessor;
}

/** Accepted end-role state for one controller and mailbox. */
export interface MailboxStatus {
  /** Mailbox AID the status describes. */
  readonly mailbox: string;
  /** `authorized` when the role is allowed, `revoked` when a cut is accepted, else `absent`. */
  readonly state: "authorized" | "revoked" | "absent";
}

/** Finite provider response; non-success statuses are data for the caller. */
export interface MailboxAdminResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

/** Derive the mailbox-admin URL relative to one hosted endpoint path. */
export function mailboxAdminUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const base = pathname === "/" ? "" : pathname;
    return `${parsed.protocol}//${parsed.host}${base}/mailboxes`;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Invalid mailbox URL: ${url}`);
  }
}

/**
 * Preferred accepted URL of a mailbox endpoint.
 *
 * @throws ValidationError when no location reply has been accepted for it.
 */
export function requireMailboxEndpointUrl(hby: Habery, mailbox: string): string {
  const url = preferredUrl(fetchEndpointUrls(hby, mailbox));
  if (!url) {
    throw new ValidationError(`No endpoint URL is stored for mailbox ${mailbox}.`);
  }
  return url;
}

/** Read the accepted mailbox end-role state for `pre`; mutates nothing. */
export function mailboxStatus(hby: Habery, pre: string, mailbox: string): MailboxStatus {
  const end = hby.db.ends.get([pre, Roles.mailbox, mailbox]);
  if (!end) return { mailbox, state: "absent" };
  return { mailbox, state: end.allowed ? "authorized" : "revoked" };
}

/**
 * Authorize `mailbox` for `hab`: sign (or reload) the mailbox end-role reply,
 * post it to the provider and accept it locally.
 *
 * @throws ValidationError for a missing endpoint URL, a provider HTTP failure or a reply that local state does not accept.
 */
export function* addMailbox(
  deps: MailboxAdminDeps,
  hab: Hab,
  mailbox: string,
): Operation<MailboxStatus> {
  const url = requireMailboxEndpointUrl(deps.hby, mailbox);
  const existing = deps.hby.db.ends.get([hab.pre, Roles.mailbox, mailbox]);
  const rpy = existing?.allowed
    ? hab.loadEndRole(hab.pre, mailbox, Roles.mailbox)
    : hab.makeEndRole(mailbox, Roles.mailbox, true);
  return yield* completeMailboxAdmin(deps, hab, mailbox, url, rpy, true);
}

/**
 * Revoke `mailbox` for `hab`: sign a mailbox end-role cut, post it to the
 * provider and accept it locally. Single-signature controllers only.
 *
 * @throws ValidationError as for `addMailbox`.
 */
export function* removeMailbox(
  deps: MailboxAdminDeps,
  hab: Hab,
  mailbox: string,
): Operation<MailboxStatus> {
  const url = requireMailboxEndpointUrl(deps.hby, mailbox);
  const rpy = hab.makeEndRole(mailbox, Roles.mailbox, false);
  return yield* completeMailboxAdmin(deps, hab, mailbox, url, rpy, false);
}

/**
 * Post one signed mailbox end-role reply to the provider, accept it locally and
 * confirm the resulting state. Also the completion step of a group add whose
 * role was already approved.
 *
 * @param allow True when the reply grants the role; false when it cuts it.
 * @throws ValidationError when the reply is empty, the provider refuses it, or local state does not reflect it.
 */
export function* completeMailboxAdmin(
  deps: MailboxAdminDeps,
  hab: Hab,
  mailbox: string,
  endpointUrl: string,
  rpy: Uint8Array,
  allow: boolean,
): Operation<MailboxStatus> {
  if (rpy.length === 0) {
    throw new ValidationError(`No accepted mailbox role reply is available for ${hab.pre}.`);
  }
  // The request carries the KEL up to this establishment event, which the mailbox then holds.
  const established = deps.hby.db.getKever(hab.pre)?.lastEst.d;
  const response = yield* postMailboxAdmin(
    deps.http,
    endpointUrl,
    mailbox,
    collectKelSubmission(deps.hby, hab.pre),
    rpy,
  );
  if (!response.ok) {
    throw new ValidationError(`Mailbox admin request failed with HTTP ${response.status}: ${response.body}`);
  }

  yield* deps.reactor.processBytes(rpy, {});
  yield* deps.protocol.processEscrowsOnce();

  const status = mailboxStatus(deps.hby, hab.pre, mailbox);
  if (allow && status.state !== "authorized") {
    throw new ValidationError("Mailbox add was not accepted into local state.");
  }
  if (!allow && status.state !== "revoked") {
    throw new ValidationError("Mailbox removal was not accepted into local state.");
  }
  // The publisher need not send a KEL this request just carried.
  if (allow && established) pinKelPublished(deps.hby.db, hab.pre, mailbox, established, systemClock);
  return status;
}

/**
 * Propose a group's mailbox authorization (`/end/role/add`) to the other members, who
 * approve it with `approveGroupProposal`. Returns without waiting and sends nothing
 * to the provider; {@link completeGroupMailbox} does that once the role is accepted.
 * The caller runs the Poster's delivery for the duration.
 */
export function* proposeGroupMailbox(
  hby: Habery,
  protocol: ProtocolProcessor,
  postman: Poster,
  group: Hab,
  mailbox: string,
): Operation<GroupRoleResult> {
  return yield* proposeGroupEndpointRole(hby, protocol, postman, group, {
    eid: mailbox,
    role: Roles.mailbox,
    allow: true,
  });
}

/**
 * Finish a group mailbox add whose end-role reply the members approved: post the
 * accepted reply to the provider and confirm local state.
 *
 * @throws ValidationError while the group has not accepted the mailbox role, or as for `completeMailboxAdmin`.
 */
export function* completeGroupMailbox(
  deps: MailboxAdminDeps,
  group: Hab,
  mailbox: string,
): Operation<MailboxStatus> {
  if (!endpointRoleAccepted(deps.hby, group.pre, Roles.mailbox, mailbox)) {
    throw new ValidationError(`Mailbox role for ${mailbox} is not yet approved for group ${group.pre}.`);
  }
  const url = requireMailboxEndpointUrl(deps.hby, mailbox);
  const rpy = loadAcceptedEndpointRole(group, mailbox, Roles.mailbox);
  return yield* completeMailboxAdmin(deps, group, mailbox, url, rpy, true);
}

/** Choices for `waitForMailboxState`. */
export interface MailboxWaitOptions {
  /** State to wait for. */
  want: "authorized" | "revoked";
  /** Epoch milliseconds after which the wait returns `timed-out`. */
  deadline: number;
  /** Clock the deadline is read against; defaults to the system clock. */
  clock?: RuntimeClock;
  /** Elapsed milliseconds between reads. */
  pollMs?: number;
}

/** Outcome of `waitForMailboxState`; a deadline is a value, not a throw. */
export type MailboxWaitResult = WaitResult<MailboxStatus, Record<never, never>>;

/**
 * Observe `read` until it reports the wanted state or the deadline passes. It
 * starts no workers: whoever owns the runtime makes the state change.
 */
export function* waitForMailboxState(
  read: () => MailboxStatus,
  { want, deadline, clock = systemClock, pollMs = 250 }: MailboxWaitOptions,
): Operation<MailboxWaitResult> {
  while (true) {
    const status = read();
    if (status.state === want) return { outcome: "settled", status };
    const remaining = deadline - clock.now();
    if (remaining <= 0) return { outcome: "timed-out", status };
    yield* sleep(Math.min(pollMs, remaining));
  }
}

/**
 * Submit one admin request: the raw `application/cesr` body first, then the
 * legacy multipart form when the provider answers 406 or 415.
 */
function* postMailboxAdmin(
  http: HttpClient,
  url: string,
  mailbox: string,
  submission: KelSubmission,
  rpy: Uint8Array,
): Operation<MailboxAdminResponse> {
  const raw = yield* postMailboxAdminCesr(http, url, mailbox, concatBytes(submission.replay, rpy));
  if (raw.ok || (raw.status !== 406 && raw.status !== 415)) return raw;
  return yield* postMailboxAdminMultipart(http, url, mailbox, submission, rpy);
}

/** Send finite administrative CESR bytes with `CESR-DESTINATION` selecting the hosted mailbox. */
export function* postMailboxAdminCesr(
  http: HttpClient,
  url: string,
  mailbox: string,
  bytes: Uint8Array,
): Operation<MailboxAdminResponse> {
  const request = buildCesrStreamRequest(bytes, { destination: mailbox });
  const response = yield* http.request(mailboxAdminUrl(url), {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
  // Administrative JSON/diagnostics are finite metadata, not an unbounded stream.
  return { ok: response.ok, status: response.status, body: new TextDecoder().decode(response.body) };
}

/**
 * Send the legacy multipart form (`kel`, optional `delkel`, `rpy`). The platform
 * encoder runs once so the generated boundary stays consistent with the body.
 */
export function* postMailboxAdminMultipart(
  http: HttpClient,
  url: string,
  mailbox: string,
  submission: Pick<KelSubmission, "kel" | "delkel">,
  rpy: Uint8Array,
): Operation<MailboxAdminResponse> {
  const decoder = new TextDecoder();
  const form = new FormData();
  form.append("kel", decoder.decode(submission.kel));
  if (submission.delkel.length > 0) {
    form.append("delkel", decoder.decode(submission.delkel));
  }
  form.append("rpy", decoder.decode(rpy));

  const prepared = new Response(form);
  prepared.headers.set("CESR-DESTINATION", mailbox);
  const bytes = yield* call(() => prepared.arrayBuffer());
  const response = yield* http.request(mailboxAdminUrl(url), {
    method: "POST",
    headers: prepared.headers,
    body: bytes,
  });
  return { ok: response.ok, status: response.status, body: decoder.decode(response.body) };
}
