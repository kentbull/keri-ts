/** Wallet application entrypoint; public protocol owners remain borrowed from keri-ts. */
export { type NativeUpdateOptions, WalletAuthor } from "./src/authoring.ts";
export { type CustodyInfo, RegistryCustody } from "./src/custody.ts";
export { type AdmittedCredential, createWalletBaser, type IssuedCredential, WalletBaser } from "./src/storing.ts";
export { type HeldCredential, type PreparedAdmit, Wallet, type WalletOptions } from "./src/wallet.ts";
