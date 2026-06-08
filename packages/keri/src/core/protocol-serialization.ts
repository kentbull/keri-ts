import {
  type Cigar,
  concatBytes,
  Diger,
  NON_TRANSFERABLE_CODES,
  type NumberPrimitive,
  Prefixer,
  Seqner,
  type SerderACDC,
  type SerderKERI,
  type Siger,
  type Verfer,
} from "../../../cesr/mod.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import {
  attachmentCounterPayloadQb64b,
  type AttachmentCounterProfile,
  attachmentCounterQb64b,
  pathedMaterialCounterQb64b,
} from "./attachment-counter-profile.ts";
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
  body: Uint8Array,
  attachments: readonly Uint8Array[],
  pipelined: boolean,
  counterProfile: AttachmentCounterProfile = "legacy",
): Uint8Array {
  const atc = attachments.length === 0 ? new Uint8Array() : concatBytes(...attachments);
  if (!pipelined) {
    return atc.length === 0 ? body : concatBytes(body, atc);
  }
  if (atc.length % 4 !== 0) {
    throw new ValidationError(
      `Invalid attachment quadlet size ${atc.length} for pipelined message.`,
    );
  }
  return concatBytes(
    body,
    attachmentCounterQb64b("AttachmentGroup", atc.length / 4, counterProfile),
    atc,
  );
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

export function messagize(
  serder: SerderKERI,
  args?: {
    sigers?: readonly Siger[];
    seal?: SealEventLike | SealLastLike;
    wigers?: readonly Siger[];
    cigars?: readonly Cigar[];
    pipelined?: boolean;
    counterProfile?: AttachmentCounterProfile;
  },
): Uint8Array;
export function messagize(
  creder: SerderACDC,
  proof: Uint8Array,
  args?: { counterProfile?: AttachmentCounterProfile },
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
      counterProfile?: AttachmentCounterProfile;
    }
    | Uint8Array = {},
  proofOptions: { counterProfile?: AttachmentCounterProfile } = {},
): Uint8Array {
  if (argsOrProof instanceof Uint8Array) {
    if (argsOrProof.length % 4 !== 0) {
      throw new ValidationError(
        `Invalid attachments size=${argsOrProof.length}, nonintegral quadlets.`,
      );
    }
    return concatBytes(
      serderOrCreder.raw,
      attachmentCounterQb64b(
        "AttachmentGroup",
        argsOrProof.length / 4,
        proofOptions.counterProfile,
      ),
      argsOrProof,
    );
  }

  const {
    sigers = [],
    seal,
    wigers = [],
    cigars = [],
    pipelined = false,
    counterProfile = "legacy",
  } = argsOrProof;
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
        counterProfile,
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
          counterProfile,
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
          counterProfile,
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
        counterProfile,
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
        counterProfile,
      ),
      ...cigarPayload,
    );
  }

  return concatMessageWithAttachmentGroup(
    serderOrCreder.raw,
    attachments,
    pipelined,
    counterProfile,
  );
}

export function buildProof(
  prefixer: Prefixer,
  seqner: Seqner,
  diger: Diger,
  sigers: readonly Siger[],
  counterProfile: AttachmentCounterProfile = "legacy",
): Uint8Array {
  const sigerPayload = sigers.map((siger) => siger.qb64b);
  const sigerGroup = [
    attachmentCounterPayloadQb64b(
      "ControllerIdxSigs",
      sigers.length,
      sigerPayload,
      counterProfile,
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
      counterProfile,
    ),
    ...transPayload,
  );
}

export function serializeMessage(
  serder: SerderKERI,
  {
    tsgs = [],
    cigars = [],
    pathed = [],
    pipelined = false,
    counterProfile = "legacy",
  }: {
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    pathed?: readonly (string | Uint8Array)[];
    pipelined?: boolean;
    counterProfile?: AttachmentCounterProfile;
  } = {},
): Uint8Array {
  const attachments: Uint8Array[] = [];

  for (const tsg of tsgs) {
    const sigerPayload = tsg.sigers.map((siger) => siger.qb64b);
    const sigerGroup = [
      attachmentCounterPayloadQb64b(
        "ControllerIdxSigs",
        tsg.sigers.length,
        sigerPayload,
        counterProfile,
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
        counterProfile,
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
        counterProfile,
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
      pathedMaterialCounterQb64b(raw.length / 4, counterProfile),
      raw,
    );
  }

  return concatMessageWithAttachmentGroup(
    serder.raw,
    attachments,
    pipelined,
    counterProfile,
  );
}

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
