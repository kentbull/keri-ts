/** Browser-safe wallet entrypoint: the root surface without LMDB, opened through any `StoreOpener`. */
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
export { type HeldCredential, type PreparedAdmit, Wallet, type WalletOptions } from "./src/wallet.ts";
export {
  openWebWallet,
  type OpenWebWalletOptions,
  type PageLifecycleTargets,
  UnencryptedKeeperError,
  WALLET_KRAM_CACHES,
  type WebWallet,
  type WebWalletHealth,
  type WebWalletHost,
  type WebWalletSecret,
} from "./src/web/open-web-wallet.ts";
export {
  type AdmitDelivery,
  Credentials,
  DEFAULT_UNBLIND_STATES,
  type EndedPresentation,
  type EndedStatus,
  type EndedUnblinding,
  type IdentifierEvent,
  Identifiers,
  type InceptOptions,
  type IssueOptions,
  type IssueOutcome,
  Mailboxes,
  type MailboxOutcome,
  type OobiOutcome,
  Oobis,
  type PresentInput,
  type PresentOutcome,
  type ReceiveOutcome,
  type RotateOptions,
  type UnblindOutcome,
  WALLET_TIMEOUTS,
  type WalletApi,
  WalletStoppedError,
} from "./src/web/wallet-api.ts";
