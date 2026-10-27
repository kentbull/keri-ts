/** Compile-only installed application composition through supported public package declarations. */
import { createProtocolHandler, createTufaApp, runHostKernel, startServer } from "@keri-ts/hosting";
import { createObservationBaser, type ObservationBaser, Observer } from "@keri-ts/observer";
import { Registrar } from "@keri-ts/registrar";
import { createVerifierCueBaser, VerifierAgent, type VerifierCueBaser } from "@keri-ts/verifier";
import { createWalletBaser, Wallet, type WalletOptions } from "@keri-ts/wallet";
import type { RegistryStore } from "keri-ts/db";
import type { AgentRuntime, ProtocolProcessor } from "keri-ts/runtime";

/** Compose the application without a private protocol import or dependency-discovery container. */
export function verifier(runtime: AgentRuntime, cdb: VerifierCueBaser, hook: string): VerifierAgent {
  if (!runtime.vdr) throw new Error("Legacy credential profile is required");
  return new VerifierAgent(
    runtime.hby,
    runtime.vdr.reger,
    cdb,
    runtime.protocol,
    runtime.cues,
    runtime.http,
    () => runtime.clock.now(),
    {},
    { hook },
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

/** Compose the installed observation owner without inventing a runtime container. */
export function observer(processor: ProtocolProcessor, store: RegistryStore, observations: ObservationBaser): Observer {
  return new Observer(processor, store, observations, {
    sources: [{ url: "https://registrar.example/" }],
    readers: ["reader"],
  });
}
/** Expose observation-store acquisition declarations to the installed compiler. */
export const observationStore = createObservationBaser;
