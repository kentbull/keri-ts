/** Real Tufa mailbox provider in its own process; commands only seed payloads or inspect state. */
import { call, ensure, run } from "effection";
import { createProtocolHandler } from "../../../tufa/src/http/protocol-handler.ts";
import { createAgentRuntime } from "../../src/app/agent-runtime.ts";
import { createHabery } from "../../src/app/habbing.ts";

/** Closed commands for this test process, separate from protocol ingress. */
type Command = { action: "store"; pre: string } | { action: "inspect"; pre: string; saids: string[] };

await run(function*() {
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  yield* ensure(() => hby.close(true));
  const runtime = yield* createAgentRuntime(hby, {
    enableMailboxStore: true,
    kram: { enabled: true, denials: [], caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] } },
  });
  yield* ensure(() => runtime.close());
  const hab = hby.makeHab("relay", undefined, { transferable: false });
  const handler = createProtocolHandler(runtime, { serviceHab: hab });
  yield* ensure(() => call(() => handler.close?.()));
  const server = Deno.serve({ hostname: "127.0.0.1", port: Number(Deno.args[0]), onListen() {} }, async (request) => {
    if (new URL(request.url).pathname !== "/_fixture") return await handler(request);
    try {
      // This checked-in fixture's closed command format is not peer protocol input.
      const command = await request.json() as Command;
      if (command.action === "store") {
        runtime.mailboxer!.storeMsg(`${command.pre}/reply`, new TextEncoder().encode("authenticated-mailbox-payload"));
        return Response.json({ stored: true });
      }
      if (command.action === "inspect") {
        return Response.json({
          known: !!hby.db.getKever(command.pre),
          rows: command.saids.map((said) => {
            const cache = hby.db.msgc.get([command.pre, said]);
            return {
              said,
              cached: !!cache,
              pending: !!hby.db.pmkm.get([command.pre, said]),
              stamp: cache?.mdt ?? null,
            };
          }),
          streams: [...runtime.mailboxDirector.queryCues].map((cue) => "serder" in cue ? cue.serder?.said! : ""),
        });
      }
      throw new Error("Unknown fixture command");
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  });
  yield* ensure(() => call(() => server.shutdown()));
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => stop = resolve);
  Deno.addSignalListener("SIGTERM", stop);
  yield* ensure(function*() {
    Deno.removeSignalListener("SIGTERM", stop);
  });
  yield* call(() => stopped);
});
