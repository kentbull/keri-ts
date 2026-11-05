/** Wallet application entrypoint; public protocol owners remain borrowed from keri-ts. */
export { type AcdcV2UpdateOptions, WalletAuthor } from "./src/authoring.ts";
export { RegistryCustody } from "./src/custody.ts";
export {
  type DisclosureSelection,
  exchangeWire,
  type GrantFileSelection,
  type InspectedGrantFile,
  type IssuanceGrantOptions,
  type PreparedDisclosure,
  type PreparedGrantBody,
  WalletDiscloser,
} from "./src/disclosing.ts";
export { type AdmittedCredential, createWalletBaser, type IssuedCredential, WalletBaser } from "./src/storing.ts";
export { type HeldCredential, type PreparedAdmit, Wallet, type WalletOptions } from "./src/wallet.ts";
