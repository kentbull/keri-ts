/** Compile-only installed consumer of public manager, host, ingress and storage contracts. */
import { createBaser, type Keeper } from "keri-ts/db";
import {
  type AgentRuntime,
  Algos,
  credential,
  EssrRecipient,
  FetchHttpClient,
  type Hab,
  type IssueResult,
  KeyStateNoticer,
  SeqNoQuerier,
  WitnessInquisitor,
  inceptRegistry,
  Manager,
  messagize,
  messengerFrom,
  type GroupSendResult,
  type RegistryResult,
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
export function sentMultisig(result: GroupSendResult) {
  return result.messages.map(message => [message.recipient, message.exnSaid, message.payloadSaid]);
}

/** Read typed issuance status independently of any CLI JSON projection. */
export function issuance(result: IssueResult) {
  const issued = { credential: result.creder.said, tel: result.tel, status: result.status };
  if (result.group) {
    return {
      ...issued,
      route: result.group.route,
      telStatus: result.group.telStatus,
      saved: result.group.saved,
      messages: sentMultisig(result.group),
    };
  }
  return issued;
}

/** Narrow group registry coordination while preserving its independent acceptance observation. */
export function registryIdentity(result: RegistryResult) {
  if (result.group) {
    return { registry: result.registry, accepted: result.group.accepted, messages: sentMultisig(result.group) };
  }
  return { registry: result.registry, issuer: result.issuer };
}

/** Compose public query sending and independently scoped accepted-state workflows. */
export function queries(runtime: AgentRuntime, hab: Hab, pre: string, sn: number) {
  const sender = new WitnessInquisitor(runtime.hby, runtime.protocol, runtime.http, runtime.clock, hab);
  return {
    sender,
    sequence: new SeqNoQuerier(runtime.hby.db, sender, pre, sn, { signer: hab.pre }).queryDo(),
    state: new KeyStateNoticer(runtime.hby.db, sender, pre, runtime.keyStateUpdates, { signer: hab.pre }).queryDo(),
  };
}
