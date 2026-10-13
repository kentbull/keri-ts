import { assertEquals } from "jsr:@std/assert";
import type { Habery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import type { Mailboxer } from "../../../src/db/mailboxing.ts";

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
  director.close();
  open = false;
  const pollsAtClose = polls;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(polls, pollsAtClose);
  assertEquals(await finished, { value: undefined, done: true });
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
  director.close();

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
  await reader.read(); // Payload and delimiter consume transport credit independently.
  await reader.read();
  assertEquals(cloned, 1);
  await reader.read();
  assertEquals(cloned, 2);
  await reader.cancel();
  director.close();
});
