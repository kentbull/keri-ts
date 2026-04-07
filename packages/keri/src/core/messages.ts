import { concatBytes, Counter, CtrDexV1, Ilks, makePather, Saider, SerderKERI } from "../../../cesr/mod.ts";
import { makeNowIso8601 } from "../time/mod.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

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

/**
 * Build one canonical `exn` plus any pathed attachment groups for embedded CESR.
 *
 * KERIpy correspondence:
 * - mirrors `peer.exchanging.exchange(..., embeds=...)`
 * - nested embedded SADs live in `e`
 * - embedded attachment material is emitted as trailing pathed groups
 */
export function makeEmbeddedExchangeMessage(
  route: string,
  payload: Record<string, unknown>,
  {
    sender,
    recipient = "",
    modifiers = {},
    stamp = makeNowIso8601(),
    dig = "",
    embeds = {},
  }: {
    sender: string;
    recipient?: string;
    modifiers?: Record<string, unknown>;
    stamp?: string;
    dig?: string;
    embeds?: Record<string, Uint8Array>;
  },
): { serder: SerderKERI; attachments: Uint8Array } {
  const e = exchangeEmbedsFromMessages(embeds);
  const serder = new SerderKERI({
    sad: {
      t: Ilks.exn,
      i: sender,
      rp: recipient,
      p: dig,
      dt: stamp,
      r: route,
      q: modifiers,
      a: payload,
      e: e.ked,
    },
    makify: true,
  });
  return { serder, attachments: e.attachments };
}

function exchangeEmbedsFromMessages(
  embeds: Record<string, Uint8Array>,
): { ked: Record<string, unknown>; attachments: Uint8Array } {
  const ked: Record<string, unknown> = {};
  const groups: Uint8Array[] = [];

  for (const [label, message] of Object.entries(embeds)) {
    const embedded = new SerderKERI({ raw: message });
    ked[label] = embedded.ked;
    const atc = message.slice(embedded.size);
    if (atc.length === 0) {
      continue;
    }

    const pather = makePather(["e", label]);
    const pathed = concatBytes(pather.qb64b, atc);
    if (pathed.length % 4 !== 0) {
      throw new Error(
        `Embedded attachment payload for ${label} must occupy whole quadlets.`,
      );
    }

    const code = pathed.length / 4 < 4096
      ? CtrDexV1.PathedMaterialCouples
      : CtrDexV1.BigPathedMaterialCouples;
    groups.push(
      concatBytes(
        new Counter({
          code,
          count: pathed.length / 4,
          version: KERI_V1,
        }).qb64b,
        pathed,
      ),
    );
  }

  if (Object.keys(ked).length === 0) {
    return { ked, attachments: new Uint8Array() };
  }

  const saidified = Saider.saidify({ ...ked, d: "" }, {}).sad;
  return {
    ked: saidified,
    attachments: groups.length === 0 ? new Uint8Array() : concatBytes(...groups),
  };
}
