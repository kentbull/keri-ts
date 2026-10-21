/** Read-only authority and retained-event selection for local legacy NoBackers revocation. */
import { Ilks, NumDex, Seqner, SerderKERI, TraitDex } from "cesr-ts";
import { DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { revoke } from "../core/protocol-vdr-eventing.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";

/**
 * Check the credential, accepted registry, original issuance and proposed REV
 * before a local member signs its issuer anchor. Missing authority stays pending;
 * contradictory evidence refuses. This neither accepts TEL nor changes escrows.
 * An already accepted matching REV remains valid for explicit approval resume.
 */
export function validateCredentialRevocation(reger: Reger, issuer: string, event: SerderKERI): boolean {
  if (!event.verify() || event.ilk !== Ilks.rev || event.sn !== 1 || !event.pre) {
    throw new ValidationError("Credential revocation requires valid rev evidence at ordinal one.");
  }
  const creder = reger.creds.get(event.pre);
  if (!creder || reger.saved.get(event.pre) === null) return false;
  if (!creder.verify() || creder.issuer !== issuer || creder.regid !== event.ked?.ri) {
    throw new ValidationError("Credential revocation does not match its credential, issuer and registry.");
  }
  const registry = creder.regid!;
  const state = reger.states.get(registry);
  if (!state) return false;
  if (state.ii !== issuer || !(state.c ?? []).includes(TraitDex.NoBackers)) {
    throw new ValidationError("Local credential revocation requires its issuer's NoBackers registry.");
  }
  const issuance = reger.tels.getOn(event.pre, 0);
  if (!issuance) return false;
  const original = storedEvent(reger, event.pre, issuance.qb64);
  if (original.ilk !== Ilks.iss || original.ked?.ri !== registry || event.ked?.p !== issuance.qb64) {
    throw new ValidationError("Credential revocation predecessor does not match its accepted issuance.");
  }
  const accepted = reger.tels.getOn(event.pre, 1);
  if (accepted && accepted.qb64 !== event.said) {
    throw new ValidationError("Credential already has another accepted revocation.");
  }
  return true;
}

/**
 * Reuse the accepted REV or this issuer's original publication candidate. The
 * ordinary tmse record identifies locally tracked work; unrelated remote escrow
 * candidates cannot select an event for local authoring. A fresh REV is returned
 * only when neither exists. The caller owns anchoring and TEL admission.
 */
export function prepareCredentialRevocation(reger: Reger, issuer: string, registry: string, said: string): SerderKERI {
  const creder = reger.creds.get(said);
  if (!creder || creder.issuer !== issuer || creder.regid !== registry) {
    throw new ValidationError("Credential is not controlled by the selected issuer and registry.");
  }
  const accepted = reger.tels.getOn(said, 1);
  const rawOrdinal = new Uint8Array(16);
  rawOrdinal[15] = 1;
  const ordinal = new Seqner({ code: NumDex.Huge, raw: rawOrdinal }).qb64;
  const pending = new Set([...reger.tmse.getTopItemIter([said, ordinal])].map(([keys]) => keys[2]));
  if (pending.size > 1 || (accepted && [...pending].some(digest => digest !== accepted.qb64))) {
    throw new DatabaseOperationError("Conflicting locally tracked credential revocations.");
  }
  const retained = accepted?.qb64 ?? [...pending][0];
  let event: SerderKERI;
  if (retained) {
    event = storedEvent(reger, said, retained);
    if (!reger.ancs.get(dgKey(said, retained))) {
      throw new DatabaseOperationError("Stored revocation issuer source seal is missing.");
    }
  } else {
    const issuance = reger.tels.getOn(said, 0);
    if (!issuance) throw new ValidationError(`Cannot revoke unknown credential ${said}.`);
    event = revoke(said, registry, issuance.qb64);
  }
  if (!validateCredentialRevocation(reger, issuer, event)) {
    throw new ValidationError("Credential revocation is missing accepted credential, registry or issuance evidence.");
  }
  return event;
}

/** Accepted/publication indexes must reference an intact body with the same immutable identity. */
function storedEvent(reger: Reger, prefix: string, digest: string): SerderKERI {
  const raw = reger.tvts.get(dgKey(prefix, digest));
  if (!raw) throw new DatabaseOperationError("Stored credential TEL body is missing.");
  const event = new SerderKERI({ raw });
  if (event.pre !== prefix || event.said !== digest || !event.verify()) {
    throw new DatabaseOperationError("Stored credential TEL identity is corrupt.");
  }
  return event;
}
