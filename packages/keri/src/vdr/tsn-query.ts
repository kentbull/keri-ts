import type { ReplyCue } from "../core/cues.ts";
import type { QueryEnvelope } from "../core/eventing.ts";
import type { Tever } from "./eventing.ts";

/** Internal TSN production outcome; missing credentials retain the registry response. */
export type TsnQueryResult =
  | { kind: "reply"; replies: readonly [ReplyCue] | readonly [ReplyCue, ReplyCue]; missingCredential?: string }
  | { kind: "unavailable"; registry: string }
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
  const query = serder.ked?.q as Record<string, unknown> | undefined;
  if (!query || typeof query.ri !== "string" || !query.ri || typeof query.i !== "string") {
    return { kind: "drop", reason: "invalidQuery" };
  }
  const tever = tevers.get(query.ri);
  if (!tever) return { kind: "unavailable", registry: query.ri };
  const response = (route: string, data: Record<string, unknown>): ReplyCue => ({
    kin: "reply",
    route,
    data,
    dest,
    querySaid: serder.said ?? undefined,
  });
  const registry = response("/tsn/registry", tever.state().asDict());
  if (!query.i) return { kind: "reply", replies: [registry] };
  // 714 processQuery passes nonexistent vcpre=; use the actual vcState(vci) helper.
  const credential = tever.vcState(query.i);
  if (!credential) return { kind: "reply", replies: [registry], missingCredential: query.i };
  return { kind: "reply", replies: [registry, response("/tsn/credential", credential.asDict())] };
}
