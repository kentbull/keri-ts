/** Read-only legacy credential proposal checks performed before member approval/signing. */
import {
  concatBytes,
  Counter,
  Ilks,
  parseBytes,
  type SerderACDC,
  type SerderKERI,
  TraitDex,
  type Versionage,
} from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import type { Reger } from "../db/reger.ts";
import { resolveBackerState } from "../vdr/backer-state.ts";
import { Credentialer, type Regery } from "../vdr/credentialing.ts";
import { validateRegistryInception } from "../vdr/eventing.ts";
import { telAnchorMatches } from "../vdr/tel-anchor.ts";
import type { Habery } from "./habbing.ts";
import { envelopeFromFrame } from "./parsering.ts";
import { resolveCachedSchema } from "./schema-resolving.ts";

/** Refuse a blank or conflicting local registry alias before signing its anchor. */
export function validateRegistryName(reger: Reger, name: string, regk?: string): void {
  if (!name.trim()) throw new ValidationError("Registry name is required.");
  const existing = reger.regs.get(name);
  if (existing && existing.registryKey !== regk) {
    throw new ValidationError(`Registry name ${name} already identifies another registry.`);
  }
}

/**
 * Require known group KEL authority before adding a fresh anchor signature.
 * A future predecessor stays pending. An accepted historical anchor can use the
 * current keys only while no intervening establishment event has changed them;
 * recorded approval instead reuses its original contribution.
 */
export function groupCredentialAnchorReady(hby: Habery, issuer: string, anchor: SerderKERI): boolean {
  const kever = hby.db.getKever(issuer);
  if (!kever) return false;
  if (kever.estOnly && !anchor.estive) {
    throw new ValidationError("Establishment-only group requires an establishment anchor.");
  }
  const sn = anchor.sn;
  if (sn === null || anchor.pre !== issuer) throw new ValidationError("Invalid group anchor identity.");
  if (sn > kever.sn + 1) return false;
  if (sn <= kever.sn) {
    if (hby.db.kels.getLast(issuer, sn) !== anchor.said) {
      throw new ValidationError("Group anchor conflicts with accepted KEL state.");
    }
    return kever.lastEst.s <= sn;
  }
  if (anchor.ked?.p !== kever.said) {
    throw new ValidationError("Group anchor predecessor does not match accepted KEL state.");
  }
  return true;
}

/** Validate the signed VCP policy and its exact issuer anchor without accepting either event. */
export function validateRegistryProposal(issuer: string, event: SerderKERI, anchor: SerderKERI): void {
  const inception = validateRegistryInception(event);
  if (inception.issuer !== issuer) throw new ValidationError("Registry inception issuer does not match its group.");
  validateProposalAnchor(issuer, event, anchor, inception.estOnly);
}

/**
 * Validate issuer/registry/credential/TEL bindings and the cached credential schema.
 * Missing accepted registry or schema remains pending. Malformed business evidence
 * is refused without changing KEL, TEL, wallet or alias state; storage faults propagate.
 */
export function validateCredentialIssueProposal(
  rgy: Regery,
  issuer: string,
  creder: SerderACDC,
  event: SerderKERI,
  anchor?: SerderKERI,
): boolean {
  if (event.ilk !== Ilks.iss && event.ilk !== Ilks.bis) {
    throw new ValidationError("Credential issuance proposal requires iss or bis evidence.");
  }
  if (!creder.verify() || !event.verify() || event.pre !== creder.said || event.sn !== 0 || creder.issuer !== issuer) {
    throw new ValidationError("Credential issuance does not match its credential and group issuer.");
  }
  const regk = creder.regid;
  if (!regk) throw new ValidationError("Credential issuance is missing its registry identifier.");
  const state = rgy.reger.states.get(regk);
  if (!state) return false;
  if (state.ii !== issuer) throw new ValidationError("Credential registry is controlled by another issuer.");
  const noBackers = (state.c ?? []).includes(TraitDex.NoBackers);
  if (event.ilk === Ilks.iss) {
    if (!noBackers || event.ked?.ri !== regk) {
      throw new ValidationError("Credential issuance registry or backer policy mismatch.");
    }
  } else {
    if (noBackers) throw new ValidationError("Backer issuance cannot use a NoBackers registry.");
    const cohort = resolveBackerState(rgy.reger, regk, event.ked?.ra);
    if (cohort.kind === "missing") return false;
    if (cohort.kind === "reject") throw new ValidationError(cohort.reason);
  }
  if (anchor) validateProposalAnchor(issuer, event, anchor, (state.c ?? []).includes(TraitDex.EstOnly));
  const prior = rgy.reger.tels.getOn(creder.said!, 0);
  if (prior && prior.qb64 !== event.said) throw new ValidationError("Credential already has another issuance event.");
  const schema = creder.schema;
  if (typeof schema === "string" && !resolveCachedSchema(rgy.hby, schema)) return false;
  new Credentialer(rgy.hby, { reger: rgy.reger, vry: rgy.vry }).validate(creder);
  return true;
}

/** Check the ACDC's actual CESR source triple, independently of the coordinating parent's signatures. */
export function validateCredentialSource(
  creder: SerderACDC,
  issuance: SerderKERI,
  attachment: Uint8Array,
  genus: Versionage,
): void {
  const frames = parseBytes(concatBytes(Counter.makeGVC(genus), creder.raw, attachment));
  if (frames.length !== 1) throw new ValidationError("Credential source evidence must contain one credential.");
  // Match ordinary ACDC dispatch and KERIpy: the last source triple is authoritative.
  const source = envelopeFromFrame(frames[0]).lastSst;
  if (
    !source || source.i.qb64 !== issuance.pre || source.s.num !== issuance.sner?.num
    || source.d.qb64 !== issuance.said
  ) throw new ValidationError("Credential source seal does not match the proposed issuance.");
}

/** Compare the full TEL seal and enforce the registry's establishment-only anchor policy. */
function validateProposalAnchor(issuer: string, event: SerderKERI, anchor: SerderKERI, estOnly: boolean): void {
  if (!telAnchorMatches(issuer, event, anchor)) {
    throw new ValidationError("TEL proposal anchor does not match its event.");
  }
  if (estOnly && !anchor.estive) {
    throw new ValidationError("Establishment-only registry requires an establishment anchor.");
  }
}
