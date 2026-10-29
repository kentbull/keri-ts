import {
  concatBytes,
  type Diger,
  Ilks,
  type Kind,
  Kinds,
  makePather,
  NonceDex,
  Noncer,
  reapSerder,
  Saider,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { type Cigar } from "cesr-ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import { pathedMaterialCounterQb64b } from "../attachment-countering.ts";
import { type TransIdxSigGroup } from "../dispatch.ts";
import { serializeMessage as serializeExchangeMessage } from "../protocol-serialization.ts";

/** Closed IPEX verb vocabulary shared by protocol versions. */
export type IpexVerb = "apply" | "offer" | "agree" | "grant" | "admit" | "spurn";

/** Narrow a wire route component before consulting version-specific policy. */
export function isIpexVerb(value: string): value is IpexVerb {
  return value === "apply"
    || value === "offer"
    || value === "agree"
    || value === "grant"
    || value === "admit"
    || value === "spurn";
}

/** KERIpy acdc.ipexing PreviousRoutes, shared by v2 construction and accepted-conversation verification. */
export const IPEX_V2_PREDECESSORS: Readonly<Record<Exclude<IpexVerb, "apply">, readonly IpexVerb[]>> = {
  offer: ["apply"],
  agree: ["offer"],
  grant: ["apply", "agree"],
  admit: ["grant"],
  spurn: ["apply", "offer", "agree", "grant"],
};

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
  gvrsn: Versionage = Vrsn_1_0,
): { e: Record<string, unknown>; end: Uint8Array } {
  const e: Record<string, unknown> = {};
  const groups: Uint8Array[] = [];
  for (const [label, msg] of Object.entries(embeds)) {
    const { serder, consumed } = reapSerder(msg);
    if (!serder.ked) {
      throw new Error(`Embedded ${label} message is missing decoded SAD.`);
    }
    e[label] = serder.ked;
    const atc = msg.slice(consumed);
    if (atc.length === 0) {
      continue;
    }
    const pathed = concatBytes(makePather(["e", label]).qb64b, atc);
    if (pathed.length % 4 !== 0) {
      throw new Error(
        `Embedded ${label} pathed attachment length ${pathed.length} is not quadlet aligned.`,
      );
    }
    groups.push(
      concatBytes(
        pathedMaterialCounterQb64b(pathed.length / 4, gvrsn),
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
  const { e, end } = encodePathedEmbeds(embeds ?? {}, resolved.gvrsn ?? Vrsn_1_0);
  const actualModifiers = { ...(modifiers ?? {}) };

  if (resolved.pvrsn.major === 1) {
    const attrs = diger ? diger.qb64 : {
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
    gvrsn = Vrsn_1_0,
  }: {
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    pathed?: readonly (string | Uint8Array)[];
    pipelined?: boolean;
    gvrsn?: Versionage;
  } = {},
): Uint8Array {
  return serializeExchangeMessage(serder, {
    tsgs,
    cigars,
    pathed,
    pipelined,
    gvrsn,
  });
}

/** Selected ACDC v2 multisig routes; exact child relationships remain the coordinator's obligation. */
export function nestedMultisigIlks(route: string): readonly string[] | null {
  switch (route) {
    case "/multisig/rip":
      return ["rip", "ixn", "rot", "drt"];
    case "/multisig/bup":
      return ["bup", "ixn", "rot", "drt"];
    case "/multisig/exn":
      return ["exn"];
    case "/multisig/icp":
      return ["icp", "dip"];
    case "/multisig/rot":
      return ["rot"];
    case "/multisig/ixn":
      return ["ixn"];
    case "/multisig/rpy":
      return ["rpy"];
    default:
      return null;
  }
}

/** V2 routes whose handlers own direct disclosed ACDC children. */
export function nestedIpexRoute(route: string): boolean {
  return route === "/ipex/offer" || route === "/ipex/grant";
}

/** Structural v2 nested-route support; handler child validation and independent proofs remain separate obligations. */
export function supportsNestedExchange(route: string, protocolMajor: number): boolean {
  return protocolMajor >= 2 && (route === "/fwd" || nestedMultisigIlks(route) !== null || nestedIpexRoute(route));
}
