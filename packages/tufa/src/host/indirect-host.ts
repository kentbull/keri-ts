import { runHostKernel } from "@keri-ts/hosting";
import type { Operation } from "effection";
import type { Hab, Habery, KramConfig } from "keri-ts/runtime";

/** Shared long-lived indirect-host settings used by `agent` and mailbox hosts. */
export interface IndirectHostOptions {
  port: number;
  listenHost?: string;
  serviceHab: Hab;
  hostedPrefixes?: readonly string[];
  kram?: KramConfig;
  /**
   * Relay mode: re-forward the `/fwd` children of senders that authorized this host as their mailbox, so an edge
   * runtime can deliver through it (`HostKernelSpec.enableRelay`). Off unless the operator asks for it.
   */
  relay: boolean;
  onListen?: (address: { port: number; hostname: string }) => void;
}

/**
 * Run one long-lived indirect host over the shared protocol runtime.
 *
 * This is the reusable host seam that higher-level porcelain commands build
 * upon. Startup policy is intentionally explicit so mailbox-specific porcelain
 * selects hosted prefixes after its operator has established accepted endpoint state.
 */
export function* runIndirectHost(
  hby: Habery,
  options: IndirectHostOptions,
): Operation<void> {
  yield* runHostKernel(hby, {
    enableMailboxStore: true,
    enableRelay: options.relay,
    serviceHab: options.serviceHab,
    hostedPrefixes: options.hostedPrefixes,
    kram: options.kram,
    protocolPolicy: {},
    http: {
      port: options.port,
      hostname: options.listenHost,
      onListen: options.onListen,
    },
  });
}
