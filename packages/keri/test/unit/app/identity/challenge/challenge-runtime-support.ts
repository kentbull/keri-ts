import { type Operation, run } from "effection";
import { createHabery } from "../../../../../src/app/identity/habbing.ts";
import { createAgentRuntime, settleRuntimeIngress } from "../../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../../src/app/transport/http-client.ts";
import { EndpointRoles } from "../../../../../src/core/roles.ts";

export interface SeededIdentifier {
  pre: string;
  controllerBytes: Uint8Array;
}

/** Seed one hosted identifier and capture its controller OOBI response bytes. */
export async function seedHostedIdentifier(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
  { mailbox = false }: { mailbox?: boolean } = {},
): Promise<SeededIdentifier> {
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

      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      yield* settleRuntimeIngress(runtime, [
        hab.makeLocScheme(url, hab.pre, "http"),
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        ...(mailbox ? [hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true)] : []),
      ]);

      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  return { pre, controllerBytes };
}

/** Seed one local identifier without hosted endpoint state. */
export async function seedLocalIdentifier(
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
