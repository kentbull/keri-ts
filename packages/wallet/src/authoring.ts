/** Finite ACDC v2 registry authoring; existing engines own acceptance and receipt authentication. */
import type { SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import {
  type AcdcV2Regery,
  type AcdcV2Registry,
  type AcdcV2UpdateOptions,
  type Receiptor,
  RegistryAuthor,
  type RegistryDisclosure,
  ValidationError,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

export type { AcdcV2UpdateOptions };

/** Verify the wallet's actual owners before the core sees them, keeping the original refusals. */
function owned(wallet: Wallet, rgy: AcdcV2Regery, receiptor: Receiptor, custody?: RegistryCustody): AcdcV2Regery {
  if (rgy.hby !== wallet.hby || rgy.baser !== wallet.registry.baser || receiptor.hby !== wallet.hby) {
    throw new ValidationError("Authoring requires the wallet's actual registry and receipt owners.");
  }
  if (
    custody
    && (custody.options.hby !== wallet.hby || custody.options.registry !== wallet.registry
      || custody.options.db !== wallet.db)
  ) {
    throw new ValidationError("Authoring custody must use this wallet's actual owners.");
  }
  return rgy;
}

/** The protocol core plus wallet inventory: `issue` records, `stageRevocation` and `revoke` read it. */
export class WalletAuthor extends RegistryAuthor {
  declare readonly custody?: RegistryCustody;

  constructor(
    readonly wallet: Wallet,
    rgy: AcdcV2Regery,
    receiptor: Receiptor,
    custody?: RegistryCustody,
  ) {
    super(owned(wallet, rgy, receiptor, custody), receiptor, custody);
  }

  /** Ensure revocation of retained local issuance; an identical accepted revocation remains an idempotent retry. */
  stageRevocation(
    reg: AcdcV2Registry,
    said: string,
    options: AcdcV2UpdateOptions = {},
  ): { event: SerderACDC; opening: RegistryDisclosure } {
    const record = this.wallet.db.issued.get([said]);
    if (!record || record.registry !== reg.regk) {
      throw new ValidationError("Credential is not in this registry's issued inventory.");
    }
    return this.stageState(reg, this.wallet.issuedCredential(said), "revoked", options, true);
  }

  /** Preserve original issued history on retry; inventory follows exact witnessed TEL acceptance. */
  *issue(reg: AcdcV2Registry, acdc: SerderACDC, options: AcdcV2UpdateOptions = {}) {
    this.individual(reg);
    this.registry(reg.name, acdc.issuer!);
    if (acdc.regid !== reg.regk) throw new ValidationError("Credential does not match this registry.");
    const old = this.wallet.db.issued.get([acdc.said!]);
    if (old) return this.wallet.recordIssued(acdc, old.update);
    const { event, opening } = this.stage(reg, acdc, "issued", options);
    yield* this.anchor(reg, event, options.auths);
    return this.wallet.recordIssued(acdc, event.said!, { blinder: opening });
  }

  /** Revoke only locally retained issuance, not an unrelated arbitrary target digest. */
  *revoke(reg: AcdcV2Registry, said: string, options: AcdcV2UpdateOptions = {}): Operation<SerderACDC> {
    this.individual(reg);
    const { event } = this.stageRevocation(reg, said, options);
    yield* this.anchor(reg, event, options.auths);
    return event;
  }
}
