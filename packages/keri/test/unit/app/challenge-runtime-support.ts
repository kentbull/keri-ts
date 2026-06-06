import { type Operation, run } from "effection";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

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

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      if (mailbox) {
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
        );
      }
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
