import type { ReplyCue } from "../core/cues.ts";
import type { QueryEnvelope } from "../core/eventing.ts";
import type { Tever } from "./eventing.ts";

type RegistryReply = Extract<ReplyCue, { route: "/tsn/registry" }>;
type CredentialReply = Extract<ReplyCue, { route: "/tsn/credential" }>;

/** Internal TSN production outcome; missing credentials retain the registry response. */
export type TsnQueryResult =
  | { kind: "reply"; replies: readonly [RegistryReply] | readonly [RegistryReply, CredentialReply] }
  | { kind: "unavailable" }
  | { kind: "drop"; reason: "unsupportedRoute" | "missingAuthentication" | "invalidQuery" };

/** Prepare at most two legacy TSN replies without publishing cues.
 * Requester material selects the destination, as in 714; it does not verify the query.
 * Receiving these records still requires independent BADA, trust and accepted TEL checks.
 * Storage/invariant failures propagate. State helpers retain their existing read limits.
 */
export function prepareTsnQuery(
  { serder, source, cigars }: QueryEnvelope,
  tevers: ReadonlyMap<string, Tever>,
): TsnQueryResult {
  if (serder.route !== "tsn") return { kind: "drop", reason: "unsupportedRoute" };
  const dest = source?.qb64 ?? cigars?.[0]?.verfer?.qb64;
  if (!dest) return { kind: "drop", reason: "missingAuthentication" };
  const query = serder.ked?.q;
  if (
    !query || typeof query !== "object" || Array.isArray(query)
    || !("ri" in query) || typeof query.ri !== "string" || !query.ri
    || !("i" in query) || typeof query.i !== "string"
  ) {
    return { kind: "drop", reason: "invalidQuery" };
  }
  const tever = tevers.get(query.ri);
  if (!tever) return { kind: "unavailable" };
  const querySaid = serder.said ?? undefined;
  const registry: RegistryReply = {
    kin: "reply",
    route: "/tsn/registry",
    data: tever.state(),
    dest,
    querySaid,
  };
  if (!query.i) return { kind: "reply", replies: [registry] };
  // 714 processQuery passes nonexistent vcpre=; use the actual vcState(vci) helper.
  const credential = tever.vcState(query.i);
  if (!credential) return { kind: "reply", replies: [registry] };
  return {
    kind: "reply",
    replies: [registry, { kin: "reply", route: "/tsn/credential", data: credential, dest, querySaid }],
  };
}
