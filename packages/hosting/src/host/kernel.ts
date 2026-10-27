import { type Operation, spawn, type Task } from "effection";
import { systemClock } from "keri-ts/runtime";
import { FetchHttpClient } from "keri-ts/runtime";
import {
  type AgentRuntime,
  consoleLogger,
  createAgentRuntime,
  type Hab,
  type Habery,
  type KramConfig,
  type ProtocolHostPolicy,
  runAgentRuntime,
} from "keri-ts/runtime";
import { startServer } from "./http-server.ts";

/** Resolved listen callback address for one HTTP host. */
export interface HttpListenAddress {
  port: number;
  hostname: string;
}

/** Actual companion listener work, supervised alongside the runtime and HTTP server. */
export type HostTaskFactory = (runtime: AgentRuntime) => Operation<void>;

/** HTTP listener spec owned by the shared host kernel. */
export interface HostKernelHttpSpec {
  port: number;
  hostname?: string;
  onListen?: (address: HttpListenAddress) => void;
}

/** Concrete host-kernel configuration for one long-lived role host. */
export interface HostKernelSpec {
  /** Whether this host constructs provider mailbox storage. */
  enableMailboxStore: boolean;
  /** Explicit receiver policy selected by this host's composition root; omission leaves KRAM disabled. */
  kram?: KramConfig;
  serviceHab: Hab;
  hostedPrefixes?: readonly string[];
  http: HostKernelHttpSpec;
  protocolPolicy: Omit<ProtocolHostPolicy, "serviceHab" | "hostedPrefixes">;
  companionHosts?: readonly HostTaskFactory[];
}

/**
 * Compose and run the long-lived host over one borrowed Habery.
 * Select HTTP/clock/polling implementations at this root, acquire runtime/listener
 * resources in scope, and join dependent workers before owned store teardown.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param spec Explicit hosted identities, listener settings, protocol handlers and host policy.
 */
export function* runHostKernel(
  hby: Habery,
  spec: HostKernelSpec,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
    enableMailboxStore: spec.enableMailboxStore,
    kram: spec.kram,
  });
  const hostedPrefixes = spec.hostedPrefixes ?? [spec.serviceHab.pre];
  const protocolPolicy: ProtocolHostPolicy = {
    ...spec.protocolPolicy,
    serviceHab: spec.serviceHab,
    hostedPrefixes,
  };

  /** Runtime worker starts only after HTTP listener acquisition; absent if startup fails earlier. */
  let runtimeTask: Task<void> | undefined;
  const companionTasks: Task<void>[] = [];
  let closed = false;
  /** Join companions, then runtime workers and owned stores; retain the first failure while attempting every close. */
  const closeKernel = function*(): Operation<void> {
    if (closed) {
      return;
    }
    let failed = false;
    let failure: unknown;
    for (const task of companionTasks.slice().reverse()) {
      try {
        yield* task.halt();
      } catch (error) {
        failed = true;
        failure ??= error;
      }
    }
    try {
      if (runtimeTask) yield* runtimeTask.halt();
    } catch (error) {
      failed = true;
      failure ??= error;
    }
    try {
      yield* runtime.close();
    } catch (error) {
      failed = true;
      failure ??= error;
    }
    closed = true;
    if (failed) {
      throw failure;
    }
  };

  try {
    for (const companion of spec.companionHosts ?? []) {
      companionTasks.push(
        yield* spawn(function*() {
          yield* companion(runtime);
        }),
      );
    }

    // Acquire the listener before consumers can poll a locally hosted provider.
    const serverTask = yield* spawn(() =>
      startServer(
        spec.http.port,
        consoleLogger,
        runtime,
        {
          hostname: spec.http.hostname,
          onListen: spec.http.onListen,
          ...protocolPolicy,
        },
        closeKernel,
      )
    );
    runtimeTask = yield* spawn(() => runAgentRuntime(runtime, { hab: spec.serviceHab }));
    yield* serverTask;
  } finally {
    yield* closeKernel();
  }
}
