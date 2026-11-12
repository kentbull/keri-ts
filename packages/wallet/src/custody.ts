/** Optional encrypted derivation capability; ordinary wallet inventory never constructs or reads it. */
import { Komer, type RegistryStore, type Table } from "keri-ts/db";
import {
  type DerivedUpdate,
  type DerivedUpdateStore,
  type Hab,
  type Habery,
  RawRecord,
  RegistryCustody as RegistryCustodyCore,
  type RegistryCustodyOptions,
  ValidationError,
} from "keri-ts/runtime";
import type { WalletBaser } from "./storing.ts";

/** Public event-specific inputs; neither a salt nor a derived opening is retained here. */
class DerivedRecord extends RawRecord<DerivedUpdate> implements DerivedUpdate {
  declare credential: string;
  declare state: string;
  declare bound: DerivedUpdate["bound"];
}

/** The wallet's `derived-updates.` table behind the keri-ts `DerivedUpdateStore` port. */
class WalletDerivedUpdates implements DerivedUpdateStore {
  private bound: Table | null = null;
  private derivations?: Komer<DerivedRecord>;

  constructor(private readonly db: WalletBaser) {}

  /** Rebind the table after the caller reopens the same wallet owner. */
  private rows(): Komer<DerivedRecord> {
    if (!this.db.opened) throw new ValidationError("Wallet inventory is closed");
    if (this.bound !== this.db.credentials.sdb) {
      this.derivations = new Komer(this.db.store, { subkey: "derived-updates.", recordClass: DerivedRecord });
      this.bound = this.db.credentials.sdb;
    }
    return this.derivations!;
  }

  get(event: string): DerivedUpdate | null {
    return this.rows().get(event);
  }

  pin(event: string, value: DerivedUpdate): void {
    this.rows().pin(event, value);
  }
}

/** Explicit capability over an existing wallet environment and accepted public registry evidence. */
export class RegistryCustody extends RegistryCustodyCore {
  declare readonly options: RegistryCustodyOptions & { db: WalletBaser };

  /** Borrow owners only; construction opens no table and loads no encrypted row. */
  constructor(options: { hby: Habery; hab: Hab; registry: RegistryStore; db: WalletBaser }) {
    super({ ...options, store: new WalletDerivedUpdates(options.db) });
  }
}
