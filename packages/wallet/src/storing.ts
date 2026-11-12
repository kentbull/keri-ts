/** Application inventory records, separate from public KEL/TEL/exchange evidence. */
import type { Operation } from "effection";
import {
  Komer,
  openOwner,
  type StoreFamily,
  type StoreIdentity,
  type StoreOpener,
  StoreOwner,
  Suber,
} from "keri-ts/db";
import { RawRecord } from "keri-ts/runtime";

/** Exact issued view and its accepted registry reference; no derivation secret. */
export interface IssuedCredential {
  credential: string;
  registry: string;
  controller: string;
  update: string;
  raw: string;
  encoding: "base64";
  /** Original bound Issuee ordinal (hex) and event digest, when supplied. */
  bound: { bn: string; bd: string } | null;
}
/** Consent to one exact Grant/Admit pair; admitted is local time, not publication. */
export interface AdmittedCredential {
  credential: string;
  grant: string;
  admit: string;
  holder: string;
  admitted: string;
}
/** Komer hydration of issued application records. */
export class IssuedRecord extends RawRecord<IssuedCredential> implements IssuedCredential {
  declare credential: string;
  declare registry: string;
  declare controller: string;
  declare update: string;
  declare raw: string;
  declare encoding: "base64";
  declare bound: IssuedCredential["bound"];
}
/** Komer hydration of explicit consent records. */
export class AdmittedRecord extends RawRecord<AdmittedCredential> implements AdmittedCredential {
  declare credential: string;
  declare grant: string;
  declare admit: string;
  declare holder: string;
  declare admitted: string;
}
/** Own only wallet inventory; protocol acceptance remains in the borrowed processors. */
export class WalletBaser extends StoreOwner {
  /** Placement of this store kind; wallet stores have no KERIpy layout. */
  static readonly Family: StoreFamily = { tail: "wallet", noCompat: true };

  issued!: Komer<IssuedRecord>;
  admitted!: Komer<AdmittedRecord>;
  credentials!: Suber;

  /** Rebind the application's ordinary typed tables on joined reopen. */
  *reopen(options: StoreIdentity = {}): Operation<boolean> {
    if (!(yield* this.store.reopen(options))) return false;
    try {
      this.issued = new Komer(this.store, { subkey: "issued.", recordClass: IssuedRecord });
      this.admitted = new Komer(this.store, { subkey: "admitted.", recordClass: AdmittedRecord });
      this.credentials = new Suber(this.store, { subkey: "credential-grants." });
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }
}
/**
 * Acquire a wallet environment from any backend's `StoreOpener`; callers join close after all borrowed users finish.
 *
 * Pass the composition's own opener (for example `hby.opener`) so the wallet shares its single store queue.
 */
export function* openWalletBaser(opener: StoreOpener, identity: StoreIdentity = {}): Operation<WalletBaser> {
  return yield* openOwner(new WalletBaser(opener.create(WalletBaser.Family, identity)), "WalletBaser", identity);
}
