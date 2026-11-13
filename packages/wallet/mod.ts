/** Browser-safe wallet entrypoint: inventory, consent, authoring and disclosure over borrowed protocol owners. */
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
export { type AdmittedCredential, type IssuedCredential, openWalletBaser, WalletBaser } from "./src/storing.ts";
export {
  type AdmissionEvidence,
  type HeldCredential,
  type PreparedAdmit,
  Wallet,
  type WalletOptions,
} from "./src/wallet.ts";
