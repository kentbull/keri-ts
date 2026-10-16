/** Compile-only installed consumer of public manager, host, ingress and storage contracts. */
import { createBaser, type Keeper, PayloadStore } from "keri-ts/db";
import {
  type AgentRuntime,
  Algos,
  credential,
  type Hab,
  inceptRegistry,
  Manager,
  messagize,
  runAgentRuntime,
  settleRuntimeIngress,
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
export const storage = { PayloadStore, createBaser };
