/** Compile-only installed consumer of public manager, host, ingress and storage contracts. */
import { createBaser, type Keeper } from "keri-ts/db";
import {
  type AgentRuntime,
  Algos,
  credential,
  type CredentialCreateResult,
  EssrRecipient,
  FetchHttpClient,
  type Hab,
  inceptRegistry,
  Manager,
  messagize,
  messengerFrom,
  type MultisigSendResult,
  runAgentRuntime,
  settleRuntimeIngress,
  streamMessengerFrom,
  systemClock,
} from "keri-ts/runtime";

// Compile actual supported construction and composition, including the enum
// required by Manager's public options. No internal package paths are available.
/** Construct a manager with the public algorithm selector. */
export function managerFor(ks: Keeper): Manager {
  return new Manager({ ks, algo: Algos.salty });
}
/** Compose an existing controller into a host operation. */
export function host(runtime: AgentRuntime, hab: Hab) {
  return runAgentRuntime(runtime, { hab });
}
/** Submit a complete wire record through public ingress. */
export function receive(runtime: AgentRuntime, wire: Uint8Array) {
  return settleRuntimeIngress(runtime, [wire]);
}
export const protocol = { credential, inceptRegistry, messagize };
export const storage = { createBaser };

/** Decrypt accepted evidence through the synchronous public recipient API. */
export function decryptEssr(hab: Hab, said: string) {
  return new EssrRecipient(hab).decrypt(said);
}

/** Select concrete supported transports through their installed public declarations. */
export function messengers(destination: string, url: string, wire: Uint8Array) {
  const http = new FetchHttpClient();
  return {
    ordinary: messengerFrom(destination, { http: url }, http, systemClock),
    stream: streamMessengerFrom(destination, { http: url }, wire, http, systemClock),
  };
}

/** Consume the documented coordination identities without treating transport as group approval. */
export function sentMultisig(result: MultisigSendResult) {
  return result.messages.map(message => [message.recipient, message.exnSaid, message.payloadSaid]);
}

/** Read typed issuance status independently of any CLI JSON projection. */
export function issuance(result: CredentialCreateResult) {
  return { credential: result.creder.said, status: result.issuance.status };
}
