/**
 * Relay mode: an edge runtime that sends, queries and polls only through its agent.
 *
 * A runtime composed with a {@link Relay} is an edge. It signs locally and hands every outgoing message to the
 * relay agent, which does the forwarding, much as a KERIA agent re-sends a Signify controller's signed exchange
 * with its own `StreamPoster` (keria/src/keria/app/agenting.py `ExchangeSender`). The hand-off is the existing
 * `POST /` CESR ingress carrying a `/fwd` exchange, so there is no new route or wire format. A runtime without a
 * relay is a forwarder and delivers directly.
 *
 * The edge does not trust the agent for validity: it resolves the agent's own OOBI and holds the agent's accepted
 * KEL, end-role and location replies, and reads the agent's location from that accepted state exactly as
 * `Hab.endsFor` reads any party's. What the edge stops needing is every other party's endpoints for sending.
 */
import type { Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Roles } from "../../core/roles.ts";
import type { Habery } from "../identity/habbing.ts";
import { fetchEndpointUrls, preferredUrl } from "../mailbox/mailboxing.ts";
import type { HttpClient, HttpRequestInit, HttpResponse, HttpStreamResponse } from "../transport/http-client.ts";
import type { MessengerUrls } from "../transport/messengering.ts";
import type { TcpDialer } from "../transport/tcp-dialer.ts";
import { TransportError } from "../transport/transport-error.ts";

/** The agent this runtime sends, queries and polls through; `oobi` is the agent's own OOBI. */
export interface Relay {
  /** The relay agent's AID; its accepted location is where every outgoing message goes. */
  readonly aid: string;
  /** The relay agent's own OOBI URL, resolved to learn the agent's KEL, end roles and location. */
  readonly oobi: string;
}

/** Accepted location of the relay, read from the relay's accepted `/loc/scheme` replies. */
export interface RelayEndpoint {
  /** The relay agent's AID, which is also the endpoint AID. */
  readonly eid: string;
  /** Preferred URL of the accepted locations: HTTPS, then HTTP, then TCP. */
  readonly url: string;
  /** Every accepted location of the relay by supported scheme, for concrete messenger construction. */
  readonly urls: MessengerUrls;
}

/** The relay's location is not accepted yet (its OOBI has not resolved); nothing was sent. */
export class RelayUnresolvedError extends ValidationError {
  override readonly name: string = "RelayUnresolvedError";
}

/**
 * The sending identity has not authorized the relay as its `mailbox`; nothing was sent. The agent relays only for a
 * sender that named it its mailbox, so a wrapper sent before that would be dropped there without an answer.
 */
export class RelayUnauthorizedError extends ValidationError {
  override readonly name: string = "RelayUnauthorizedError";
}

/** Why the relay cannot carry a message now; see {@link relayRefusal}. */
export type RelayRefusal = RelayUnresolvedError | RelayUnauthorizedError;

/** Refuses a request whose origin is neither the relay's OOBI origin nor an accepted relay location. */
export class RelayOnlyError extends TransportError {
  override readonly name: string = "RelayOnlyError";
}

/**
 * Read the relay's accepted location, as `Hab.endsFor` reads any endpoint's locations.
 *
 * Locations are accepted only from `/loc/scheme` replies verified against the relay's KEL, so a non-null result
 * means the relay's OOBI (or an equivalent introduction) has resolved.
 *
 * @param hby Borrowed accepted-state store holding the relay's location replies.
 * @param relay The configured relay agent.
 * @returns The relay's preferred URL and scheme map, or null until a supported location is accepted.
 */
export function relayEndpoint(hby: Habery, relay: Relay): RelayEndpoint | null {
  const accepted = fetchEndpointUrls(hby, relay.aid);
  const urls: MessengerUrls = {};
  if (accepted.https) urls.https = accepted.https;
  if (accepted.http) urls.http = accepted.http;
  if (accepted.tcp) urls.tcp = accepted.tcp;
  const url = preferredUrl(accepted);
  return url ? { eid: relay.aid, url, urls } : null;
}

/**
 * Whether `pre` has authorized the relay as its mailbox: the accepted row `ends.[pre, mailbox, relay.aid]` is
 * allowed. This is the row the agent reads to decide that it serves the sender, and the edge holds it because it
 * signed and accepted the end-role reply itself (`addMailbox`).
 *
 * @param hby Borrowed accepted-state store holding end-role replies.
 * @param pre Local identifier that signs what goes to the relay (for a group, its local member).
 * @param relay The configured relay agent.
 * @returns True when the mailbox role naming the relay is accepted and allowed.
 */
export function relayAuthorized(hby: Habery, pre: string, relay: Relay): boolean {
  return hby.db.ends.get([pre, Roles.mailbox, relay.aid])?.allowed === true;
}

/**
 * Decide whether the relay can carry a message signed by `signer` now, before anything is prepared or sent.
 *
 * The relay must have an accepted location. A message it is to forward also needs `signer` to have authorized it as
 * mailbox; a message addressed to the relay itself (`signer` null) needs no authorization, as the relay consumes it
 * rather than forwarding it. Onboarding needs neither path: the mailbox add is posted to the relay's `/mailboxes`
 * admin resource and carries the KEL that introduces the edge.
 *
 * @param hby Borrowed accepted-state store holding the relay's location and the signer's end roles.
 * @param relay The configured relay agent.
 * @param signer Local identifier that signs the forwarding wrapper or query; null for a message to the relay itself.
 * @returns The refusal to report, or null when the relay can carry the message.
 */
export function relayRefusal(hby: Habery, relay: Relay, signer: string | null): RelayRefusal | null {
  if (!relayEndpoint(hby, relay)) {
    return new RelayUnresolvedError(`Relay ${relay.aid} has no accepted location; its OOBI has not resolved.`);
  }
  if (signer !== null && !relayAuthorized(hby, signer, relay)) {
    return new RelayUnauthorizedError(`${signer} has not authorized relay ${relay.aid} as its mailbox.`);
  }
  return null;
}

/**
 * Scheme and authority of a URL, comparable across `http(s):` and `tcp:` (whose WHATWG `origin` is `"null"`).
 *
 * @param url Candidate absolute URL.
 * @returns `scheme://host[:port]`, or null when the URL does not parse.
 */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : null;
  } catch {
    return null;
  }
}

/**
 * Refuse egress to anything but the relay. The relay's accepted locations are read on every request, so a
 * location accepted (or replaced) after composition is honored without rebuilding the client.
 *
 * @param hby Borrowed accepted-state store holding the relay's location replies.
 * @param relay The configured relay agent.
 * @param oobiOrigin Origin of the relay's own OOBI, allowed before its location is accepted.
 * @param url Requested URL.
 * @throws RelayOnlyError when the URL's origin is not the relay's.
 */
function requireRelayOrigin(hby: Habery, relay: Relay, oobiOrigin: string, url: string): void {
  const origin = originOf(url);
  if (origin !== null) {
    if (origin === oobiOrigin) return;
    for (const location of Object.values(fetchEndpointUrls(hby, relay.aid))) {
      if (originOf(location) === origin) return;
    }
  }
  throw new RelayOnlyError(`Relay-only egress refused ${origin ?? "an unparseable URL"}; relay is ${relay.aid}.`);
}

/**
 * Wrap an HTTP client (and its TCP dialer, when present) so it reaches only the relay.
 *
 * The guard is the edge's fail-closed boundary: egress kinds not yet routed through the relay (delegation, TEL
 * receipting, witness registration, well-known authentication) fail as `TransportError` instead of going direct.
 * It allows the origin of the relay's OOBI and the origins of the relay's currently accepted locations.
 *
 * @param inner Borrowed client that performs permitted requests.
 * @param hby Borrowed accepted-state store holding the relay's location replies.
 * @param relay The configured relay agent.
 * @returns A client with the same contract whose refused requests throw RelayOnlyError before any I/O.
 * @throws ValidationError when the relay's OOBI is not an absolute HTTP(S) URL.
 */
export function relayOnlyHttpClient(inner: HttpClient, hby: Habery, relay: Relay): HttpClient {
  const oobiOrigin = originOf(relay.oobi);
  if (!relay.aid || oobiOrigin === null || !/^https?:\/\//.test(oobiOrigin)) {
    throw new ValidationError(`Relay requires an AID and an absolute HTTP(S) OOBI URL; got ${relay.oobi}.`);
  }
  const dialer = inner.tcp;
  const tcp: TcpDialer | undefined = dialer
    ? {
      messenger(url, clock, protocol) {
        requireRelayOrigin(hby, relay, oobiOrigin, url);
        return dialer.messenger(url, clock, protocol);
      },
      streamMessenger(url, clock, payload) {
        requireRelayOrigin(hby, relay, oobiOrigin, url);
        return dialer.streamMessenger(url, clock, payload);
      },
    }
    : undefined;
  return {
    ...(tcp ? { tcp } : {}),
    *request(url: string, init?: HttpRequestInit): Operation<HttpResponse> {
      requireRelayOrigin(hby, relay, oobiOrigin, url);
      return yield* inner.request(url, init);
    },
    *open(url: string, init?: HttpRequestInit): Operation<HttpStreamResponse> {
      requireRelayOrigin(hby, relay, oobiOrigin, url);
      return yield* inner.open(url, init);
    },
  };
}
