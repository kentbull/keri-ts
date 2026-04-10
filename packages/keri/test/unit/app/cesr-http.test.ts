// @file-test-lane app-fast-parallel

/**
 * CESR-over-HTTP transport contract tests.
 *
 * These scenarios pin the mailbox and exchange framing behavior that must stay
 * aligned with KERIpy by default while still allowing Tufa's optional body
 * mode.
 */
import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { concatBytes } from "../../../../cesr/mod.ts";
import {
  buildCesrRequest,
  buildCesrStreamRequest,
  CESR_ATTACHMENT_HEADER,
  CESR_DESTINATION_HEADER,
  inspectCesrTerminalMessage,
  isCesrContentType,
  readCesrRequestBytes,
  readRequiredCesrRequestBytes,
  splitCesrStream,
} from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { makeEmbeddedExchangeMessage } from "../../../src/core/messages.ts";

/** Proves KERIpy-style header framing for one mailbox/query request. */
Deno.test("CESR HTTP - header mode splits attachments into the CESR header", async () => {
  let message!: Uint8Array;
  let request!: ReturnType<typeof buildCesrRequest>;
  let destination!: string;

  await run(function*() {
    const hby = yield* createHabery({
      name: `cesr-header-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      message = hab.query(hab.pre, hab.pre, { topics: { "/challenge": 0 } }, "mbx");
      destination = hab.pre;
      request = buildCesrRequest(message, {
        bodyMode: "header",
        destination,
      });
    } finally {
      yield* hby.close(true);
    }
  });

  assertExists(request.headers[CESR_ATTACHMENT_HEADER]);
  assertEquals(request.headers[CESR_DESTINATION_HEADER], destination);
  assertEquals(request.body.byteLength < message.length, true);
  assertEquals(
    await readCesrRequestBytes(
      new Request("http://example.test", {
        method: "POST",
        headers: request.headers,
        body: request.body,
      }),
    ),
    message,
  );
});

/** Proves the optional `keri-ts` body mode keeps the full CESR payload in the body. */
Deno.test("CESR HTTP - body mode preserves the full CESR message in the body", async () => {
  let message!: Uint8Array;
  let request!: ReturnType<typeof buildCesrRequest>;
  let destination!: string;

  await run(function*() {
    const hby = yield* createHabery({
      name: `cesr-body-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      message = hab.query(hab.pre, hab.pre, { topics: { "/challenge": 0 } }, "mbx");
      destination = hab.pre;
      request = buildCesrRequest(message, {
        bodyMode: "body",
        destination,
      });
    } finally {
      yield* hby.close(true);
    }
  });

  assertEquals(request.headers[CESR_ATTACHMENT_HEADER], undefined);
  assertEquals(request.headers[CESR_DESTINATION_HEADER], destination);
  assertEquals(new Uint8Array(request.body), message);
  assertEquals(
    await readCesrRequestBytes(
      new Request("http://example.test", {
        method: "POST",
        headers: request.headers,
        body: request.body,
      }),
    ),
    message,
  );
});

/** Proves header mode emits one request-sized CESR message at a time. */
Deno.test("CESR HTTP - header mode splits a multi-message stream into KERIpy-style per-message requests", async () => {
  let reply!: Uint8Array;
  let query!: Uint8Array;
  let stream!: Uint8Array;

  await run(function*() {
    const hby = yield* createHabery({
      name: `cesr-stream-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      reply = hab.reply("/end/role/add", {
        cid: hab.pre,
        role: "mailbox",
        eid: hab.pre,
      });
      query = hab.query(hab.pre, hab.pre, { topics: { "/challenge": 0 } }, "mbx");
      stream = new Uint8Array(reply.length + query.length);
      stream.set(reply, 0);
      stream.set(query, reply.length);
    } finally {
      yield* hby.close(true);
    }
  });

  const parts = splitCesrStream(stream);
  assertEquals(parts, [reply, query]);
});

/** Proves `/fwd` traffic carrying replay bytes is kept as one CESR request. */
Deno.test("CESR HTTP - header mode does not split a forwarded exn across embedded replay bytes", async () => {
  let forwarded!: Uint8Array;

  await run(function*() {
    const hby = yield* createHabery({
      name: `cesr-forwarded-replay-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const replay = [...hby.db.clonePreIter(hab.pre)];
      const { serder, attachments } = makeEmbeddedExchangeMessage(
        "/fwd",
        {},
        {
          sender: hab.pre,
          modifiers: { pre: hab.pre, topic: "/replay" },
          embeds: { evt: concatBytes(...replay) },
        },
      );
      forwarded = concatBytes(
        hab.endorse(serder, { pipelined: false }),
        attachments,
      );
    } finally {
      yield* hby.close(true);
    }
  });

  assertEquals(splitCesrStream(forwarded), [forwarded]);
});

/** Proves raw CESR stream helpers keep multi-message mailbox admin bodies intact. */
Deno.test("CESR HTTP - stream request helper preserves a raw multi-message CESR body", async () => {
  let stream!: Uint8Array;
  let request!: ReturnType<typeof buildCesrStreamRequest>;

  await run(function*() {
    const hby = yield* createHabery({
      name: `cesr-stream-body-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const replay = [...hby.db.clonePreIter(hab.pre)];
      const rpy = hab.makeEndRole(hab.pre, "mailbox", true);
      stream = new Uint8Array(replay.reduce((sum, part) => sum + part.length, rpy.length));
      let offset = 0;
      for (const part of replay) {
        stream.set(part, offset);
        offset += part.length;
      }
      stream.set(rpy, offset);
      request = buildCesrStreamRequest(stream);
    } finally {
      yield* hby.close(true);
    }
  });

  assertEquals(request.headers[CESR_ATTACHMENT_HEADER], undefined);
  assertEquals(new Uint8Array(request.body), stream);
});

/** Proves mailbox admin can inspect the terminal reply in a multi-message stream. */
Deno.test("CESR HTTP - terminal message inspection returns the final message in a stream", async () => {
  let reply!: Uint8Array;
  let query!: Uint8Array;
  let stream!: Uint8Array;

  await run(function*() {
    const hby = yield* createHabery({
      name: `cesr-terminal-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });

    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      reply = hab.reply("/loc/scheme", {
        eid: hab.pre,
        scheme: "http",
        url: "http://127.0.0.1:7777",
      });
      query = hab.makeEndRole(hab.pre, "mailbox", true);
      stream = new Uint8Array(reply.length + query.length);
      stream.set(reply, 0);
      stream.set(query, reply.length);
    } finally {
      yield* hby.close(true);
    }
  });

  const serder = inspectCesrTerminalMessage(stream);
  assertExists(serder);
  assertEquals(serder?.route, "/end/role/add");
  assertEquals(
    (serder.ked?.a as Record<string, unknown> | undefined)?.role,
    "mailbox",
  );
});

/** Proves CESR content type matching ignores charset noise but rejects other types. */
Deno.test("CESR HTTP - content type matching accepts both Tufa and KERIpy CESR media types", () => {
  assertEquals(isCesrContentType("application/cesr"), true);
  assertEquals(isCesrContentType("application/cesr; charset=utf-8"), true);
  assertEquals(isCesrContentType("application/cesr+json"), true);
  assertEquals(
    isCesrContentType("application/cesr+json; charset=utf-8"),
    true,
  );
  assertEquals(isCesrContentType("text/plain"), false);
  assertEquals(isCesrContentType(null), false);
});

/** Proves direct signed-KERI ingress helpers reject non-CESR requests cleanly. */
Deno.test("CESR HTTP - required ingress helper only accepts CESR-framed requests", async () => {
  const plain = await readRequiredCesrRequestBytes(
    new Request("http://example.test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    }),
  );
  assertEquals(plain, null);

  const message = new Uint8Array([0x7b, 0x7d]);
  const request = buildCesrStreamRequest(message);
  const cesr = await readRequiredCesrRequestBytes(
    new Request("http://example.test", {
      method: "POST",
      headers: request.headers,
      body: request.body,
    }),
  );
  assertEquals(cesr, message);

  const keripyCesr = await readRequiredCesrRequestBytes(
    new Request("http://example.test", {
      method: "POST",
      headers: {
        ...request.headers,
        "Content-Type": "application/cesr+json",
      },
      body: request.body,
    }),
  );
  assertEquals(keripyCesr, message);
});
