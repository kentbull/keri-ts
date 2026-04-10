import {
  concatBytes,
  Counter,
  CtrDexV1,
  type Diger,
  Ilks,
  type Kind,
  Kinds,
  makePather,
  NonceDex,
  Noncer,
  Saider,
  Serder,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../cesr/mod.ts";
import { type Cigar } from "../../../cesr/mod.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { type TransIdxSigGroup } from "./dispatch.ts";
import { serializeMessage as serializeExchangeMessage } from "./protocol-serialization.ts";

function resolveVersion(
  version?: Versionage,
  pvrsn?: Versionage,
  gvrsn?: Versionage | null,
  kind?: Kind,
): {
  pvrsn: Versionage;
  gvrsn: Versionage | null;
  kind: Kind;
} {
  const actualPvrsn = pvrsn ?? version ?? Vrsn_1_0;
  return {
    pvrsn: actualPvrsn,
    gvrsn: gvrsn ?? (actualPvrsn.major >= 2 ? Vrsn_2_0 : null),
    kind: kind ?? Kinds.json,
  };
}

function encodePathedEmbeds(
  embeds: Record<string, Uint8Array>,
): { e: Record<string, unknown>; end: Uint8Array } {
  const e: Record<string, unknown> = {};
  const groups: Uint8Array[] = [];
  for (const [label, msg] of Object.entries(embeds)) {
    const serder = new Serder({ raw: msg });
    e[label] = serder.ked;
    const atc = msg.slice(serder.size);
    if (atc.length === 0) {
      continue;
    }
    const pathed = concatBytes(makePather(["e", label]).qb64b, atc);
    const code = pathed.length / 4 < 4096
      ? CtrDexV1.PathedMaterialCouples
      : CtrDexV1.BigPathedMaterialCouples;
    groups.push(
      concatBytes(
        new Counter({
          code,
          count: pathed.length / 4,
          version: Vrsn_1_0,
        }).qb64b,
        pathed,
      ),
    );
  }

  if (Object.keys(e).length > 0) {
    const saidified = Saider.saidify({ ...e, d: "" }, { label: "d" }).sad;
    return {
      e: saidified,
      end: groups.length === 0 ? new Uint8Array() : concatBytes(...groups),
    };
  }

  return { e, end: new Uint8Array() };
}

export function exincept(
  route = "",
  {
    sender = "",
    receiver = "",
    modifiers,
    attributes,
    nonce,
    stamp,
    pvrsn = Vrsn_2_0,
    gvrsn,
    kind = Kinds.json,
  }: {
    sender?: string;
    receiver?: string;
    modifiers?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    nonce?: string;
    stamp?: string;
    pvrsn?: Versionage;
    gvrsn?: Versionage | null;
    kind?: Kind;
  } = {},
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.xip,
      d: "",
      u: nonce ?? new Noncer({
        code: NonceDex.Salt_128,
        raw: crypto.getRandomValues(new Uint8Array(16)),
      }).qb64,
      i: sender,
      ri: receiver,
      dt: stamp ?? makeNowIso8601(),
      r: route,
      q: { ...(modifiers ?? {}) },
      a: { ...(attributes ?? {}) },
    },
    pvrsn,
    gvrsn: gvrsn ?? Vrsn_2_0,
    kind,
    makify: true,
  });
}

export function exchange(
  route: string,
  payload: Record<string, unknown> = {},
  {
    sender,
    diger,
    recipient,
    date,
    stamp,
    dig = "",
    xid = "",
    modifiers,
    embeds,
    version,
    pvrsn,
    gvrsn,
    kind,
  }: {
    sender: string;
    diger?: Diger | null;
    recipient?: string;
    date?: string;
    stamp?: string;
    dig?: string;
    xid?: string;
    modifiers?: Record<string, unknown>;
    embeds?: Record<string, Uint8Array>;
    version?: Versionage;
    pvrsn?: Versionage;
    gvrsn?: Versionage | null;
    kind?: Kind;
  },
): readonly [SerderKERI, Uint8Array] {
  const resolved = resolveVersion(version, pvrsn, gvrsn, kind);
  const dt = date ?? stamp ?? makeNowIso8601();
  const { e, end } = encodePathedEmbeds(embeds ?? {});
  const actualModifiers = { ...(modifiers ?? {}) };

  if (resolved.pvrsn.major === 1) {
    const attrs = diger
      ? diger.qb64
      : {
        ...(recipient === undefined ? {} : { i: recipient }),
        ...payload,
      };
    return [
      new SerderKERI({
        sad: {
          t: Ilks.exn,
          d: "",
          i: sender,
          rp: recipient ?? "",
          p: dig ?? "",
          dt,
          r: route,
          q: actualModifiers,
          a: attrs,
          e,
        },
        pvrsn: resolved.pvrsn,
        gvrsn: resolved.gvrsn ?? undefined,
        kind: resolved.kind,
        makify: true,
      }),
      end,
    ] as const;
  }

  const attrs: Record<string, unknown> = {};
  if (Object.keys(e).length > 0) {
    attrs.e = e;
  }
  Object.assign(attrs, payload);
  return [
    new SerderKERI({
      sad: {
        t: Ilks.exn,
        d: "",
        i: sender,
        ri: recipient ?? "",
        x: xid ?? "",
        p: dig ?? "",
        dt,
        r: route,
        q: actualModifiers,
        a: attrs,
      },
      pvrsn: resolved.pvrsn,
      gvrsn: resolved.gvrsn ?? undefined,
      kind: resolved.kind,
      makify: true,
    }),
    end,
  ] as const;
}

export function serializeMessage(
  serder: SerderKERI,
  {
    tsgs,
    cigars,
    pathed,
    pipelined = false,
  }: {
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    pathed?: readonly (string | Uint8Array)[];
    pipelined?: boolean;
  } = {},
): Uint8Array {
  return serializeExchangeMessage(serder, { tsgs, cigars, pathed, pipelined });
}
