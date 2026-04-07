/**
 * CESR-over-HTTP transport contract tests.
 *
 * These scenarios pin the mailbox and exchange framing behavior that must stay
 * aligned with KERIpy by default while still allowing Tufa's optional body
 * mode.
 */
import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  buildCesrRequest,
  CESR_ATTACHMENT_HEADER,
  CESR_DESTINATION_HEADER,
  readCesrRequestBytes,
  splitCesrStream,
} from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";

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

/** Proves the Tufa-only body mode keeps the full CESR payload in the body. */
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
