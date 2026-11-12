import type { SerderKERI } from "cesr-ts";
import { type Operation, run, sleep } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { DelegationWorkflowStatus } from "../../../../src/app/identity/delegating.ts";
import {
  beginDelegation,
  completeEvent,
  DELEGATION_WAIT_TIMEOUT_MS,
  type DelegationCollaborator,
  delegationStatus,
  type EventCompletionDeps,
  receiptEvent,
  waitForDelegation,
} from "../../../../src/app/identity/event-completion.ts";
import type { Hab } from "../../../../src/app/identity/habbing.ts";
import { acceptedEventReplayMessage, type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createProtocolProcessor } from "../../../../src/app/protocol/protocol-processing.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import type { HttpClient } from "../../../../src/app/transport/http-client.ts";
import { NodeHttpClient } from "../../../../src/app/transport/node-http-client.ts";

/** Stand-in delegating workflow: durable state is a phase map the fake runtime advances. */
function fakeDelegation(options: { anchorAfterMs?: number; timeoutLog?: number[] } = {}) {
  const phases = new Map<string, DelegationWorkflowStatus["phase"]>();
  const completed = new Set<string>();
  const calls: string[] = [];
  const key = (pre: string, sn: number | string) => `${pre}:${typeof sn === "number" ? sn.toString(16) : sn}`;
  const collaborator: DelegationCollaborator = {
    anchorer: {
      beginLatest(pre, sn, opts) {
        calls.push(`begin ${pre} ${sn} proxy=${opts?.communicationHab?.pre ?? "-"}`);
        phases.set(key(pre, sn!), "waitingDelegatorAnchor");
        return {} as SerderKERI;
      },
      workflowStatus(pre, snh) {
        return {
          phase: phases.get(key(pre, snh)) ?? null,
          proxyDependent: false,
          complete: completed.has(key(pre, snh)),
        };
      },
      complete: (pre, sn) => completed.has(key(pre, sn)),
    },
    *runUntil(done, opts) {
      calls.push("run");
      options.timeoutLog?.push(opts.timeoutMs);
      const deadline = Date.now() + opts.timeoutMs;
      while (!done()) {
        if (Date.now() >= deadline) throw new Error(`Runtime did not converge within ${opts.timeoutMs}ms.`);
        if (options.anchorAfterMs !== undefined && Date.now() >= deadline - opts.timeoutMs + options.anchorAfterMs) {
          completed.add(key(opts.hab.pre, 0));
          phases.delete(key(opts.hab.pre, 0));
        }
        yield* sleep(2);
      }
    },
  };
  return { collaborator, calls };
}

const delegatedHab = { pre: "EDelegate" } as Hab;
const proxyHab = { pre: "EProxy" } as Hab;

Deno.test("beginDelegation returns at once and the status is read from the workflow", () => {
  const { collaborator, calls } = fakeDelegation();
  assertEquals(delegationStatus(collaborator, delegatedHab.pre, 0).phase, null);
  beginDelegation(collaborator, delegatedHab.pre, 0, proxyHab);
  assertEquals(calls, ["begin EDelegate 0 proxy=EProxy"]);
  assertEquals(delegationStatus(collaborator, delegatedHab.pre, 0), {
    phase: "waitingDelegatorAnchor",
    proxyDependent: false,
    complete: false,
  });
});

Deno.test("waitForDelegation reports the final status and defaults to the CLI deadline", async () => {
  const timeoutLog: number[] = [];
  const { collaborator } = fakeDelegation({ anchorAfterMs: 5, timeoutLog });
  beginDelegation(collaborator, delegatedHab.pre, 0);
  const status = await run(() => waitForDelegation(collaborator, delegatedHab, 0));
  assertEquals(status, { phase: null, proxyDependent: false, complete: true });
  assertEquals(timeoutLog, [DELEGATION_WAIT_TIMEOUT_MS]);
});

Deno.test("waitForDelegation fails when the anchor does not arrive before the deadline", async () => {
  const { collaborator } = fakeDelegation();
  beginDelegation(collaborator, delegatedHab.pre, 0);
  await assertRejects(
    () => run(() => waitForDelegation(collaborator, delegatedHab, 0, { timeoutMs: 30 })),
    Error,
    "Runtime did not converge within 30ms.",
  );
});

Deno.test("completeEvent opens the delegation scope only for delegated events, after resolving the proxy", async () => {
  const { collaborator, calls } = fakeDelegation({ anchorAfterMs: 5 });
  let scopes = 0;
  const deps = {
    hby: { habs: new Map() },
    *withDelegation<T>(use: (delegation: DelegationCollaborator) => Operation<T>) {
      scopes++;
      calls.push("scope");
      return yield* use(collaborator);
    },
  } as unknown as EventCompletionDeps;

  assertEquals(await run(() => completeEvent(deps, delegatedHab, 0)), { delegationPhase: null });
  assertEquals(scopes, 0);

  const result = await run(() =>
    completeEvent(deps, delegatedHab, 0, {
      delegation: {
        communicationHab: () => {
          calls.push("resolve");
          return proxyHab;
        },
      },
    })
  );
  assertEquals(result, { delegationPhase: null });
  assertEquals(calls, ["resolve", "scope", "begin EDelegate 0 proxy=EProxy", "run"]);

  await assertRejects(
    () =>
      run(() =>
        completeEvent(deps, delegatedHab, 0, {
          delegation: {
            communicationHab: () => {
              throw new Error("needs proxy");
            },
          },
        })
      ),
    Error,
    "needs proxy",
  );
  assertEquals(scopes, 1, "a rejected proxy never opens the delegation scope");
});

function receiptDeps(hby: Habery, http: HttpClient = new NodeHttpClient()) {
  return { hby, protocol: createProtocolProcessor(hby), http, clock: systemClock };
}

Deno.test("receiptEvent is a no-op without witnesses", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("plain", undefined, {});
      const failing: HttpClient = {
        request: () => {
          throw new Error("no request expected");
        },
        open: () => {
          throw new Error("no request expected");
        },
      };
      yield* receiptEvent(receiptDeps(hby, failing), hab.pre, { sn: 0 });
      yield* receiptEvent(receiptDeps(hby, failing), hab.pre, { sn: 0, endpoint: true });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("receiptEvent selects explicit-endpoint, cached-submit and forced-submit receipting", async () => {
  const requests: string[] = [];
  let reply: Uint8Array = new Uint8Array();
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (request) => {
    requests.push(new URL(request.url).pathname);
    await request.arrayBuffer();
    return new Response(new Uint8Array(reply).buffer);
  });
  try {
    await run(function*() {
      const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const provider = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      try {
        const witness = provider.makeHab("witness", undefined, { transferable: false });
        const controller = source.makeHab("controller", undefined, { wits: [witness.pre], toad: 1 });
        source.db.locs.pin([witness.pre, "http"], { url: `http://127.0.0.1:${server.addr.port}` });
        reply = witness.receipt(acceptedEventReplayMessage(source, controller.pre, 0).serder);
        const deps = receiptDeps(source);

        yield* receiptEvent(deps, controller.pre, { sn: 0, endpoint: true });
        assertEquals(requests, ["/receipts"], "endpoint mode contacts the witness");

        yield* receiptEvent(deps, controller.pre, { sn: 0 });
        assertEquals(requests, ["/receipts"], "submit mode accepts complete cached receipts");

        yield* receiptEvent(deps, controller.pre, { sn: 0, force: true });
        assertEquals(requests, ["/receipts", "/receipts"], "force resubmits despite complete receipts");

        yield* receiptEvent(deps, controller.pre, { sn: 0, endpoint: true });
        assertEquals(requests.length, 3, "endpoint mode ignores cached receipts");
      } finally {
        yield* source.close(true);
        yield* provider.close(true);
      }
    });
  } finally {
    await server.shutdown();
  }
});
