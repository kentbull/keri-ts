/**
 * Agent side of relay mode: refresh the agent's own view of a subject when a served edge asks about it.
 *
 * An edge's only view of third-party key state is its agent's: every edge query is addressed to the agent, which
 * answers from its own store. That store may be stale for an identifier the agent has no reason of its own to
 * follow. So when a relaying agent receives a `logs` or `ksn` query from a sender it serves about a subject that is
 * not one of its own, it also issues its own ordinary `logs` query for that subject, as an ordinary `query` cue its
 * own querier consumes. The agent is a forwarder, so that query goes directly to the subject's controller, agent or
 * witness endpoint. This is on demand only, as KERIA queries for its Signify clients: no watching, no subscription
 * list, no new store.
 *
 * What the edge sees: the answer to the query that caused the refresh comes from what the agent held then, unless
 * the query names a sequence number or anchor the agent lacks, in which case the agent escrows it (query-not-found)
 * and answers once the refresh lands. A later edge query returns the refreshed state.
 */
import { Ilks } from "cesr-ts";
import type { QueryCue } from "../../core/cues.ts";
import type { QueryEnvelope } from "../../core/kel/eventing.ts";
import { Kever } from "../../core/kel/kever.ts";
import type { Habery } from "../identity/habbing.ts";
import { servingHost } from "../mailbox/forward-handler.ts";
import { type DispatchResult, queryEnvelopeFromDispatch } from "../protocol/parsering.ts";
import { queryAttesters } from "./witness-inquisitor.ts";

/**
 * The requester of a query whose attached signatures satisfy its current signing threshold, or null.
 *
 * `logs` and `ksn` answers are public, so the KEL query path does not authenticate the requester (nor does KERIpy).
 * A refresh spends the agent's own traffic on the requester's behalf, so it needs the requester proven: a
 * transferable source whose KEL the agent holds and whose current keys signed this query to threshold.
 *
 * @param hby Borrowed accepted-state store holding the requester's KEL.
 * @param query Normalized query envelope with its requester source and indexed signatures.
 * @returns The authenticated requester AID, or null.
 */
function authenticatedRequester(hby: Habery, query: QueryEnvelope): string | null {
  const source = query.source?.qb64;
  if (!source) return null;
  const kever = hby.db.getKever(source);
  if (!kever?.tholder) return null;
  const verified = Kever.verifyIndexedSignatures(query.serder.raw, query.sigers ?? [], kever.verfers);
  return kever.tholder.satisfy(verified.indices) ? source : null;
}

/**
 * Decide whether one processed query makes a relaying host refresh its view of the subject, and return the query cue
 * that does it.
 *
 * Every condition must hold:
 * - the message is a remote (not local) `logs` or `ksn` query the KEL owner accepted or escrowed;
 * - its subject `q.i` is not a prefix of this Habery;
 * - its requester is authenticated (see {@link authenticatedRequester}) and served by a local host under the shared
 *   `servingHost` rule (an accepted mailbox or agent end role naming the host);
 * - the host can name an attester for the subject now ({@link queryAttesters}), so the request resolves on the
 *   querier's next pass instead of waiting in its queue.
 *
 * The cue is `{ route: "logs", q: {} }` for the subject, signed by the serving host: one full replay from the
 * attester covers both routes, since `ksn` is answered from the same key state. A `tels` query is not refreshed:
 * its wire body names the registry and credential but not the issuer the querier selects attesters by.
 *
 * @param hby Borrowed habitats and accepted-state store of the relaying host.
 * @param result Processed envelope and the decision its owner made.
 * @param mailboxAid Receiving hosted endpoint AID, or null when the request named none.
 * @returns The refresh query cue, or null when this query refreshes nothing.
 */
export function relayRefreshCue(hby: Habery, result: DispatchResult, mailboxAid: string | null): QueryCue | null {
  const { envelope, decision } = result;
  const serder = envelope.serder;
  if (envelope.local || serder.ilk !== Ilks.qry || (serder.route !== "logs" && serder.route !== "ksn")) return null;
  if (!decision || (decision.kind !== "accept" && decision.kind !== "escrow")) return null;
  const subject = (serder.ked?.q as Record<string, unknown> | undefined)?.i;
  if (typeof subject !== "string" || hby.db.prefixes.has(subject)) return null;
  const requester = authenticatedRequester(hby, queryEnvelopeFromDispatch(envelope));
  if (!requester) return null;
  const host = servingHost(hby, { sender: requester, origin: null }, mailboxAid);
  const hab = host ? hby.habs.get(host) : undefined;
  if (!hab || queryAttesters(hab, subject).length === 0) return null;
  return { kin: "query", pre: subject, route: "logs", q: {}, signer: hab.pre };
}
