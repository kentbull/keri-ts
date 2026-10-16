import { type Operation, spawn, type Task } from "effection";
import {
  type AgentRuntime,
  consoleLogger,
  createAgentRuntime,
  type Hab,
  type Habery,
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

/** Package-internal host-kernel configuration for one long-lived role host. */
export interface HostKernelSpec {
  /** Whether this host constructs provider mailbox storage. */
  enableMailboxStore: boolean;
  serviceHab: Hab;
  hostedPrefixes?: readonly string[];
  http: HostKernelHttpSpec;
  protocolPolicy: Omit<ProtocolHostPolicy, "serviceHab" | "hostedPrefixes">;
  companionHosts?: readonly HostTaskFactory[];
}

/**
 * Run one shared host kernel over the common runtime lifecycle.
 *
 * Lifecycle contract:
 * - create the runtime once
 * - operators reconcile required endpoint state before entering the host
 * - run optional companion hosts under the same supervision tree
 * - always halt companion hosts before the runtime task, then close runtime
 */
export function* runHostKernel(
  hby: Habery,
  spec: HostKernelSpec,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, {
    enableMailboxStore: spec.enableMailboxStore,
  });
  const hostedPrefixes = spec.hostedPrefixes ?? [spec.serviceHab.pre];
  const protocolPolicy: ProtocolHostPolicy = {
    ...spec.protocolPolicy,
    serviceHab: spec.serviceHab,
    hostedPrefixes,
  };

  const runtimeTask = yield* spawn(function*() {
    yield* runAgentRuntime(runtime, {
      hab: spec.serviceHab,
    });
  });
  const companionTasks: Task<void>[] = [];
  let closed = false;
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
      yield* runtimeTask.halt();
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

    yield* startServer(
      spec.http.port,
      consoleLogger,
      runtime,
      {
        hostname: spec.http.hostname,
        onListen: spec.http.onListen,
        ...protocolPolicy,
      },
      closeKernel,
    );
  } finally {
    yield* closeKernel();
  }
}
