import {
  type Cigar,
  concatBytes,
  Counter,
  Diger,
  Kinds,
  LabelDex,
  NON_TRANSFERABLE_CODES,
  type NumberPrimitive,
  Prefixer,
  Seqner,
  type SerderACDC,
  type SerderKERI,
  type Siger,
  Texter,
  type Verfer,
  type Versionage,
  Vrsn_1_0,
} from "../../../cesr/mod.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import {
  attachmentCounterPayloadQb64b,
  attachmentCounterQb64b,
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

function hexToFixedBytes(hex: string, size: number): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new ValidationError(`Invalid hex ordinal ${hex}`);
  }
  if (normalized.length > size * 2) {
    throw new ValidationError(`Hex ordinal ${hex} exceeds ${size} bytes.`);
  }

  const raw = new Uint8Array(size);
  const padded = normalized.padStart(size * 2, "0");
  for (let i = 0; i < size; i++) {
    raw[i] = Number.parseInt(padded.slice(i * 2, (i * 2) + 2), 16);
  }
  return raw;
}

function encodeSealSeqnerQb64b(
  seq: NumberPrimitive | Seqner | string,
): Uint8Array {
  if (seq instanceof Seqner) {
    return seq.qb64b;
  }
  const snh = typeof seq === "string" ? seq : seq.numh;
  return new Seqner({ code: "0A", raw: hexToFixedBytes(snh, 16) }).qb64b;
}

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
    seal,
    wigers = [],
    cigars = [],
    pipelined = false,
    gvrsn: requestedGvrsn = Vrsn_1_0,
    nested = false,
    genusify = false,
  } = argsOrProof;
  const gvrsn = resolveAttachmentGvrsn(serderOrCreder, requestedGvrsn, nested);
  if (sigers.length === 0 && wigers.length === 0 && cigars.length === 0) {
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
        encodeSealSeqnerQb64b(seal.s),
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
    seqner.qb64b,
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
    pipelined = false,
    gvrsn: requestedGvrsn = Vrsn_1_0,
    nested = false,
    genusify = false,
  }: {
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    pathed?: readonly (string | Uint8Array)[];
    pipelined?: boolean;
    gvrsn?: Versionage;
    nested?: boolean;
    genusify?: boolean;
  } = {},
): Uint8Array {
  const attachments: Uint8Array[] = [];
  const gvrsn = resolveAttachmentGvrsn(serder, requestedGvrsn, nested);

  for (const tsg of tsgs) {
    const sigerPayload = tsg.sigers.map((siger) => siger.qb64b);
    const sigerGroup = [
      attachmentCounterPayloadQb64b(
        "ControllerIdxSigs",
        tsg.sigers.length,
        sigerPayload,
        gvrsn,
      ),
      ...sigerPayload,
    ];
    const transPayload = [
      tsg.prefixer.qb64b,
      encodeSealSeqnerQb64b(tsg.seqner),
      tsg.diger.qb64b,
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

  for (const path of pathed) {
    const raw = typeof path === "string" ? new TextEncoder().encode(path) : path;
    if (raw.length % 4 !== 0) {
      throw new ValidationError(
        `Invalid pathed material size=${raw.length}, nonintegral quadlets.`,
      );
    }
    attachments.push(
      pathedMaterialCounterQb64b(raw.length / 4, gvrsn),
      raw,
    );
  }

  return concatMessageWithAttachmentGroup(
    serder,
    attachments,
    pipelined,
    gvrsn,
    nested,
    genusify,
  );
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
