import type { Operation } from "effection";
import type { Hab, Habery } from "keri-ts/runtime";
import { runHostKernel } from "./kernel.ts";

/** Shared long-lived indirect-host settings used by `agent` and mailbox hosts. */
export interface IndirectHostOptions {
  port: number;
  listenHost?: string;
  serviceHab: Hab;
  /**
   * Explicit optional legacy/v1-style TEL backer, independent of hosted prefixes,
   * issuer multisig approval and KEL witnessing. Native ACDC v2 does not require it.
   */
  backerHab?: Hab;
  hostedPrefixes?: readonly string[];
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
    serviceHab: options.serviceHab,
    backerHab: options.backerHab,
    hostedPrefixes: options.hostedPrefixes,
    protocolPolicy: {},
    http: {
      port: options.port,
      hostname: options.listenHost,
      onListen: options.onListen,
    },
  });
}
