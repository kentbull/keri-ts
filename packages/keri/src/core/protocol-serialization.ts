import {
  type AttachmentGroup,
  type Cigar,
  concatBytes,
  Counter,
  CounterGroup,
  Diger,
  Kinds,
  LabelDex,
  NON_TRANSFERABLE_CODES,
  type NumberPrimitive,
  OpaqueSpan,
  Prefixer,
  type SealEvent,
  type Seqner,
  type SerderACDC,
  type SerderKERI,
  type Siger,
  Texter,
  type Verfer,
  type Versionage,
  Vrsn_1_0,
} from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import {
  attachmentCounterPayloadQb64b,
  attachmentCounterQb64b,
  attachmentOrdinal,
  pathedMaterialCounterQb64b,
  resolveAttachmentGvrsn,
} from "./attachment-countering.ts";
import { type TransIdxSigGroup } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";

type SealEventLike = Readonly<{
  i: Prefixer;
  s: NumberPrimitive | Seqner | string;
  d: Diger;
}>;
type SealLastLike = Readonly<{ i: Prefixer }>;

function concatMessageWithAttachmentGroup(
  serder: SerderKERI | SerderACDC,
  attachments: readonly Uint8Array[],
  pipelined: boolean,
  gvrsn: Versionage,
  nested: boolean,
  genusify: boolean,
): Uint8Array {
  const atc = attachments.length === 0 ? new Uint8Array() : concatBytes(...attachments);
  const prefix = genusify ? Counter.makeGVC(gvrsn) : new Uint8Array();
  if (nested) {
    const body = serder.kind === Kinds.cesr ? serder.raw : Counter.enclose({
      qb64: new Texter({ code: texterCodeForRaw(serder.raw), raw: serder.raw }).qb64b,
      code: "NonNativeBodyGroup",
      version: gvrsn,
    });
    return concatBytes(
      prefix,
      Counter.enclose({
        qb64: concatBytes(body, atc),
        code: "BodyWithAttachmentGroup",
        version: gvrsn,
      }),
    );
  }
  if (!pipelined) {
    return concatBytes(prefix, atc.length === 0 ? serder.raw : concatBytes(serder.raw, atc));
  }
  if (atc.length % 4 !== 0) {
    throw new ValidationError(
      `Invalid attachment quadlet size ${atc.length} for pipelined message.`,
    );
  }
  return concatBytes(
    prefix,
    serder.raw,
    attachmentCounterQb64b("AttachmentGroup", atc.length / 4, gvrsn),
    atc,
  );
}

function texterCodeForRaw(raw: Uint8Array): string {
  const rem = raw.length % 3;
  return rem === 0 ? LabelDex.Bytes_L0 : rem === 1 ? LabelDex.Bytes_L1 : LabelDex.Bytes_L2;
}

function requireCigarVerfer(cigar: Cigar): Verfer {
  const verfer = cigar.verfer;
  if (!verfer) {
    throw new ValidationError("Reply cigar is missing verifier context.");
  }
  if (!NON_TRANSFERABLE_CODES.has(verfer.code)) {
    throw new ValidationError(
      `Attempt to use transferable prefix=${verfer.qb64} for receipt.`,
    );
  }
  return verfer;
}

/**
 * Serialize one KERI event or ACDC credential body with CESR attachments.
 *
 * KERI event callers pass signature/receipt/seal material. ACDC callers pass a
 * prebuilt proof attachment group. Live serialization may promote attachment
 * counter `gvrsn`; replay clone APIs should preserve their stored counter
 * version instead of rebuilding through this helper.
 */
export function messagize(
  serder: SerderKERI,
  args?: {
    sigers?: readonly Siger[];
    tsgs?: readonly TransIdxSigGroup[];
    seal?: SealEventLike | SealLastLike;
    wigers?: readonly Siger[];
    cigars?: readonly Cigar[];
    pipelined?: boolean;
    gvrsn?: Versionage;
    nested?: boolean;
    genusify?: boolean;
  },
): Uint8Array;
export function messagize(
  creder: SerderACDC,
  proof: Uint8Array,
  args?: { gvrsn?: Versionage; nested?: boolean; genusify?: boolean },
): Uint8Array;
export function messagize(
  serderOrCreder: SerderKERI | SerderACDC,
  argsOrProof:
    | {
      sigers?: readonly Siger[];
      tsgs?: readonly TransIdxSigGroup[];
      seal?: SealEventLike | SealLastLike;
      wigers?: readonly Siger[];
      cigars?: readonly Cigar[];
      pipelined?: boolean;
      gvrsn?: Versionage;
      nested?: boolean;
      genusify?: boolean;
    }
    | Uint8Array = {},
  proofOptions: { gvrsn?: Versionage; nested?: boolean; genusify?: boolean } = {},
): Uint8Array {
  if (argsOrProof instanceof Uint8Array) {
    if (argsOrProof.length % 4 !== 0) {
      throw new ValidationError(
        `Invalid attachments size=${argsOrProof.length}, nonintegral quadlets.`,
      );
    }
    const gvrsn = resolveAttachmentGvrsn(
      serderOrCreder,
      proofOptions.gvrsn ?? Vrsn_1_0,
      proofOptions.nested ?? false,
    );
    return concatMessageWithAttachmentGroup(
      serderOrCreder,
      [argsOrProof],
      true,
      gvrsn,
      proofOptions.nested ?? false,
      proofOptions.genusify ?? false,
    );
  }

  const {
    sigers = [],
    tsgs = [],
    seal,
    wigers = [],
    cigars = [],
    pipelined = false,
    gvrsn: requestedGvrsn = Vrsn_1_0,
    nested = false,
    genusify = false,
  } = argsOrProof;
  const gvrsn = resolveAttachmentGvrsn(serderOrCreder, requestedGvrsn, nested);
  if (sigers.length === 0 && tsgs.length === 0 && wigers.length === 0 && cigars.length === 0) {
    throw new ValidationError(
      `Missing attached signatures on message = ${JSON.stringify(serderOrCreder.ked)}.`,
    );
  }

  const attachments: Uint8Array[] = [];
  if (sigers.length > 0) {
    const sigerPayload = sigers.map((siger) => siger.qb64b);
    const sigerGroup = [
      attachmentCounterPayloadQb64b(
        "ControllerIdxSigs",
        sigers.length,
        sigerPayload,
        gvrsn,
      ),
      ...sigerPayload,
    ];
    if (seal && "s" in seal && "d" in seal) {
      const transPayload = [
        seal.i.qb64b,
        attachmentOrdinal(seal.s, gvrsn).qb64b,
        seal.d.qb64b,
        ...sigerGroup,
      ];
      attachments.push(
        attachmentCounterPayloadQb64b(
          "TransIdxSigGroups",
          1,
          transPayload,
          gvrsn,
        ),
        ...transPayload,
      );
    } else if (seal && "i" in seal) {
      const transLastPayload = [
        seal.i.qb64b,
        ...sigerGroup,
      ];
      attachments.push(
        attachmentCounterPayloadQb64b(
          "TransLastIdxSigGroups",
          1,
          transLastPayload,
          gvrsn,
        ),
        ...transLastPayload,
      );
    } else {
      attachments.push(...sigerGroup);
    }
  }

  if (tsgs.length > 0) {
    // Frozen 714 emits one aggregate group in supplied order with genus-canonical ordinals.
    const payload = tsgs.flatMap((group) => {
      const signatures = group.sigers.map((siger) => siger.qb64b);
      return [
        group.prefixer.qb64b,
        attachmentOrdinal(group.seqner, gvrsn).qb64b,
        group.diger.qb64b,
        attachmentCounterPayloadQb64b("ControllerIdxSigs", group.sigers.length, signatures, gvrsn),
        ...signatures,
      ];
    });
    attachments.push(attachmentCounterPayloadQb64b("TransIdxSigGroups", tsgs.length, payload, gvrsn), ...payload);
  }

  if (wigers.length > 0) {
    const wigerPayload = wigers.map((wiger) => {
      const verfer = wiger.verfer;
      if (verfer && !NON_TRANSFERABLE_CODES.has(verfer.code)) {
        throw new ValidationError(
          `Attempt to use transferable prefix=${verfer.qb64} for receipt.`,
        );
      }
      return wiger.qb64b;
    });
    attachments.push(
      attachmentCounterPayloadQb64b(
        "WitnessIdxSigs",
        wigers.length,
        wigerPayload,
        gvrsn,
      ),
      ...wigerPayload,
    );
  }

  if (cigars.length > 0) {
    const cigarPayload = cigars.flatMap((cigar) => {
      const verfer = requireCigarVerfer(cigar);
      return [verfer.qb64b, cigar.qb64b];
    });
    attachments.push(
      attachmentCounterPayloadQb64b(
        "NonTransReceiptCouples",
        cigars.length,
        cigarPayload,
        gvrsn,
      ),
      ...cigarPayload,
    );
  }

  return concatMessageWithAttachmentGroup(
    serderOrCreder,
    attachments,
    pipelined,
    gvrsn,
    nested,
    genusify,
  );
}

/**
 * Build the SealSourceTriples proof used to bind one credential body to its TEL
 * event.
 */
export function buildProof(
  prefixer: Prefixer,
  seqner: Seqner,
  diger: Diger,
  sigers: readonly Siger[],
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  const sigerPayload = sigers.map((siger) => siger.qb64b);
  const sigerGroup = [
    attachmentCounterPayloadQb64b(
      "ControllerIdxSigs",
      sigers.length,
      sigerPayload,
      gvrsn,
    ),
    ...sigerPayload,
  ];
  const transPayload = [
    prefixer.qb64b,
    attachmentOrdinal(seqner, gvrsn).qb64b,
    diger.qb64b,
    ...sigerGroup,
  ];
  return concatBytes(
    attachmentCounterPayloadQb64b(
      "TransIdxSigGroups",
      1,
      transPayload,
      gvrsn,
    ),
    ...transPayload,
  );
}

/**
 * Serialize one KERI message with transferable indexed signatures,
 * non-transferable receipts, and optional pathed material.
 *
 * This is the general-purpose live-message serializer used by exchange and
 * credential flows. It owns counter selection for constructed attachments, but
 * not stored KEL/TEL replay byte preservation.
 */
export function serializeMessage(
  serder: SerderKERI,
  {
    tsgs = [],
    cigars = [],
    pathed = [],
    sourceSeals = [],
    pipelined = false,
    gvrsn: requestedGvrsn = Vrsn_1_0,
    nested = false,
    genusify = false,
  }: {
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    sourceSeals?: readonly SealEvent[];
    pathed?: readonly (string | Uint8Array)[];
    pipelined?: boolean;
    gvrsn?: Versionage;
    nested?: boolean;
    genusify?: boolean;
  } = {},
): Uint8Array {
  const gvrsn = resolveAttachmentGvrsn(serder, requestedGvrsn, nested);
  const groups = messageAttachmentGroups({ tsgs, cigars, sourceSeals, pathed }, gvrsn);
  return concatMessageWithAttachmentGroup(serder, groups.map((group) => group.raw), pipelined, gvrsn, nested, genusify);
}

/** Existing exchange evidence accepted by both finite message encoding and streamed frame replay. */
export interface MessageEvidence {
  /** Transferable endorsements tied to accepted establishment coordinates. */
  tsgs?: readonly TransIdxSigGroup[];
  /** Nontransferable endorsements carrying their verifiers. */
  cigars?: readonly Cigar[];
  /** Explicit anchoring AID and historical source coordinate. */
  sourceSeals?: readonly SealEvent[];
  /** Finite qualified path material in original order. */
  pathed?: readonly (string | Uint8Array)[];
}

/**
 * Build real CESR leaf groups from hydrated exchange evidence without parsing the body again.
 * The caller supplies the resolved genus. Group raw includes its counter, and semantic tuples
 * retain the original primitives for subsequent normalization; pathed material remains opaque.
 */
export function messageAttachmentGroups(
  { tsgs = [], cigars = [], sourceSeals = [], pathed = [] }: MessageEvidence,
  gvrsn: Versionage,
): AttachmentGroup[] {
  const groups: AttachmentGroup[] = [];
  for (const tsg of tsgs) {
    const sigers = tsg.sigers.map((siger) => siger.qb64b);
    const inner = attachmentCounterPayloadQb64b("ControllerIdxSigs", tsg.sigers.length, sigers, gvrsn);
    // KERIpy writes the compact v2 Number or the fixed v1 Seqner, whichever ordinal it holds.
    const ordinal = attachmentOrdinal(tsg.seqner, gvrsn);
    const payload = [tsg.prefixer.qb64b, ordinal.qb64b, tsg.diger.qb64b, inner, ...sigers];
    const header = attachmentCounterPayloadQb64b("TransIdxSigGroups", 1, payload, gvrsn);
    groups.push(
      new CounterGroup(new Counter({ qb64b: header, version: gvrsn }), concatBytes(header, ...payload), [[
        tsg.prefixer,
        ordinal,
        tsg.diger,
        tsg.sigers,
      ]]),
    );
  }
  if (cigars.length) {
    const couples = cigars.map((cigar) => [requireCigarVerfer(cigar), cigar] as const);
    const payload = couples.flatMap(([verfer, cigar]) => [verfer.qb64b, cigar.qb64b]);
    const header = attachmentCounterPayloadQb64b("NonTransReceiptCouples", cigars.length, payload, gvrsn);
    groups.push(
      new CounterGroup(new Counter({ qb64b: header, version: gvrsn }), concatBytes(header, ...payload), couples),
    );
  }
  if (sourceSeals.length) {
    const triples = sourceSeals.map((seal) =>
      [
        seal.i,
        attachmentOrdinal(seal.s, gvrsn),
        seal.d,
      ] as const
    );
    const payload = triples.flatMap((triple) => triple.map((part) => part.qb64b));
    const header = attachmentCounterPayloadQb64b("SealSourceTriples", triples.length, payload, gvrsn);
    groups.push(
      new CounterGroup(new Counter({ qb64b: header, version: gvrsn }), concatBytes(header, ...payload), triples),
    );
  }
  for (const path of pathed) {
    const raw = typeof path === "string" ? new TextEncoder().encode(path) : path;
    if (raw.length % 4 !== 0) {
      throw new ValidationError(`Invalid pathed material size=${raw.length}, nonintegral quadlets.`);
    }
    const header = pathedMaterialCounterQb64b(raw.length / 4, gvrsn);
    groups.push(
      new CounterGroup(new Counter({ qb64b: header, version: gvrsn }), concatBytes(header, raw), [
        new OpaqueSpan(raw, "txt"),
      ]),
    );
  }
  return groups;
}

/**
 * Project one stored KEL event plus local receipt/signature metadata into a
 * command-facing JSON record.
 */
export function loadEvent(
  db: Baser,
  pre: string,
  dig: string,
): Record<string, unknown> {
  const serder = db.getEvtSerder(pre, dig);
  if (!serder) {
    throw new ValidationError(`Missing event for dig=${dig}.`);
  }

  const event: Record<string, unknown> = { ked: serder.ked };
  const sn = serder.sn ?? 0;
  if (db.kels.getLast(pre, sn) !== null) {
    event.stored = true;
  }

  const dgkey = dgKey(pre, dig);
  event.signatures = db.sigs.get(dgkey).map((siger) => ({
    index: siger.index,
    signature: siger.qb64,
  }));
  event.witnesses = serder.estive ? db.wits.get(dgkey).map((wit) => wit.qb64) : [];
  event.witness_signatures = db.wigs.get(dgkey).map((wiger) => ({
    index: wiger.index,
    signature: wiger.qb64,
  }));

  const sourceSeal = db.aess.get(dgkey);
  if (sourceSeal) {
    const [number, diger] = sourceSeal;
    event.source_seal = {
      sequence: Number(number.num),
      said: diger.qb64,
    };
  }

  const receipts: Record<string, unknown> = {};
  const transferable = db.vrcs.get(dgkey).map((
    [prefixer, number, diger, siger],
  ) => ({
    prefix: prefixer.qb64,
    sequence: number.qb64,
    said: diger.qb64,
    signature: siger.qb64,
  }));
  if (transferable.length > 0) {
    receipts.transferable = transferable;
  }
  const nontransferable = db.rcts.get(dgkey).map(([prefixer, cigar]) => ({
    prefix: prefixer.qb64,
    signature: cigar.qb64,
  }));
  if (nontransferable.length > 0) {
    receipts.nontransferable = nontransferable;
  }
  event.receipts = receipts;

  const dater = db.dtss.get(dgkey);
  if (!dater) {
    throw new ValidationError(`Missing datetime for dig=${dig}.`);
  }
  event.timestamp = dater.dts;

  return event;
}
