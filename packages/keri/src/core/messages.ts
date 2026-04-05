import { Ilks, SerderKERI } from "../../../cesr/mod.ts";
import { makeNowIso8601 } from "../time/mod.ts";

/**
 * Build one canonical `rct` serder for a receipted event.
 *
 * This is protocol construction, not habitat orchestration, so it lives in the
 * core layer and is shared by any source or test that needs the canonical KERI
 * receipt body shape.
 */
export function makeReceiptSerder(
  pre: string,
  sn: number,
  said: string,
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.rct,
      d: said,
      i: pre,
      s: sn.toString(16),
    },
    makify: true,
  });
}

/**
 * Build one canonical `rpy` serder from route, attributes, and timestamp.
 *
 * This mirrors the KERIpy `reply(...)` body shape and keeps reply creation in
 * the core protocol layer instead of app-local helpers.
 */
export function makeReplySerder(
  route: string,
  data: Record<string, unknown>,
  stamp = makeNowIso8601(),
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.rpy,
      dt: stamp,
      r: route,
      a: data,
    },
    makify: true,
  });
}

/**
 * Build one canonical `qry` serder from route, query body, and timestamp.
 *
 * KERIpy correspondence:
 * - mirrors `queryEvent(...)` / `BaseHab.query(...)` for version-1 KERI query
 *   messages, where the queried prefix `i` and attester `src` live inside `q`
 */
export function makeQuerySerder(
  route: string,
  query: Record<string, unknown>,
  stamp = makeNowIso8601(),
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.qry,
      dt: stamp,
      r: route,
      rr: "",
      q: query,
    },
    makify: true,
  });
}

/**
 * Build one canonical `exn` serder from route, sender, recipient, and payload.
 *
 * Current version policy:
 * - uses the version-1 KERI `exn` body shape already exercised by the current
 *   `SerderKERI` field registry
 * - keeps `q` present as an explicit modifiers map even when empty so the
 *   generated message matches KERIpy's durable exchange-message shape
 */
export function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  {
    sender,
    recipient = "",
    modifiers = {},
    stamp = makeNowIso8601(),
    dig = "",
  }: {
    sender: string;
    recipient?: string;
    modifiers?: Record<string, unknown>;
    stamp?: string;
    dig?: string;
  },
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.exn,
      i: sender,
      rp: recipient,
      p: dig,
      dt: stamp,
      r: route,
      q: modifiers,
      a: payload,
      e: {},
    },
    makify: true,
  });
}
