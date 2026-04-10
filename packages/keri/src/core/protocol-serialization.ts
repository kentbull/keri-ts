import {
  type Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
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
import { type TransIdxSigGroup } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);
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

function encodeSealSeqnerQb64b(seq: NumberPrimitive | Seqner | string): Uint8Array {
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
    new Counter({
      code: CtrDexV1.AttachmentGroup,
      count: atc.length / 4,
      version: KERI_V1,
    }).qb64b,
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
  },
): Uint8Array;
export function messagize(
  creder: SerderACDC,
  proof: Uint8Array,
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
    }
    | Uint8Array = {},
): Uint8Array {
  if (argsOrProof instanceof Uint8Array) {
    if (argsOrProof.length % 4 !== 0) {
      throw new ValidationError(
        `Invalid attachments size=${argsOrProof.length}, nonintegral quadlets.`,
      );
    }
    return concatBytes(
      serderOrCreder.raw,
      new Counter({
        code: CtrDexV1.AttachmentGroup,
        count: argsOrProof.length / 4,
        version: KERI_V1,
      }).qb64b,
      argsOrProof,
    );
  }

  const {
    sigers = [],
    seal,
    wigers = [],
    cigars = [],
    pipelined = false,
  } = argsOrProof;
  if (sigers.length === 0 && wigers.length === 0 && cigars.length === 0) {
    throw new ValidationError(
      `Missing attached signatures on message = ${JSON.stringify(serderOrCreder.ked)}.`,
    );
  }

  const attachments: Uint8Array[] = [];
  if (sigers.length > 0) {
    if (seal && "s" in seal && "d" in seal) {
      attachments.push(
        new Counter({
          code: CtrDexV1.TransIdxSigGroups,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        seal.i.qb64b,
        encodeSealSeqnerQb64b(seal.s),
        seal.d.qb64b,
      );
    } else if (seal && "i" in seal) {
      attachments.push(
        new Counter({
          code: CtrDexV1.TransLastIdxSigGroups,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        seal.i.qb64b,
      );
    }
    attachments.push(
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...sigers.map((siger) => siger.qb64b),
    );
  }

  if (wigers.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.WitnessIdxSigs,
        count: wigers.length,
        version: KERI_V1,
      }).qb64b,
      ...wigers.map((wiger) => {
        const verfer = wiger.verfer;
        if (verfer && !NON_TRANSFERABLE_CODES.has(verfer.code)) {
          throw new ValidationError(
            `Attempt to use transferable prefix=${verfer.qb64} for receipt.`,
          );
        }
        return wiger.qb64b;
      }),
    );
  }

  if (cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...cigars.flatMap((cigar) => {
        const verfer = requireCigarVerfer(cigar);
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }

  return concatMessageWithAttachmentGroup(
    serderOrCreder.raw,
    attachments,
    pipelined,
  );
}

export function buildProof(
  prefixer: Prefixer,
  seqner: Seqner,
  diger: Diger,
  sigers: readonly Siger[],
): Uint8Array {
  return concatBytes(
    new Counter({
      code: CtrDexV1.TransIdxSigGroups,
      count: 1,
      version: KERI_V1,
    }).qb64b,
    prefixer.qb64b,
    seqner.qb64b,
    diger.qb64b,
    new Counter({
      code: CtrDexV1.ControllerIdxSigs,
      count: sigers.length,
      version: KERI_V1,
    }).qb64b,
    ...sigers.map((siger) => siger.qb64b),
  );
}

export function serializeMessage(
  serder: SerderKERI,
  {
    tsgs = [],
    cigars = [],
    pathed = [],
    pipelined = false,
  }: {
    tsgs?: readonly TransIdxSigGroup[];
    cigars?: readonly Cigar[];
    pathed?: readonly (string | Uint8Array)[];
    pipelined?: boolean;
  } = {},
): Uint8Array {
  const attachments: Uint8Array[] = [];

  for (const tsg of tsgs) {
    attachments.push(
      new Counter({
        code: CtrDexV1.TransIdxSigGroups,
        count: 1,
        version: KERI_V1,
      }).qb64b,
      tsg.prefixer.qb64b,
      encodeSealSeqnerQb64b(tsg.seqner),
      tsg.diger.qb64b,
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: tsg.sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...tsg.sigers.map((siger) => siger.qb64b),
    );
  }

  if (cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...cigars.flatMap((cigar) => {
        const verfer = requireCigarVerfer(cigar);
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }

  for (const path of pathed) {
    const raw = typeof path === "string" ? new TextEncoder().encode(path) : path;
    attachments.push(
      new Counter({
        code: CtrDexV1.PathedMaterialCouples,
        count: raw.length / 4,
        version: KERI_V1,
      }).qb64b,
      raw,
    );
  }

  return concatMessageWithAttachmentGroup(serder.raw, attachments, pipelined);
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
  event.witnesses = serder.estive
    ? db.wits.get(dgkey).map((wit) => wit.qb64)
    : [];
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
  const transferable = db.vrcs.get(dgkey).map(([prefixer, number, diger, siger]) => ({
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
