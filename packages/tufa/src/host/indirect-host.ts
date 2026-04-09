import type { Operation } from "effection";
import type { Hab, Habery } from "../../../keri/runtime.ts";
import { runHostKernel } from "./kernel.ts";

/** Shared long-lived indirect-host settings used by `agent` and mailbox hosts. */
export interface IndirectHostOptions {
  port: number;
  listenHost?: string;
  serviceHab: Hab;
  hostedPrefixes?: readonly string[];
  seedHabs?: readonly Hab[];
  onListen?: (address: { port: number; hostname: string }) => void;
}

/**
 * Run one long-lived indirect host over the shared protocol runtime.
 *
 * This is the reusable host seam that higher-level porcelain commands build
 * upon. Startup policy is intentionally explicit so mailbox-specific porcelain
 * can select one hosted prefix without inheriting `agent`-specific role
 * seeding.
 */
export function* runIndirectHost(
  hby: Habery,
  options: IndirectHostOptions,
): Operation<void> {
  const seedHabs = options.seedHabs ?? [options.serviceHab];
  const hostedPrefixes = options.hostedPrefixes
    ?? seedHabs.map((hab) => hab.pre);
  yield* runHostKernel(hby, {
    runtimeMode: "indirect",
    serviceHab: options.serviceHab,
    seedHabs,
    hostedPrefixes,
    http: {
      port: options.port,
      hostname: options.listenHost,
      onListen: options.onListen,
    },
    protocolPolicy: {
      serviceHab: options.serviceHab,
      hostedPrefixes,
    },
  });
}
