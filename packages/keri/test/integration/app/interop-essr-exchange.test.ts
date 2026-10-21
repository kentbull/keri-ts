import {
  b,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  Encrypter,
  essrChunks,
  framePayload,
  MtrDex,
  parseBytes,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import { fromFileUrl } from "jsr:@std/path";
import { EssrRecipient } from "../../../src/app/exchanges/essr.ts";
import { Exchanger } from "../../../src/app/exchanges/exchanging.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/identity/habbing.ts";
import { Reactor } from "../../../src/app/protocol/reactor.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { protocolFixture } from "../../protocol-fixture.ts";
import { createScenarioContext, runCmd } from "./interop-keystore-helpers.ts";
import { selectedKeripyProfile } from "./keripy-runtime.ts";

/** The pinned peer's actual ESSR output and introduction. */
interface PeerMessage {
  sender: string;
  kel: string;
  wire: string;
  inner: string;
}

Deno.test("interop/essr-exchange - actual Python envelope decrypts after restart; TS envelope accepts through the supported Python lane", async () => {
  const ctx = await createScenarioContext(), genus = selectedKeripyProfile(ctx.env)?.exportGenus ?? 2;
  const gvrsn = genus === 2 ? Vrsn_2_0 : Vrsn_1_0;
  const options = { name: "essr-ts", headDirPath: ctx.env.HOME, skipConfig: true };
  const request = `${ctx.env.HOME}/request.json`;
  /** Run a verified actual peer, with test-owned persistent state between the two phases. */
  async function reference(action: "create" | "receive", data: Record<string, unknown>) {
    await Deno.writeTextFile(request, JSON.stringify({ genus, ...data }));
    const result = await runCmd(
      ctx.pythonCommand,
      [
        fromFileUrl(new URL("./essr-exchange-reference.py", import.meta.url)),
        action,
        ctx.env.HOME,
        request,
      ],
      ctx.env,
      ctx.packageRoot,
    );
    assertEquals(result.code, 0, `${result.stderr}\n${result.stdout}`);
    return JSON.parse(result.stdout);
  }
  try {
    await run(function*() {
      let hby = yield* createHabery(options);
      try {
        const recipient = hby.makeHab("recipient");
        const peer: PeerMessage = yield* call(() =>
          reference("create", {
            recipient: recipient.pre,
            kel: encodeBase64(acceptedEventReplayMessage(hby, recipient.pre, 0, gvrsn).message),
          })
        );
        let reactor = new Reactor(protocolFixture(hby));
        // KERIpy selects its parser genus out of band; supply that known stream context.
        yield* reactor.processBytes(concatBytes(Counter.makeGVC(gvrsn), decodeBase64(peer.kel)));
        const wire = concatBytes(Counter.makeGVC(gvrsn), decodeBase64(peer.wire)), [frame] = parseBytes(wire);
        yield* reactor.processBytes(wire);
        assertEquals(new Exchanger(hby).complete(frame.body.said!), true);
        yield* hby.close();
        hby = yield* createHabery(options);
        const decision = new EssrRecipient(hby.habByName("recipient")!).decrypt(frame.body.said!);
        assertEquals(decision.kind, "accept");
        if (decision.kind !== "accept") throw new Error("Expected authenticated Python content");
        assertEquals(decision.message.sender, peer.sender);
        reactor = new Reactor(protocolFixture(hby));
        yield* reactor.processBytes(decision.message.body);
        assertExists(hby.db.exns.get([peer.inner]));
        const sender = hby.makeHab("outbound"), key = hby.db.getKever(peer.sender)!.verfers[0];
        const [inner] = exchange("/essr/inner", { message: "typescript" }, { sender: sender.pre, pvrsn: Vrsn_1_0 });
        const plaintext = concatBytes(
          b(`XSCS${sender.pre}4AAA`),
          sender.endorse(inner, { pipelined: false, gvrsn, genusify: gvrsn.major >= 2 }),
        );
        const ciphertext =
          new Encrypter({ verkey: key.qb64 }).encrypt({ ser: plaintext, code: MtrDex.X25519_Cipher_L0 }).raw;
        const [outer] = exchange("/essr/req", {}, {
          sender: sender.pre,
          pvrsn: Vrsn_1_0,
          diger: new Diger({ raw: Diger.digest(ciphertext, MtrDex.Blake3_256), code: MtrDex.Blake3_256 }),
          modifiers: { src: sender.pre, dest: peer.sender },
        });
        const [signed] = parseBytes(sender.endorse(outer, { pipelined: false, gvrsn, genusify: true }));
        const texter = new Texter({ raw: ciphertext, code: MtrDex.Bytes_L0 });
        // 1.3's parser requires a JSON body at root and cannot consume a genus selector.
        // Compose its supported v1 endorsement + ESSR group with the production codecs.
        let outgoing: Uint8Array;
        if (gvrsn.major === 1) {
          outgoing = concatBytes(
            sender.endorse(outer, { pipelined: false, gvrsn }),
            ...essrChunks([texter], { gvrsn }),
          );
        } else {
          outgoing = yield* call(() => collectPayload(framePayload({ ...signed, essrs: [texter] })));
        }
        const result = yield* call(() =>
          reference("receive", {
            sender: sender.pre,
            said: outer.said,
            wire: encodeBase64(outgoing),
            plaintext: encodeBase64(plaintext),
            kel: encodeBase64(acceptedEventReplayMessage(hby, sender.pre, 0, gvrsn).message),
          })
        );
        assertEquals(result, { accepted: outer.said, digest: true, plaintext: true, escrowRetry: genus === 1 });
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(ctx.env.HOME, { recursive: true });
  }
});
