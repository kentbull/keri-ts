/** Finite ACDC v2 IPEX composition over exact wallet views and explicitly supplied private capability. */
import { SealSource, SerderACDC, SerderKERI } from "cesr-ts";
import { type Operation } from "effection";
import {
  anchorIpexExchange,
  type DisclosureSelection,
  exchangeWire,
  type GrantFileSelection,
  type Hab,
  type InspectedGrantFile,
  IpexDiscloser,
  type IssuanceGrantOptions,
  type PreparedDisclosure,
  type PreparedGrantBody,
  type Receiptor,
  ValidationError,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import type { RegistryCustody } from "./custody.ts";
import type { Wallet } from "./wallet.ts";

export { exchangeWire };
export type {
  DisclosureSelection,
  GrantFileSelection,
  InspectedGrantFile,
  IssuanceGrantOptions,
  PreparedDisclosure,
  PreparedGrantBody,
};

/** Reuse a matching accepted KEL seal, or author once and gather real witness receipts. */
export function* anchorExchange(
  wallet: Wallet,
  receiptor: Receiptor,
  hab: Hab,
  body: SerderKERI | SerderACDC,
  auths?: WitnessAuthMap,
): Operation<SealSource> {
  if (receiptor.hby !== wallet.hby) throw new ValidationError("Receipt owner must share this wallet's Habery.");
  return yield* anchorIpexExchange(wallet.hby, receiptor, hab, body, auths);
}

/** Verify the wallet's actual owners before the core sees them, keeping the original refusals. */
function owned(wallet: Wallet, receiptor: Receiptor, custody?: RegistryCustody): Wallet {
  if (receiptor.hby !== wallet.hby) {
    throw new ValidationError("Disclosure receipt owner must share the wallet Habery.");
  }
  if (
    custody
    && (custody.options.hby !== wallet.hby || custody.options.registry !== wallet.registry
      || custody.options.db !== wallet.db)
  ) {
    throw new ValidationError("Disclosure custody must use this wallet's actual owners.");
  }
  return wallet;
}

/** The protocol core over this wallet's inventory, which supplies its credential views. */
export class WalletDiscloser extends IpexDiscloser {
  declare readonly custody?: RegistryCustody;

  constructor(readonly wallet: Wallet, receiptor: Receiptor, custody?: RegistryCustody) {
    super(owned(wallet, receiptor, custody).hby, wallet.registry, wallet.exc, receiptor, custody, wallet);
  }
}
