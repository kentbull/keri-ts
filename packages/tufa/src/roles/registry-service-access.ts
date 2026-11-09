/** Service-owned account permissions; authenticated public evidence stays in the Habery. */
import type { Operation } from "effection";
import { Komer } from "keri-ts/db";
import { LMDBer, type LMDBerOptions } from "keri-ts/db/lmdb";
import { RawRecord } from "keri-ts/runtime";

/** Registrar publishers/source observers and Observer readers are distinct permissions. */
export type RegistryServiceRole = "publisher" | "observer" | "reader";
/** One private administration decision, with no credentials or duplicated KEL state. */
export interface RegistryServiceAccess {
  aid: string;
  roles: RegistryServiceRole[];
}
/** Durable activation returned by the private account endpoint. */
export class RegistryServiceAccessRecord extends RawRecord<RegistryServiceAccess> implements RegistryServiceAccess {
  declare aid: string;
  declare roles: RegistryServiceRole[];
}
/** Independent permission store reopened alongside its service's retained identity. */
export class RegistryServiceAccessBaser extends LMDBer {
  accounts!: Komer<RegistryServiceAccessRecord>;
  constructor(options: LMDBerOptions = {}) {
    super(options, {
      tailDirPath: "keri/registry-service-access",
      cleanTailDirPath: "keri/clean/registry-service-access",
      altTailDirPath: ".tufa/registry-service-access",
      altCleanTailDirPath: ".tufa/clean/registry-service-access",
      tempPrefix: "keri_registry_service_access_",
    });
  }
  /** Rebind the same account allowlist after each ordinary LMDB reopen. */
  override *reopen(options: Partial<LMDBerOptions> = {}): Operation<boolean> {
    if (!(yield* super.reopen(options))) return false;
    this.accounts = new Komer(this, { subkey: "accounts.", recordClass: RegistryServiceAccessRecord });
    return true;
  }
}
