/** Real forwarding verifies separate parent thresholds and preserves nested payload ownership. */
import {
  b,
  collectPayload,
  Counter,
  Diger,
  discardFrame,
  essrPayload,
  framePayload,
  MemoryPayloadSink,
  parseBytes,
  Prefixer,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { reply } from "../../../src/core/protocol-eventing.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { messageAttachmentGroups, serializeMessage } from "../../../src/core/protocol-serialization.ts";

/** Explicit current-establishment groups preserve child and parent signing boundaries. */
function group(sender: Hab, body: SerderKERI, indices = [0, 1, 2]): TransIdxSigGroup {
  const sigs = sender.sign(body.raw, true);
  return new TransIdxSigGroup(
    new Prefixer({ qb64: sender.pre }),
    sender.kever!.sner,
    new Diger({ qb64: sender.kever!.said }),
    indices.map((index) => sigs[index]),
  );
}

Deno.test("KRAM nested forwarding survives split parent signatures and reopen without accepting the child independently", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender", undefined, { icount: 3, isith: "2", ncount: 3, nsith: "2" });
    const provider = hby.makeHab("provider", undefined, { transferable: false });
    const recipient = hby.makeHab("recipient", undefined, { wits: [provider.pre], toad: 1 });
    const runtime = yield* createAgentRuntime(hby, {
      enableMailboxStore: true,
      kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    const body = exchange("/essr/test", {}, {
      sender: sender.pre,
      diger: new Diger({ raw: Diger.digest(b("abc"), "E"), code: "E" }),
    })[0];
    const [child] = yield* call(() =>
      parseBytes(serializeMessage(body, { tsgs: [group(sender, body)], gvrsn: Vrsn_2_0, genusify: true }))
    );
    const sink = new MemoryPayloadSink(8);
    yield* call(() => sink.write(b("4BABYWJj")));
    child.essr = essrPayload(yield* call(() => sink.finish()), 1, 3, Vrsn_2_0);
    const parent = exchange("/fwd", { evt: new Diger({ raw: Diger.digest(body.raw, "E"), code: "E" }).qb64 }, {
      sender: sender.pre,
      pvrsn: Vrsn_2_0,
      modifiers: { pre: recipient.pre, topic: "/nested" },
    })[0];
    try {
      const first = yield* call(() =>
        collectPayload(
          framePayload({
            body: parent,
            attachments: messageAttachmentGroups({ tsgs: [group(sender, parent, [0])] }, Vrsn_2_0),
            nests: [child],
            gvrsn: Vrsn_2_0,
          }),
          8192,
        )
      );
      yield* runtime.reactor.processBytes(first, { mailboxAid: provider.pre });
      assertEquals(hby.db.exns.get(parent.said!), null);
      assertEquals(hby.db.exns.get(body.said!), null);
      assertExists(hby.db.pmkm.get([sender.pre, parent.said!]));
      assertExists(hby.db.kpnd.get([sender.pre, parent.said!]));
      yield* hby.db.reopen();
      const second = serializeMessage(parent, { tsgs: [group(sender, parent, [1])], gvrsn: Vrsn_2_0, genusify: true });
      yield* runtime.reactor.processBytes(second, { mailboxAid: provider.pre });
      assertExists(hby.db.exns.get(parent.said!));
      assertEquals(hby.db.exns.get(body.said!), null);
      assertEquals(hby.db.pmkm.get([sender.pre, parent.said!]), null);
      assertEquals(hby.db.kpnd.get([sender.pre, parent.said!]), null);
      const saved = [...runtime.mailboxDirector.topicIter(recipient.pre, "/nested")];
      assertEquals(saved.length, 1);
      const restored = yield* call(() => parseBytes(new Uint8Array([...Counter.makeGVC(Vrsn_2_0), ...saved[0].msg])));
      try {
        assertEquals(restored[0].body.raw, body.raw);
        assertEquals(yield* call(() => collectPayload(restored[0].essr!.raw, 3)), b("abc"));
        // Recipient verification is a separate live Exchanger attempt over the child's signatures.
        const delivered = yield* call(() => collectPayload(framePayload(restored[0], { gvrsn: Vrsn_2_0 }), 8192));
        yield* runtime.reactor.processBytes(delivered);
        assertExists(hby.db.exns.get(body.said!), "the child becomes accepted only after its own verification");
      } finally {
        yield* call(() => Promise.all(restored.map(discardFrame)));
      }
    } finally {
      yield* call(() => discardFrame(child));
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM OOBI exemptions still require actual reply verification without a matching timeliness cache", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    const wrong = hby.makeHab("wrong");
    const runtime = yield* createAgentRuntime(hby, { kram: { enabled: true } });
    try {
      const endpoint = reply("/end/role/add", { cid: sender.pre, role: "controller", eid: sender.pre }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const location = reply("/loc/scheme", { eid: sender.pre, scheme: "http", url: "http://example.test/" }, {
        pre: sender.pre,
        pvrsn: Vrsn_2_0,
      });
      const invalid = group(sender, location, [0]);
      invalid.sigers.splice(0, invalid.sigers.length, ...wrong.sign(location.raw, true));
      yield* runtime.reactor.processBytes(serializeMessage(location, { tsgs: [invalid], gvrsn: Vrsn_2_0 }));
      assertEquals(hby.db.locs.get([sender.pre, "http"]), null, "exemption does not authenticate the reply");
      for (const body of [endpoint, location]) {
        yield* runtime.reactor.processBytes(
          serializeMessage(body, { tsgs: [group(sender, body, [0])], gvrsn: Vrsn_2_0 }),
        );
        assertEquals(hby.db.msgc.get([sender.pre, body.said!]), null);
      }
      assertEquals(hby.db.ends.get([sender.pre, "controller", sender.pre])?.allowed, true);
      assertEquals(hby.db.locs.get([sender.pre, "http"])?.url, "http://example.test/");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
