/** Wallet application entrypoint; public protocol owners remain borrowed from keri-ts. */
export { type AcdcV2UpdateOptions, WalletAuthor } from "./src/authoring.ts";
export { type CustodyInfo, type PreparedCustody, RegistryCustody } from "./src/custody.ts";
export {
  type DisclosureSelection,
  type PreparedDisclosure,
  type PreparedGrantBody,
  WalletDiscloser,
} from "./src/disclosing.ts";
export { RegistrySaltService } from "./src/salting.ts";
export { type AdmittedCredential, createWalletBaser, type IssuedCredential, WalletBaser } from "./src/storing.ts";
export { type HeldCredential, type PreparedAdmit, Wallet, type WalletOptions } from "./src/wallet.ts";
