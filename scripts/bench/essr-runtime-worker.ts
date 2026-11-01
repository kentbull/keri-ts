/**
 * Manual local prototype for signed ESSR storage; HTTP qualification follows later.
 * Payload bytes have an independent oracle. Production framing/parser agreement
 * does not establish interoperability: pinned KERIpy vectors provide that evidence.
 */
import { call, run } from "effection";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { cpuUsage } from "node:process";
import {
  b,
  concatBytes,
  Counter,
  Diger,
  Encrypter,
  MtrDex,
  parse,
  Prefixer,
  type SerderKERI,
  Texter,
} from "../../packages/cesr/mod.ts";
import { abortable } from "../../packages/keri/src/app/abortable.ts";
import { EssrRecipient } from "../../packages/keri/src/app/essr.ts";
import { Exchanger } from "../../packages/keri/src/app/exchanging.ts";
import { createHabery, type Hab } from "../../packages/keri/src/app/habbing.ts";
import { envelopesFromFrames } from "../../packages/keri/src/app/parsering.ts";
import { attachmentCounterQb64b } from "../../packages/keri/src/core/attachment-countering.ts";
import { TransIdxSigGroup } from "../../packages/keri/src/core/dispatch.ts";
import { exchange } from "../../packages/keri/src/core/protocol-exchanging.ts";
import { serializeMessage } from "../../packages/keri/src/core/protocol-serialization.ts";

/** One supervisor-supplied case; aggregate bytes count user data before JSON/base64 overhead. */
interface RuntimeOptions {
  /** Total deterministic user bytes across all messages. */
  payloadBytes: number;
  /** Maximum user bytes in one logical message. */
  itemBytes: number;
  /** Transport read size, independent of logical message size. */
  chunkBytes: number;
  /** Cycle through 4 KiB, 64 KiB, and 1 MiB items instead of one fixed size. */
  mixed?: boolean;
  /** Target CESR attachment genus; both supported protocol generations remain qualified. */
  genus?: 1 | 2;
  /** Exercise the binary CESR representation at parser ingress. */
  binary?: boolean;
  /** Await this delay after consuming each message to exercise source backpressure. */
  throttleMs?: number;
}

/** Node's SHA-256 supplies an oracle independent of CESR digest parsing and encoding. */
const hash = () => createHash("sha256");
/** Timing and aggregate counters retain no message or identifier history. */
const counters = {
  produced: 0,
  verified: 0,
  replayed: 0,
  payloadBytes: 0,
  wireBytes: 0,
  cipherBytes: 0,
  qualifiedCipherBytes: 0,
  plaintextBytes: 0,
  innerBytes: 0,
  firstVerifiedMs: null as number | null,
  reopenMs: 0,
  replayMs: 0,
  durableQualifiedCipherBytes: 0,
  durablePlaintextBytes: 0,
};
/** Independent digests distinguish user bytes, plaintext, ciphertext, and wire representation. */
const digests = { source: hash(), verified: hash(), cipher: hash(), plain: hash(), wire: hash() };
/** Sum independent item digests modulo 2^256 because LMDB replay is ordered by SAID. */
const sourceSet = new Uint8Array(32);
/** Replayed multiplicities must match the source sum and the exact item count. */
const replaySet = new Uint8Array(32);
/** Process memory includes LMDB mappings; it must not be mislabeled as parser/queue residency. */
const memory = { rss: 0, heapUsed: 0, external: 0 };
/** Linux can distinguish LMDB file-backed residency from the rest of the process. */
let mappedRss: number | null = null;
/** Sample runtime high-water marks at each finite message boundary. */
function sampleMemory(): void {
  const current = Deno.memoryUsage();
  for (const key of ["rss", "heapUsed", "external"] as const) memory[key] = Math.max(memory[key], current[key]);
}

/** Read only Linux mapping headers and Rss rows; other platforms report this metric unavailable. */
async function lmdbRss(): Promise<number | null> {
  if (Deno.build.os !== "linux") return null;
  const file = await Deno.open("/proc/self/smaps", { read: true });
  let carry = "";
  let database = false;
  let rss = 0;
  const decoder = new TextDecoder();
  // FsFile.readable owns the descriptor and closes it on EOF or iterator return.
  for await (const chunk of file.readable) {
    carry += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      if (/^[0-9a-f]+-[0-9a-f]+ /.test(line)) database = /\/(data|lock)\.mdb(?: \(deleted\))?$/.test(line);
      else if (database && line.startsWith("Rss:")) rss += Number(line.split(/\s+/)[1]) * 1024;
    }
  }
  return rss;
}

/** Produce bytes without consulting the parser, serializer, storage, or their test fixtures. */
function item(size: number, ordinal: number): Uint8Array {
  const bytes = Uint8Array.from({ length: size }, (_, offset) => offset % 251);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(ordinal));
  return bytes;
}

/** Check the embedded ordinal and every deterministic byte before updating the replay oracle. */
function checkItem(bytes: Uint8Array, expected?: number): number {
  if (bytes.length < 8) throw new Error("Missing item sequence");
  const ordinal = Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0));
  if (!Number.isSafeInteger(ordinal) || (expected !== undefined && ordinal !== expected)) {
    throw new Error("Wrong item order");
  }
  for (let at = 8; at < bytes.length; at++) {
    if (bytes[at] !== at % 251) throw new Error("Wrong plaintext byte");
  }
  return ordinal;
}

/** Add a big-endian SHA-256 value modulo 2^256; equal pairs contribute twice instead of cancelling. */
function addSet(target: Uint8Array, bytes: Uint8Array): void {
  const digest = hash().update(bytes).digest();
  let carry = 0;
  for (let at = target.length - 1; at >= 0; at--) {
    const sum = target[at] + digest[at] + carry;
    target[at] = sum & 255;
    carry = sum >>> 8;
  }
}

/** Construct authenticated source material while retaining only the current logical message. */
function encodeItem(sender: Hab, recipient: Hab, bytes: Uint8Array, genus: 1 | 2, binary: boolean): Uint8Array {
  const gvrsn = { major: genus, minor: 0 };
  const inner = exchange("/benchmark/item", { b: Buffer.from(bytes).toString("base64url") }, {
    sender: sender.pre,
    date: "2026-01-01T00:00:00.000000+00:00",
  })[0];
  const plain = concatBytes(b("XSCS" + sender.pre + "4AAA"), inner.raw);
  const cipher = new Encrypter({ verkey: recipient.kever!.verfers[0].qb64 }).encrypt({
    ser: plain,
    code: MtrDex.X25519_Cipher_L0,
  }).raw;
  const outer = exchange("/essr/req", {}, {
    sender: sender.pre,
    date: "2026-01-01T00:00:00.000000+00:00",
    modifiers: { src: sender.pre, dest: recipient.pre },
    diger: new Diger({ raw: Diger.digest(cipher, "E"), code: "E" }),
  })[0];
  const tsg = new TransIdxSigGroup(
    new Prefixer({ qb64: sender.pre }),
    sender.kever!.sner,
    new Diger({ qb64: sender.kever!.said }),
    sender.sign(outer.raw, true),
  );
  const message = serializeMessage(outer, { tsgs: [tsg], gvrsn });
  const token = new Texter({ raw: cipher, code: MtrDex.Bytes_L0 }).qb64b;
  const body = Counter.enclose({
    qb64: new Texter({ raw: outer.raw, code: MtrDex.Bytes_L0 }).qb64b,
    code: "NonNativeBodyGroup",
    version: gvrsn,
  });
  const framed = concatBytes(
    Counter.makeGVC(gvrsn),
    Counter.enclose({
      qb64: concatBytes(
        body,
        message.subarray(outer.raw.length),
        attachmentCounterQb64b("ESSRPayloadGroup", genus === 1 ? 1 : token.length / 4, gvrsn),
        token,
      ),
      code: "BodyWithAttachmentGroup",
      version: gvrsn,
    }),
  );
  counters.innerBytes += inner.raw.length;
  counters.plaintextBytes += plain.length;
  counters.cipherBytes += cipher.length;
  counters.qualifiedCipherBytes += token.length;
  digests.source.update(bytes);
  digests.cipher.update(cipher);
  digests.plain.update(plain);
  addSet(sourceSet, bytes);
  return binary
    ? new Uint8Array(Buffer.from(new TextDecoder().decode(framed), "base64url"))
    : framed;
}

/** Read exactly one inner frame; the parser never accumulates an entire transfer. */
async function consumeInner(source: AsyncIterable<Uint8Array>, ordinal?: number): Promise<Uint8Array> {
  let result: Uint8Array | undefined;
  for await (const frame of parse(source)) {
    if (result) throw new Error("Expected exactly one inner frame");
    const inner = envelopesFromFrames([{ type: "frame", frame }])[0].serder as SerderKERI;
    const encoded = (inner.a as Record<string, unknown>).b;
    if (typeof encoded !== "string") throw new Error("Missing benchmark bytes");
    result = new Uint8Array(Buffer.from(encoded, "base64url"));
    checkItem(result, ordinal);
  }
  if (!result) throw new Error("Missing inner frame");
  return result;
}

/** Admit supported finite sizes before any keystore or payload allocation. */
const options = JSON.parse(Deno.args[0]) as RuntimeOptions;
for (const value of [options.payloadBytes, options.itemBytes, options.chunkBytes]) {
  if (!Number.isSafeInteger(value) || value < 8) throw new RangeError("Invalid benchmark size");
}
if (
  options.payloadBytes % 4096 || options.itemBytes % 4096 || options.itemBytes > 1024 ** 2
  || options.chunkBytes > 1024 ** 2
) {
  throw new RangeError("Use whole 4 KiB items/aggregate and chunks no larger than 1 MiB");
}
/** Body encoding stays below a finite logical-message cap, including its JSON envelope. */
const maxBytes = 2 * (options.mixed ? 1024 ** 2 : options.itemBytes) + 4096;
/** Aggregate start includes key setup; usable-result time includes authentication and persisted reread. */
const started = performance.now();
const cpu = cpuUsage();
let error: string | null = null;
let lmdbFileBytes = 0;

try {
  await run(function*() {
    const hby = yield* createHabery({
      name: `essr-qualification-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const sender = hby.makeHab("sender");
      const recipient = hby.makeHab("recipient");
      const archive = yield* abortable((signal) => hby.db.openPayloads(signal));
      const receiver = new EssrRecipient(recipient, archive.files, maxBytes);
      const exchanger = new Exchanger(hby, { maxEssrBytes: maxBytes });
      /** Pull one encoded message at a time; each yielded chunk owns only its admitted backing bytes. */
      const source = async function*(): AsyncGenerator<Uint8Array> {
        let remaining = options.payloadBytes;
        while (remaining) {
          const chosen = options.mixed ? [4096, 65536, 1048576][counters.produced % 3] : options.itemBytes;
          const size = Math.min(remaining, chosen);
          const bytes = encodeItem(
            sender,
            recipient,
            item(size, counters.produced),
            options.genus ?? 2,
            !!options.binary,
          );
          counters.produced++;
          for (let at = 0; at < bytes.length; at += options.chunkBytes) {
            const chunk = bytes.slice(at, at + options.chunkBytes);
            counters.wireBytes += chunk.length;
            digests.wire.update(chunk);
            yield chunk;
          }
          remaining -= size;
        }
      };
      const frames = parse(source(), {
        maxEssrBytes: maxBytes,
        payloadSink: (limit, signal) => archive.files.stage(limit, signal),
      });
      try {
        for (;;) {
          const next = yield* abortable(() => frames.next());
          if (next.done) break;
          const frame = next.value;
          try {
            const envelope = envelopesFromFrames([{ type: "frame", frame }])[0];
            const decision = yield* exchanger.processEvent({ ...envelope, serder: envelope.serder as SerderKERI });
            if (decision.kind !== "accept" || !frame.essr) throw new Error("Exchange was not accepted");
            const decoded = yield* receiver.decrypt(decision.said, frame.essr.raw);
            try {
              const stored = yield* abortable((signal) =>
                hby.db.savePlaintext(
                  decision.said,
                  decoded.plaintext,
                  decoded.plaintext.size - decoded.body.size,
                  signal,
                )
              );
              const bytes = yield* abortable((signal) => consumeInner(stored.body.open(signal), counters.verified));
              counters.durableQualifiedCipherBytes += frame.essr.wire.size;
              counters.durablePlaintextBytes += stored.plaintext.size;
              counters.payloadBytes += bytes.length;
              counters.verified++;
              digests.verified.update(bytes);
              if (counters.firstVerifiedMs === null) counters.firstVerifiedMs = performance.now() - started;
            } finally {
              yield* call(() => decoded.plaintext.discard());
            }
          } finally {
            yield* call(() => frame.essr?.discard());
          }
          sampleMemory();
          if (options.throttleMs) yield* call(() => new Promise((resolve) => setTimeout(resolve, options.throttleMs)));
        }
      } finally {
        yield* call(() => frames.return(undefined));
      }
      mappedRss = yield* call(lmdbRss);
      const reopen = performance.now();
      yield* hby.db.reopen();
      yield* abortable((signal) => hby.db.openPayloads(signal));
      counters.reopenMs = performance.now() - reopen;
      const replay = performance.now();
      for (const [keys] of hby.db.exns.getTopItemIter()) {
        const said = keys[0];
        const plain = yield* abortable((signal) => hby.db.getPlaintext(said, signal));
        if (!plain) throw new Error("Missing durable plaintext");
        const bytes = yield* abortable((signal) => consumeInner(plain.body.open(signal)));
        addSet(replaySet, bytes);
        let seen = 0;
        yield* abortable(async (signal) => {
          for await (const frame of parse(exchanger.replay(said, signal))) {
            try {
              if (!frame.essr) throw new Error("Replay lost ciphertext");
              const serder = envelopesFromFrames([{ type: "frame", frame }])[0].serder as SerderKERI;
              if (!await new Diger({ qb64: serder.a as string }).verifyStream(frame.essr.raw.open(signal))) {
                throw new Error("Replayed ciphertext differs from signed commitment");
              }
              seen++;
            } finally {
              await frame.essr?.discard();
            }
          }
        });
        if (seen !== 1) throw new Error("Replay emitted the wrong number of frames");
        counters.replayed++;
        sampleMemory();
      }
      counters.replayMs = performance.now() - replay;
      lmdbFileBytes = (yield* call(() => Deno.stat(hby.db.path! + "/data.mdb"))).size;
    } finally {
      yield* hby.close(true);
    }
  });
  if (
    counters.payloadBytes !== options.payloadBytes || counters.produced !== counters.verified
    || counters.replayed !== counters.verified
  ) {
    throw new Error("Lost payloads");
  }
  if (!sourceSet.every((value, index) => value === replaySet[index])) throw new Error("Wrong durable payload set");
} catch (cause) {
  error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}
sampleMemory();
const sourceDigest = digests.source.digest("hex");
const verifiedDigest = digests.verified.digest("hex");
if (!error && sourceDigest !== verifiedDigest) error = "Source/consumer payload digest mismatch";
console.log(JSON.stringify({
  status: error ? "error" : "ok",
  error,
  mode: "local-prototype-no-http",
  options,
  runtime: Deno.version,
  elapsedMs: performance.now() - started,
  cpuMicroseconds: cpuUsage(cpu),
  ...counters,
  memory,
  lmdbMappedRssBytes: mappedRss,
  lmdbFileBytes,
  memoryNote:
    "RSS includes mapped database pages; LMDB residency available only from Linux smaps. No hard resident-memory claim.",
  oracleNote:
    "Payload byte/order and durable multiplicity checks are independent. Wire interoperability requires separate pinned KERIpy vector evidence.",
  hashes: {
    source: sourceDigest,
    verified: verifiedDigest,
    cipher: digests.cipher.digest("hex"),
    plaintext: digests.plain.digest("hex"),
    wire: digests.wire.digest("hex"),
    replaySet: Buffer.from(replaySet).toString("hex"),
  },
}));
Deno.exit(error ? 1 : 0);
