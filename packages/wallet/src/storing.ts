/** Application inventory records, separate from public KEL/TEL/exchange evidence. */
import type { Operation } from "effection";
import { Komer, LMDBer, type LMDBerOptions, Suber } from "keri-ts/db";
import { DatabaseNotOpenError, RawRecord } from "keri-ts/runtime";

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
export class WalletBaser extends LMDBer {
  issued!: Komer<IssuedRecord>;
  admitted!: Komer<AdmittedRecord>;
  credentials!: Suber;

  constructor(options: LMDBerOptions = {}) {
    super(options, {
      tailDirPath: "keri/wallet",
      cleanTailDirPath: "keri/clean/wallet",
      altTailDirPath: ".tufa/wallet",
      altCleanTailDirPath: ".tufa/clean/wallet",
      tempPrefix: "keri_wallet_",
    });
  }

  /** Rebind the application's ordinary typed tables on joined reopen. */
  override *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    if (!(yield* super.reopen(options))) return false;
    try {
      this.issued = new Komer(this, { subkey: "issued.", recordClass: IssuedRecord });
      this.admitted = new Komer(this, { subkey: "admitted.", recordClass: AdmittedRecord });
      this.credentials = new Suber(this, { subkey: "credential-grants." });
      return true;
    } catch (error) {
      yield* this.close();
      throw error;
    }
  }
}
/** Acquire a wallet environment; callers join close after all borrowed users finish. */
export function* createWalletBaser(options: LMDBerOptions = {}): Operation<WalletBaser> {
  const db = new WalletBaser(options);
  if (!(yield* db.reopen())) throw new DatabaseNotOpenError("Wallet environment could not open.");
  return db;
}
