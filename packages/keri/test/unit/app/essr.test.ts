import { concatBytes, Diger, Encrypter, MtrDex, Prefixer, Texter } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { type EssrDecision, type EssrMessage, EssrRecipient } from "../../../src/app/essr.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";

/** Acceptance exposes data; refusal and rejection never expose unauthenticated bytes. */
function accepted(decision: EssrDecision): EssrMessage {
  if (decision.kind !== "accept") throw new Error(`Unexpected ESSR outcome: ${decision.kind}`);
  return decision.message;
}

/** Keep recipient checks on real accepted state, keys and LMDB evidence. */
async function scenario(test: (context: { hby: Habery; sender: Hab; recipient: Hab }) => Promise<void>): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* call(() => test({ hby, sender: hby.makeHab("sender"), recipient: hby.makeHab("recipient") }));
    } finally {
      yield* hby.close(true);
    }
  });
}

/** Reproduce the pinned StreamPoster header; padding is a complete CESR Bexter. */
function plaintext(sender: Hab, body: Uint8Array, tag = "XSCS", padding = "4AAA", source = sender.pre): Uint8Array {
  return concatBytes(new TextEncoder().encode(tag + source + padding), body);
}

/** Seal to one recipient key using the existing primitive-owned crypto implementation. */
function seal(recipient: Hab, plain: Uint8Array): Uint8Array {
  return new Encrypter({ verkey: recipient.kever!.verfers[0].qb64 }).encrypt({
    ser: plain,
    code: MtrDex.X25519_Cipher_L0,
  }).raw;
}

/** Sign and accept through the real Exchanger; keep ciphertext as replay evidence. */
async function accept(
  hby: Habery,
  sender: Hab,
  recipient: Hab,
  cipher: Uint8Array,
  modifiers: Partial<{ src: string; dest: string }> = {},
): Promise<string> {
  const [serder] = exchange("/essr/req", {}, {
    sender: sender.pre,
    diger: new Diger({ raw: Diger.digest(cipher, MtrDex.Blake3_256), code: MtrDex.Blake3_256 }),
    modifiers: { src: sender.pre, dest: recipient.pre, ...modifiers },
  });
  const tsg = new TransIdxSigGroup(
    new Prefixer({ qb64: sender.pre }),
    sender.kever!.sner,
    new Diger({ qb64: sender.kever!.said }),
    sender.sign(serder.raw, true),
  );
  const texter = new Texter({ raw: cipher, code: MtrDex.Bytes_L0 });
  const result = await run(() =>
    new Exchanger(hby).processEvent({
      serder,
      tsgs: [tsg],
      essrs: [texter],
    })
  );
  assertEquals(result.kind, "accept");
  return serder.said!;
}

Deno.test("ESSR recipient returns caller-owned authenticated bytes and preserves LMDB ciphertext", async () => {
  await scenario(async ({ hby, sender, recipient }) => {
    const body = exchange("/inner", { message: "hello" }, { sender: sender.pre })[0].raw;
    const cipher = seal(recipient, plaintext(sender, body, "XSCS", "4AABabcd"));
    const said = await accept(hby, sender, recipient, cipher);
    const receiver = new EssrRecipient(recipient), message = accepted(receiver.decrypt(said));
    assertEquals(message, { sender: sender.pre, recipient: recipient.pre, body });
    assertEquals(hby.db.getEssrs(said)![0].raw, cipher);
    message.body.fill(0);
    assertEquals(accepted(receiver.decrypt(said)).body, body);
    assertEquals(hby.db.getEssrs(said)![0].raw, cipher);
  });
});

Deno.test("ESSR recipient refuses unaccepted or misaddressed exchanges before hydrating evidence", async () => {
  await scenario(async ({ hby, sender, recipient }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const saids = [];
    for (const modifiers of [{ dest: sender.pre }, { src: recipient.pre }]) {
      saids.push(await accept(hby, sender, recipient, cipher, modifiers));
    }
    const read = hby.db.getEssrs;
    hby.db.getEssrs = () => {
      throw new Error("Premature evidence read");
    };
    try {
      const receiver = new EssrRecipient(recipient);
      assertEquals(receiver.decrypt("missing"), { kind: "refuse", reason: "unaccepted" });
      for (const said of saids) assertEquals(receiver.decrypt(said), { kind: "reject", reason: "envelope" });
    } finally {
      hby.db.getEssrs = read;
    }
  });
});

Deno.test("ESSR recipient rejects digest corruption, sealed-box authentication failure and invalid SCS framing", async () => {
  await scenario(async ({ hby, sender, recipient }) => {
    const body = new TextEncoder().encode("-AAA"), receiver = new EssrRecipient(recipient);
    const cipher = seal(recipient, plaintext(sender, body)), said = await accept(hby, sender, recipient, cipher);
    const tampered = cipher.slice();
    tampered[tampered.length - 1] ^= 1;
    hby.db.pinEssrs(said, [new Texter({ raw: tampered, code: MtrDex.Bytes_L0 })]);
    assertEquals(receiver.decrypt(said), { kind: "reject", reason: "digest" });
    // A valid signed commitment to bad ciphertext isolates authenticated-decryption failure.
    const corrupt = await accept(hby, sender, recipient, tampered);
    assertEquals(receiver.decrypt(corrupt), { kind: "reject", reason: "decrypt" });
    const wrongKey = await accept(hby, sender, recipient, seal(sender, plaintext(sender, body)));
    assertEquals(receiver.decrypt(wrongKey), { kind: "reject", reason: "decrypt" });
    for (
      const invalid of [
        plaintext(sender, body, "XHOP"),
        plaintext(sender, body, "XSCS", "4AAA", recipient.pre),
        plaintext(sender, body, "XSCS", "4BAA"),
        plaintext(sender, new Uint8Array()),
      ]
    ) {
      const invalidSaid = await accept(hby, sender, recipient, seal(recipient, invalid));
      assertEquals(receiver.decrypt(invalidSaid), { kind: "reject", reason: "framing" });
    }
  });
});

Deno.test("ESSR recipient rejects ciphertext shorter than the sealed-box overhead", async () => {
  await scenario(async ({ hby, sender, recipient }) => {
    const said = await accept(hby, sender, recipient, new Uint8Array(47));
    assertEquals(new EssrRecipient(recipient).decrypt(said), { kind: "reject", reason: "envelope" });
  });
});

Deno.test("ESSR recipient propagates unexpected keeper and evidence failures", async () => {
  await scenario(async ({ hby, sender, recipient }) => {
    const cipher = seal(recipient, plaintext(sender, new TextEncoder().encode("-AAA")));
    const said = await accept(hby, sender, recipient, cipher), receiver = new EssrRecipient(recipient);
    const failure = new Error("keeper unavailable"), read = hby.ks.pris.get;
    hby.ks.pris.get = () => {
      throw failure;
    };
    try {
      assertEquals(assertThrows(() => receiver.decrypt(said)), failure);
    } finally {
      hby.ks.pris.get = read;
    }
    const exchangeRead = hby.db.exns.get;
    hby.db.exns.get = () => {
      throw failure;
    };
    try {
      assertEquals(assertThrows(() => receiver.decrypt(said)), failure);
    } finally {
      hby.db.exns.get = exchangeRead;
    }
    assertEquals(accepted(receiver.decrypt(said)).body, new TextEncoder().encode("-AAA"));
  });
});
