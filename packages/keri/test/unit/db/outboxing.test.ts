import { b, ResourceLimitError } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createOutboxer } from "../../../src/db/outboxing.ts";

Deno.test("outbox publication and terminal pruning roll back complete message ownership", async () => {
  await run(function*() {
    const outbox = yield* createOutboxer({ name: `outbox-atomic-${crypto.randomUUID()}`, temp: true });
    const said = "logical-message", stamp = "2026-10-13T12:00:00.000000+00:00";
    const raw = b("signed payload");
    const record = { sender: "sender", recipient: "recipient", topic: "/reply", createdAt: stamp };
    try {
      outbox.queueMessage(said, raw, record, ["first", "second"]);
      const nativeRead = outbox.msgs.sdb.getBinary;
      let payloadCopies = 0;
      outbox.msgs.sdb.getBinary = (...args) => {
        payloadCopies++;
        return nativeRead.apply(outbox.msgs.sdb, args);
      };
      try {
        assertThrows(
          () => outbox.iterPendingBounded({ maxMessageBytes: raw.length - 1, maxMetadataBytes: 512 }).next(),
          ResourceLimitError,
        );
        assertEquals(payloadCopies, 0, "oversize refuses before native payload copy");
        assertThrows(
          () => outbox.iterPendingBounded({ maxMessageBytes: raw.length, maxMetadataBytes: 1 }).next(),
          ResourceLimitError,
        );
        assertEquals(payloadCopies, 0, "metadata refuses before payload acquisition");
        const entries = [...outbox.iterPendingBounded({ maxMessageBytes: raw.length, maxMetadataBytes: 512 })];
        assertEquals(entries.map((entry) => entry.target.eid), ["first", "second"]);
        assertEquals(entries.map((entry) => entry.raw), [raw, raw]);
      } finally {
        outbox.msgs.sdb.getBinary = nativeRead;
      }
      outbox.markFailed(said, "first", stamp, "retry");
      const pin = outbox.tgts.pin;
      const fault = new Error("outbox target publication failed");
      outbox.tgts.pin = function(keys, value) {
        if (Array.isArray(keys) && keys[1] === "fault") throw fault;
        return pin.call(this, keys, value);
      };
      try {
        assertEquals(
          assertThrows(() => outbox.queueMessage(said, b("replacement"), record, ["first", "fault"])),
          fault,
        );
      } finally {
        outbox.tgts.pin = pin;
      }
      assertEquals(outbox.getMessage(said), raw);
      assertEquals(outbox.getRecord(said)?.asDict(), record);
      assertEquals(outbox.getTarget(said, "first")?.attempts, 1);
      assertEquals(outbox.getTarget(said, "fault"), null);
      outbox.markDelivered(said, "first", stamp);
      const remove = outbox.items.rem;
      outbox.items.rem = () => {
        throw fault;
      };
      try {
        assertEquals(assertThrows(() => outbox.markDelivered(said, "second", stamp)), fault);
      } finally {
        outbox.items.rem = remove;
      }
      yield* outbox.close();
      yield* outbox.reopen({ reuse: true });
      assertEquals(outbox.getMessage(said), raw, "failed final pruning cannot orphan retry state");
      assertEquals(outbox.getRecord(said)?.asDict(), record);
      assertEquals(outbox.getTarget(said, "first")?.status, "delivered");
      assertEquals(outbox.getTarget(said, "second")?.status, "pending");
      assertEquals(outbox.pendingCount(), 1);
      assertEquals(
        [...outbox.iterPendingBounded({ maxMessageBytes: raw.length, maxMetadataBytes: 512 })].map((entry) =>
          entry.target.eid
        ),
        ["second"],
      );
      outbox.markDelivered(said, "second", stamp);
      assertEquals(outbox.getMessage(said), null);
      assertEquals(outbox.getRecord(said), null);
      assertEquals(outbox.getTarget(said, "first"), null);
      assertEquals(outbox.getTarget(said, "second"), null);
    } finally {
      yield* outbox.close(true);
    }
  });
});
