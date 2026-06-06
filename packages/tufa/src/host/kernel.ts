import { action, type Operation, spawn, type Task } from "effection";
import {
  type AgentRuntime,
  consoleLogger,
  createAgentRuntime,
  type Hab,
  type Habery,
  processRuntimeTurn,
  type ProtocolHostPolicy,
  runAgentRuntime,
} from "keri-ts/runtime";
import { startServer } from "./http-server.ts";

/** Resolved listen callback address for one HTTP host. */
export interface HttpListenAddress {
  port: number;
  hostname: string;
}

/** Package-internal host-kernel context shared with companion hosts. */
export interface HostKernelContext {
  runtime: AgentRuntime;
  hby: Habery;
  serviceHab: Hab;
  protocolPolicy: ProtocolHostPolicy;
}

/** One extra long-lived host task that runs alongside the shared runtime. */
export type HostTaskFactory = (context: HostKernelContext) => Operation<void>;

/** HTTP listener spec owned by the shared host kernel. */
export interface HostKernelHttpSpec {
  port: number;
  hostname?: string;
  onListen?: (address: HttpListenAddress) => void;
}

/** Package-internal host-kernel configuration for one long-lived role host. */
export interface HostKernelSpec {
  runtimeMode: "indirect" | "both" | "local";
  enableMailboxStore?: boolean;
  serviceHab: Hab;
  seedHabs?: readonly Hab[];
  hostedPrefixes?: readonly string[];
  http?: HostKernelHttpSpec;
  protocolPolicy: ProtocolHostPolicy;
  companionHosts?: readonly HostTaskFactory[];
}

/** Keep the kernel alive when only companion hosts are configured. */
function* waitUntilHalted(): Operation<void> {
  yield* action(() => {
    return () => {};
  });
}

/**
 * Run one shared host kernel over the common runtime lifecycle.
 *
 * Lifecycle contract:
 * - create the runtime once
 * - seed the selected local habitats before the background runtime loop starts
 * - run optional companion hosts under the same supervision tree
 * - always halt companion hosts before the runtime task, then close runtime
 */
export function* runHostKernel(
  hby: Habery,
  spec: HostKernelSpec,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, {
    mode: spec.runtimeMode,
    enableMailboxStore: spec.enableMailboxStore,
  });
  const seedHabs = spec.seedHabs ?? [spec.serviceHab];
  const hostedPrefixes = spec.hostedPrefixes
    ?? seedHabs.map((hab) => hab.pre);
  const protocolPolicy: ProtocolHostPolicy = {
    ...spec.protocolPolicy,
    serviceHab: spec.protocolPolicy.serviceHab ?? spec.serviceHab,
    hostedPrefixes: spec.protocolPolicy.hostedPrefixes ?? hostedPrefixes,
  };
  const sink = runtime.respondant.forHab(spec.serviceHab);

  for (const hab of seedHabs) {
    yield* processRuntimeTurn(runtime, {
      hab,
      sink,
      pollMailbox: false,
    });
  }

  const context: HostKernelContext = {
    runtime,
    hby,
    serviceHab: spec.serviceHab,
    protocolPolicy,
  };
  const runtimeTask = yield* spawn(function*() {
    yield* runAgentRuntime(runtime, {
      hab: spec.serviceHab,
      sink,
    });
  });
  const companionTasks: Task<void>[] = [];

  try {
    for (const companion of spec.companionHosts ?? []) {
      companionTasks.push(
        yield* spawn(function*() {
          yield* companion(context);
        }),
      );
    }

    if (spec.http) {
      yield* startServer(
        spec.http.port,
        consoleLogger,
        runtime,
        {
          hostname: spec.http.hostname,
          onListen: spec.http.onListen,
          ...protocolPolicy,
        },
      );
      return;
    }

    yield* waitUntilHalted();
  } finally {
    for (const task of companionTasks.slice().reverse()) {
      yield* task.halt();
    }
    yield* runtimeTask.halt();
    yield* runtime.close();
  }
}
