import { type Operation, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { oobiResolveCommand } from "../../../src/app/cli/oobi.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { sleepOp } from "../../effection-http.ts";
import { testCLICommand } from "../../utils.ts";

export interface SeededController {
  pre: string;
  controllerBytes: Uint8Array;
}

/**
 * Resolve one remote controller OOBI and authorize it locally as a mailbox.
 *
 * These focused poller tests care about local mailbox polling state, not the
 * remote mailbox admin workflow, so they use the local `ends add` seam after
 * resolving the remote controller endpoint.
 */
export async function authorizeMailboxPollTarget(
  name: string,
  headDirPath: string,
  alias: string,
  mailboxPre: string,
  mailboxUrl: string,
): Promise<void> {
  await run(function*(): Operation<void> {
    const resolved = yield* testCLICommand(
      oobiResolveCommand({
        name,
        headDirPath,
        url: `${mailboxUrl}/oobi/${mailboxPre}/controller`,
        oobiAlias: mailboxPre,
      }),
    );
    assertEquals(
      resolved.output.at(-1),
      `${mailboxUrl}/oobi/${mailboxPre}/controller`,
    );

    const added = yield* testCLICommand(
      endsAddCommand({
        name,
        headDirPath,
        alias,
        role: "mailbox",
        eid: mailboxPre,
      }),
    );
    assertEquals(added.output.at(-1), `mailbox ${mailboxPre}`);
  });
}

/** Wait for a short-lived test condition inside one Effection task tree. */
export function* waitForCondition(
  condition: () => boolean,
  {
    timeoutMs = 500,
    retryDelayMs = 10,
    message = "Timed out waiting for condition.",
  }: {
    timeoutMs?: number;
    retryDelayMs?: number;
    message?: string;
  } = {},
): Operation<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    yield* sleepOp(retryDelayMs);
  }
  throw new Error(message);
}

/** Delay inside a test HTTP handler, but clear the timer if the request aborts. */
export async function delayForRequest(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Seed one hosted transferable controller and capture its controller OOBI
 * response bytes for later static serving.
 */
export async function seedHostedController(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
): Promise<SeededController> {
  let pre = "";
  let controllerBytes = new Uint8Array();

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });
      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  return { pre, controllerBytes };
}

/** Seed one local transferable controller used as a mailbox client in tests. */
export async function seedLocalController(
  name: string,
  headDirPath: string,
  alias: string,
): Promise<string> {
  let pre = "";

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      pre = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  return pre;
}
