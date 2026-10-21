import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import type { Habery } from "../../../../src/app/identity/habbing.ts";
import { MailboxDirector } from "../../../../src/app/mailbox/mailbox-director.ts";
import type { StreamCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import type { Mailboxer } from "../../../../src/db/mailbox/mailboxing.ts";

Deno.test("mailbox director stops active stream polling before its store closes", async () => {
  let open = true;
  let polls = 0;
  const mailboxer = {
    *cloneTopicIter() {
      if (!open) {
        throw new Error("mailbox store polled after close");
      }
      polls += 1;
    },
  } as unknown as Mailboxer;
  const director = new MailboxDirector({} as Habery, { mailboxer });
  const stream = director.streamMailbox("aid", { "/challenge": 0 }, {
    emitRetryHeader: false,
    idleTimeoutMs: null,
    pollIntervalMs: 1,
  });
  const reader = stream.getReader();
  const finished = reader.read();

  await new Promise((resolve) => setTimeout(resolve, 5));
  await director.close();
  open = false;
  const pollsAtClose = polls;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(polls, pollsAtClose);
  assertEquals(await finished, { value: undefined, done: true });
  assertThrows(() => director.streamMailbox("aid", { "/challenge": 0 }), Error, "closed");
});

Deno.test("mailbox director closes a pending query response during runtime shutdown", async () => {
  const director = new MailboxDirector({} as Habery, {
    mailboxer: {} as Mailboxer,
  });
  const reader = director.streamQueryResponse("query-said", {
    pollIntervalMs: 1,
  }).getReader();

  assertEquals(new TextDecoder().decode((await reader.read()).value), "retry: 5000\n\n");
  const finished = reader.read();
  await director.close();

  assertEquals(await finished, { value: undefined, done: true });
});

Deno.test("mailbox SSE provider clones only the event requested by HTTP demand", async () => {
  let cloned = 0;
  let returned = 0;
  const mailboxer = {
    *cloneTopicIter(_topic: string, start: number) {
      try {
        for (let idx = start; idx < 1000; idx++) {
          cloned++;
          yield [idx, "", new TextEncoder().encode(`message-${idx}`)];
        }
      } finally {
        returned++;
      }
    },
  } as unknown as Mailboxer;
  const director = new MailboxDirector({} as Habery, { mailboxer });
  const reader = director.streamMailbox("aid", { "/reply": 0 }, { emitRetryHeader: false }).getReader();
  assertEquals(cloned, 0); // Creating an unread response cannot scan the mailbox.
  await reader.read(); // The header requires exactly one stored event.
  assertEquals([cloned, returned], [1, 1]);
  await reader.read(); // Payload and delimiter each wait for a separate consumer read.
  await reader.read();
  assertEquals(cloned, 1);
  await reader.read();
  assertEquals(cloned, 2);
  await reader.cancel();
  await director.close();
});

Deno.test("mailbox query owns its nested provider and validates exact cursor ordinals", async () => {
  let rows = 0;
  const mailboxer = {
    *cloneTopicIter(_topic: string, from: number) {
      rows++;
      yield [from, "", new Uint8Array(4 * 1024 ** 2 + 1)];
    },
  } as unknown as Mailboxer;
  const director = new MailboxDirector({} as Habery, { mailboxer });
  const reader = director.streamQueryResponse("query-said").getReader();
  await reader.read();
  assertEquals(rows, 0, "The retry header does not acquire mailbox rows");
  director.retainQueryCue({
    kin: "stream",
    src: "aid",
    serder: { said: "query-said" },
    pre: "aid",
    topics: { "/reply": 0 },
  } as unknown as StreamCue);
  await reader.read();
  assertEquals(rows, 1);
  await reader.cancel();
  assertEquals((await reader.read()).done, true);
  for (const idx of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(() => director.streamMailbox("aid", { "/reply": idx }), RangeError, "cursor");
  }
  assertEquals(rows, 1, "Invalid query cursors cannot read storage");
  await director.close();
});

Deno.test("mailbox correlation preserves preceding order through joined shutdown", async () => {
  const queryCues = new Deck<StreamCue>();
  const director = new MailboxDirector({} as Habery, {
    queryCues,
    mailboxer: { *cloneTopicIter() {} } as unknown as Mailboxer,
  });
  for (const said of ["before-1", "before-2", "selected", "selected", "after"]) {
    director.retainQueryCue({
      kin: "stream",
      src: "aid",
      serder: { said },
      pre: "aid",
      topics: { "/reply": 0 },
    } as unknown as StreamCue);
  }
  assertEquals(director.hasQueryCue("selected"), true);
  assertEquals(director.hasQueryCue("absent"), false);

  const reader = director.streamQueryResponse("selected", { pollIntervalMs: 1 }).getReader();
  await reader.read();
  const pending = reader.read();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assertEquals([...queryCues].map((cue) => (cue as StreamCue).serder.said), [
    "before-1",
    "before-2",
    "selected",
    "after",
  ]);

  await director.close();
  assertEquals(await pending, { value: undefined, done: true });
  assertEquals(queryCues.empty, true);

  await director.close();
  assertThrows(() => director.streamQueryResponse("selected"), Error, "closed");
});

Deno.test("mailbox correlation consumes only the selected cue on provider failure", async () => {
  const queryCues = new Deck<StreamCue>();
  const failure = new Error("provider storage failure");
  let opened = 0;
  const director = new MailboxDirector({} as Habery, {
    queryCues,
    mailboxer: {
      *cloneTopicIter() {
        opened++;
        throw failure;
      },
    } as unknown as Mailboxer,
  });
  for (const said of ["selected", "unmatched"]) {
    director.retainQueryCue({
      kin: "stream",
      src: "aid",
      serder: { said },
      pre: "aid",
      topics: { "/reply": 0 },
    } as unknown as StreamCue);
  }
  assertEquals(opened, 0);
  const reader = director.streamQueryResponse("selected").getReader();
  await reader.read();
  const caught = await assertRejects(() => reader.read());
  assertStrictEquals(caught, failure);
  assertEquals(opened, 1);
  assertEquals([...queryCues].map((cue) => cue.serder.said), ["unmatched"]);

  await director.close();
});
