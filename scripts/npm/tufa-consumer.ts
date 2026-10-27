/** Compile-only installed application composition through supported public package declarations. */
import { VerifierAgent, type VerifierCueBaser, createVerifierCueBaser } from "@keri-ts/verifier";
import { createProtocolHandler, createTufaApp, runHostKernel, startServer } from "@keri-ts/hosting";
import { Wallet, type WalletOptions, createWalletBaser } from "@keri-ts/wallet";
import { Registrar } from "@keri-ts/registrar";
import type { RegistryStore } from "keri-ts/db";
import type { AgentRuntime, ProtocolProcessor } from "keri-ts/runtime";

/** Compose the application without a private protocol import or dependency-discovery container. */
export function verifier(runtime: AgentRuntime, cdb: VerifierCueBaser, hook: string): VerifierAgent {
  if (!runtime.vdr) throw new Error("Legacy credential profile is required");
  return new VerifierAgent(
    runtime.hby, runtime.vdr.reger, cdb, runtime.protocol, runtime.cues, runtime.http,
    () => runtime.clock.now(), {}, { hook },
  );
}

/** Expose the concrete application's storage acquisition type to the installed compiler. */
export const cueStore = createVerifierCueBaser;

/** Expose the concrete hosting composition surface to the installed compiler. */
export const hosting = { createProtocolHandler, createTufaApp, runHostKernel, startServer };

/** Compose the separately installed wallet with its concrete borrowed protocol owners. */
export function wallet(options: WalletOptions): Wallet {
  return new Wallet(options);
}

/** Expose the wallet inventory acquisition type to the installed compiler. */
export const walletStore = createWalletBaser;

/** Compose registrar through real concrete protocol owners; Tufa need not depend on it. */
export function registrar(processor: ProtocolProcessor, store: RegistryStore): Registrar {
  return new Registrar(processor, store, { publishers: [], observers: [], fullEvidence: true });
}
