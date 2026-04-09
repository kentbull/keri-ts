import type { Operation } from "npm:effection@^3.6.0";
import type { Hab, Habery } from "../../../keri/runtime.ts";
import { runHostKernel } from "../host/kernel.ts";
import { startWitnessTcpServer } from "../host/witness-tcp.ts";

/** Package-internal long-lived witness-host settings. */
export interface WitnessHostOptions {
  serviceHab: Hab;
  httpPort: number;
  httpListenHost: string;
  tcpPort: number;
  tcpListenHost: string;
}

/**
 * Run one combined witness and mailbox host over the shared runtime stack.
 *
 * The witness role is the first role host that needs both the HTTP kernel path
 * and a companion TCP listener under the same supervision tree.
 */
export function* runWitnessHost(
  hby: Habery,
  {
    serviceHab,
    httpPort,
    httpListenHost,
    tcpPort,
    tcpListenHost,
  }: WitnessHostOptions,
): Operation<void> {
  yield* runHostKernel(hby, {
    runtimeMode: "both",
    enableMailboxStore: true,
    serviceHab,
    seedHabs: [serviceHab],
    hostedPrefixes: [serviceHab.pre],
    http: {
      port: httpPort,
      hostname: httpListenHost,
    },
    protocolPolicy: {
      serviceHab,
      hostedPrefixes: [serviceHab.pre],
      witnessHab: serviceHab,
    },
    companionHosts: [
      ({ runtime }) =>
        startWitnessTcpServer(
          tcpPort,
          tcpListenHost,
          runtime,
          serviceHab,
        ),
    ],
  });
}
