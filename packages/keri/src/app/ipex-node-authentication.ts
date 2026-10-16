/** Node issuer authentication over public KEL/TEL evidence; no conversation or validity policy. */
import { Diger, NumberPrimitive, Prefixer, type SealEvent, type SerderACDC } from "cesr-ts";
import { type RegistryState, validateRip, validateUpdate, vetBinds } from "../acdc/regeventing.ts";
import type { RegistryStore } from "../acdc/registering.ts";
import { type KeriDispatchEnvelope, TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { verifyExchangeProofs } from "../core/exchange-proofing.ts";
import type { Baser } from "../db/basing.ts";

/** Borrow only normalized issuer proof families; routing and frame projection belong to intake. */
type IpexNodeProofs = Pick<
  KeriDispatchEnvelope,
  "bsqs" | "bsss" | "sscs" | "ssts" | "sigers" | "tsgs" | "ssgs" | "cigars"
>;

/** Authenticated registry state is evidence, never an implicit credential-validity verdict. */
export type IpexNodeAuthentication =
  | { kind: "authenticated"; registration: RegistryState | null }
  | { kind: "missing"; reason: string }
  | { kind: "reject" };

/** Assemble accepted ordinals only; a missing head is retryable, contradictory durable rows are corrupt. */
export function acceptedRegistryEvidence(
  store: RegistryStore,
  regid: string,
): { rip: SerderACDC; updates: SerderACDC[] } | null {
  const marker = store.head(regid);
  if (!marker) return null;
  const rip = store.seqEvent(regid, 0), head = store.headEvent(regid);
  if (
    !rip || !head || head.said !== marker.qb64 || typeof head.sad?.n !== "string"
    || !/^[0-9a-f]+$/.test(head.sad.n)
  ) {
    throw new DatabaseOperationError("Accepted registry evidence has a missing or corrupt head/inception.");
  }
  const last = BigInt(`0x${head.sad.n}`);
  if (last > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DatabaseOperationError("Accepted registry ordinal exceeds exact storage representation.");
  }
  if (validateRip(rip).kind !== "valid" || rip.said !== regid || store.seqSaider(regid, 0)?.qb64 !== regid) {
    throw new DatabaseOperationError("Accepted registry inception is inconsistent.");
  }
  const updates: SerderACDC[] = [];
  let prior = rip.said;
  for (let sn = 1; sn <= Number(last); sn++) {
    const item = store.seqEvent(regid, sn);
    if (!item) throw new DatabaseOperationError("Accepted registry evidence has a missing sequence entry.");
    const checked = validateUpdate(item, regid);
    if (
      checked.kind !== "valid" || checked.event.sn !== BigInt(sn) || checked.event.prior !== prior
      || store.seqSaider(regid, sn)?.qb64 !== item.said
    ) {
      throw new DatabaseOperationError("Accepted registry sequence is inconsistent.");
    }
    updates.push(item);
    prior = item.said;
  }
  if ((updates.at(-1) ?? rip).said !== marker.qb64) {
    throw new DatabaseOperationError("Registry head and sequence disagree.");
  }
  return { rip, updates };
}

/** A declared registry, then supplied anchors, take precedence over current signatures. */
export function authenticateIpexNode(
  serder: SerderACDC,
  envelope: IpexNodeProofs,
  db: Baser,
  registry: RegistryStore | null,
): IpexNodeAuthentication {
  if (serder.regid) {
    const proofs = [...envelope.bsqs, ...envelope.bsss];
    if (!proofs.length || !registry) return { kind: "reject" };
    const chain = acceptedRegistryEvidence(registry, serder.regid);
    if (!chain) return { kind: "missing", reason: `Missing local TEL evidence for ${serder.regid}.` };
    const result = vetBinds({
      ...chain,
      db,
      blinders: proofs,
      target: serder.said!,
      acdc: serder,
    });
    if (result.kind === "missing") {
      return { kind: "missing", reason: `Missing issuer TEL anchor for ${serder.regid}.` };
    }
    return result.kind === "verified" && result.state.regid === serder.regid
      ? { kind: "authenticated", registration: result.state }
      : { kind: "reject" };
  }
  if (!serder.issuer) return { kind: "reject" };
  let issuer: Prefixer;
  try {
    issuer = new Prefixer({ qb64: serder.issuer });
  } catch {
    return { kind: "reject" };
  }
  const sourceSeals: SealEvent[] = [
    ...envelope.sscs.map((seal) => ({ i: issuer, ...seal })),
    ...envelope.ssts.filter((seal) => seal.i.qb64 === issuer.qb64),
  ];
  if (sourceSeals.length) {
    const result = verifyExchangeProofs(db, serder, { sourceSeals });
    return result.missing.length
      ? { kind: "missing", reason: `Missing issuer KEL anchor for ${serder.said}.` }
      : result.sourceSeals.length > 0
      ? { kind: "authenticated", registration: null }
      : { kind: "reject" };
  }
  const explicit = envelope.tsgs.filter((group) => group.pre === issuer.qb64);
  const last = envelope.ssgs.filter((group) => group.pre === issuer.qb64);
  const tsgs: TransIdxSigGroup[] = [];
  if (issuer.transferable && (envelope.sigers.length || explicit.length || last.length)) {
    const kever = db.getKever(issuer.qb64);
    if (!kever) return { kind: "missing", reason: `Missing current issuer key state for ${serder.said}.` };
    const number = NumberPrimitive.fromNum(BigInt(kever.lastEst.s));
    const diger = new Diger({ qb64: kever.lastEst.d });
    if (envelope.sigers.length) tsgs.push(new TransIdxSigGroup(issuer, number, diger, [...envelope.sigers]));
    tsgs.push(...explicit.filter((group) => group.sn === number.num && group.said === diger.qb64));
    tsgs.push(...last.map((group) => new TransIdxSigGroup(issuer, number, diger, [...group.sigers])));
  }
  const cigars = envelope.cigars.filter((cigar) => cigar.verfer?.qb64 === issuer.qb64);
  const result = verifyExchangeProofs(db, serder, { tsgs, cigars });
  return result.missing.length
    ? { kind: "missing", reason: `Missing current issuer KEL evidence for ${serder.said}.` }
    : result.tsgs.length + result.cigars.length > 0
    ? { kind: "authenticated", registration: null }
    : { kind: "reject" };
}
