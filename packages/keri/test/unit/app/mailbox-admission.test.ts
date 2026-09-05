// @file-test-lane runtime-medium
import { call, run, scoped, sleep, spawn, suspend } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, processMailboxTurn } from "../../../src/app/agent-runtime.ts";
import { MailboxPoller } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import { Roles } from "../../../src/core/roles.ts";
import { MailboxAdmissionError } from "../../../src/db/mailbox-inbox.ts";
import {
  FakeMailboxPollTransport,
  fakeRuntimeServices,
  ManualRuntimeClock,
} from "../../support/runtime-service-fakes.ts";

Deno.test("remote mailbox bytes survive once sink loss and reopen before runtime acceptance", () =>
  testSinkLoss("once"));
Deno.test("remote mailbox bytes survive continuous sink loss and reopen before runtime acceptance", () =>
  testSinkLoss("continuous"));

async function testSinkLoss(mode: "once" | "continuous"): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "mailbox-admission-" });
  let pre = "", body: Uint8Array | undefined;
  const eid = "mailbox-replay", clock = new ManualRuntimeClock();
  const options = {
    name: "recipient",
    temp: false,
    headDirPath: directory,
    bran: "mailbox-admission-test-passcode",
    skipConfig: true,
    skipSignator: true,
  };
  try {
    await run(function*() {
      const hby = yield* createHabery(options);
      try {
        const hab = hby.makeHab("recipient");
        pre = hab.pre;
        hby.db.locs.pin([eid, "http"], { url: "http://mailbox.test/" });
        hby.db.ends.pin([pre, Roles.mailbox, eid], { allowed: true });
        body = hab.makeEndRole(pre, Roles.mailbox, true);
        const runtime = yield* createAgentRuntime(hby, {
          mailboxAdmission: { mode: "durable" },
          services: fakeRuntimeServices({ clock }),
          mailboxPollTransport: new FakeMailboxPollTransport([{
            messages: [{ topic: "/reply", idx: 0, msg: body }],
            advanceMs: 1,
          }], clock),
        });
        try {
          if (mode === "once") {
            const batches = yield* runtime.mailboxPoller.processOnce();
            assertEquals(batches[0].messages[0], body);
          } else {
            let failed = false;
            try {
              yield* scoped(function*() {
                yield* runtime.mailboxPoller.pollDo((batch) => {
                  assertEquals(batch.messages[0], body);
                  throw new Error("sink failed before runtime acceptance");
                });
              });
            } catch {
              failed = true;
            }
            assertEquals(failed, true);
            const retry = yield* runtime.mailboxPoller.processOnce();
            assertEquals(retry.flatMap((batch) => batch.messages), [body], "failed sink permits same-poller retry");
          }
          assertEquals(hby.db.tops.get([pre, eid])?.topics["/reply"], 0);
          // Caller dies/abandons the returned batch before invoking the reactor.
          assertEquals(hby.db.ends.get([pre, Roles.mailbox, pre]), null);
        } finally {
          yield* runtime.close();
        }
      } finally {
        yield* hby.close();
      }
    });
    await run(function*() {
      const hby = yield* createHabery(options);
      const transport = new FakeMailboxPollTransport([], clock);
      try {
        const runtime = yield* createAgentRuntime(hby, {
          mailboxAdmission: { mode: "durable" },
          services: fakeRuntimeServices({ clock }),
          mailboxPollTransport: transport,
        });
        try {
          const batches = yield* processMailboxTurn(runtime);
          assertEquals(batches.flatMap((batch) => batch.messages), [body!]);
          assertEquals(hby.db.ends.get([pre, Roles.mailbox, pre])?.allowed, true);
          assertEquals(hby.db.mailboxInbox.retained().length, 1, "void parser return must not acknowledge ingress");
          assertEquals((yield* processMailboxTurn(runtime)).length, 0, "replay once per poller lifetime");
          hby.db.mailboxInbox.dispose(batches[0].deliveries![0], {
            kind: "acknowledged",
            reason: "reply stored and application disposition explicitly approved",
          });
          assertEquals(hby.db.mailboxInbox.retained().length, 0);
        } finally {
          yield* runtime.close();
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("mailbox admission rolls back inbox and tops together and rejects conflicts and quota overflow", async () => {
  const directory = await Deno.makeTempDir({ prefix: "mailbox-atomic-" });
  const options = { name: "atomic", temp: false, headDirPath: directory, skipConfig: true, skipSignator: true };
  const msg = new Uint8Array([1, 2, 3]);
  try {
    await run(function*() {
      const hby = yield* createHabery(options);
      try {
        const pin = hby.db.tops.pin.bind(hby.db.tops);
        hby.db.tops.pin = (...args) => {
          pin(...args);
          throw new Error("crash after tops write before transaction commit");
        };
        try {
          assertThrows(
            () => hby.db.mailboxInbox.admit("pre", "eid", [{ topic: "/reply", idx: 0, msg }]),
            Error,
            "crash after tops",
          );
        } finally {
          hby.db.tops.pin = pin;
        }
        assertEquals(hby.db.mailboxInbox.retained().length, 0);
        assertEquals(hby.db.tops.get(["pre", "eid"]), null);
      } finally {
        yield* hby.close();
      }
    });
    await run(function*() {
      const hby = yield* createHabery(options);
      try {
        const inbox = hby.db.mailboxInbox;
        assertEquals(inbox.retained().length, 0);
        assertEquals(hby.db.tops.get(["pre", "eid"]), null);
        const [delivery] = inbox.admit("pre", "eid", [{ topic: "/reply", idx: 0, msg }]);
        assertEquals(inbox.admit("pre", "eid", [{ topic: "/reply", idx: 0, msg }]), [delivery]);
        assertEquals(
          assertThrows(
            () => inbox.admit("pre", "eid", [{ topic: "/reply", idx: 0, msg: new Uint8Array([4]) }]),
            MailboxAdmissionError,
          ).kind,
          "conflict",
        );
        assertThrows(() => inbox.admit("pre", "eid", [{ topic: "/reply", idx: 2, msg }]), Error, "gap");
        const limits = {
          maxRecordBytes: 3,
          maxBatchBytes: 6,
          maxBatchRecords: 2,
          maxRetainedBytes: 6,
          maxRetainedRecords: 2,
        };
        assertThrows(
          () => inbox.admit("pre", "eid", [{ topic: "/reply", idx: 1, msg }, { topic: "/reply", idx: 2, msg }], limits),
          Error,
          "capacity",
        );
        assertEquals(inbox.retained().length, 1, "first record of overflowing batch also rolls back");
        assertEquals(hby.db.tops.get(["pre", "eid"])?.topics["/reply"], 0);
        assertThrows(
          () => inbox.dispose({ ...delivery, eid: "different-source" }, { kind: "acknowledged", reason: "invalid" }),
          Error,
          "identity",
        );
        inbox.dispose(delivery, { kind: "deadletter", reason: "malformed protocol payload retained for inspection" });
        assertEquals(inbox.pending(), []);
        assertEquals(inbox.retained()[0].state, "deadletter");
        assertThrows(
          () => inbox.admit("pre", "eid", [{ topic: "/reply", idx: 1, msg }], { ...limits, maxRetainedRecords: 1 }),
          Error,
          "capacity",
        );
        inbox.dispose(delivery, { kind: "acknowledged", reason: "operator exported rejected bytes" });
        assertThrows(() => inbox.admit("pre", "eid", [{ topic: "/reply", idx: 0, msg }]), Error, "disposed");
        inbox.admit("pre", "eid", [{ topic: "/reply", idx: 1, msg }, { topic: "/receipt", idx: 0, msg }], limits);
        assertEquals(hby.db.tops.get(["pre", "eid"])?.topics, { "/reply": 1, "/receipt": 0 });
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inbox source identities preserve arbitrary topics and all byte bounds fail closed", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    try {
      const inbox = hby.db.mailboxInbox;
      const limits = {
        maxRecordBytes: 3,
        maxBatchBytes: 4,
        maxBatchRecords: 2,
        maxRetainedBytes: 10,
        maxRetainedRecords: 4,
      };
      assertThrows(
        () => inbox.admit("pre", "eid", [{ topic: "/a.b", idx: 0, msg: new Uint8Array(4) }], limits),
        Error,
        "record byte",
      );
      assertThrows(
        () =>
          inbox.admit("pre", "eid", [{ topic: "/a", idx: 0, msg: new Uint8Array(3) }, {
            topic: "/b",
            idx: 0,
            msg: new Uint8Array(3),
          }], limits),
        Error,
        "batch byte",
      );
      assertThrows(
        () =>
          inbox.admit("pre", "eid", [{ topic: "/a", idx: Number.MAX_SAFE_INTEGER + 1, msg: new Uint8Array() }], limits),
        Error,
        "ordinal",
      );
      assertEquals(hby.db.tops.get(["pre", "eid"]), null);
      assertEquals(inbox.retained(), []);
      const a = inbox.admit("pre", "eid", [{ topic: "/a.b", idx: 0, msg: new Uint8Array([1]) }], limits)[0];
      const b = inbox.admit("pre", "eid", [{ topic: "/a", idx: 0, msg: new Uint8Array([2]) }], limits)[0];
      assertEquals(a.id === b.id, false);
      inbox.admit("pre", "eid", [{ topic: "__proto__", idx: 0, msg: new Uint8Array([3]) }], limits);
      const director = new MailboxDirector(hby);
      director.registerTopic("__proto__");
      const cursor = director.remoteQueryCursor("pre", "eid");
      assertEquals(Object.hasOwn(cursor, "__proto__"), true);
      assertEquals(cursor["__proto__"], 1);
      assertThrows(() => inbox.admit("pre.withdot", "eid", [], limits), Error, "source");
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("later endpoint throw leaves earlier admission available to the same poller", () =>
  testLaterEndpointFailure("throw"));
Deno.test("later endpoint cancel leaves earlier admission available to the same poller", () =>
  testLaterEndpointFailure("cancel"));

async function testLaterEndpointFailure(failure: "throw" | "cancel"): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    try {
      const hab = hby.makeHab("recipient");
      for (const eid of ["first", "second"]) {
        hby.db.locs.pin([eid, "http"], { url: `http://${eid}.test/` });
        hby.db.ends.pin([hab.pre, Roles.mailbox, eid], { allowed: true });
      }
      let calls = 0;
      let reached!: () => void;
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const bytes = new Uint8Array([1, 2, 3]);
      const poller = new MailboxPoller(hby, new MailboxDirector(hby), {
        mailboxAdmission: { mode: "durable" },
        pollTransport: {
          *poll() {
            calls++;
            if (calls === 1) return [{ topic: "/reply", idx: 0, msg: bytes }];
            if (calls === 2) {
              reached();
              if (failure === "throw") throw new Error("later endpoint failed");
              yield* suspend();
            }
            return [];
          },
        },
      });
      poller.registerTopic("/reply");
      if (failure === "throw") {
        let failed = false;
        try {
          yield* scoped(() => poller.processOnce());
        } catch {
          failed = true;
        }
        assertEquals(failed, true);
      } else {
        const task = yield* spawn(() => poller.processOnce());
        yield* call(() => paused);
        yield* task.halt();
      }
      const retry = yield* poller.processOnce();
      assertEquals(retry.flatMap((batch) => batch.messages), [bytes]);
      assertEquals((yield* poller.processOnce()).length, 0);
    } finally {
      yield* hby.close();
    }
  });
}

Deno.test("durable capacity resumes only after protected export and explicit disposition; default remains legacy", async () => {
  const directory = await Deno.makeTempDir({ prefix: "mailbox-export-" });
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
      const clock = new ManualRuntimeClock();
      try {
        // lmdb implements create:false although DatabaseOptions omits it.
        const noCreate = { create: false, encoding: "binary" as const };
        assertEquals(hby.db.env!.openDB("mbin.", noCreate), undefined);
        const hab = hby.makeHab("recipient"), eid = "bounded-provider";
        hby.db.locs.pin([eid, "http"], { url: "http://bounded.test/" });
        hby.db.ends.pin([hab.pre, Roles.mailbox, eid], { allowed: true });
        const body = hab.makeEndRole(hab.pre, Roles.mailbox, true);
        const transport = new FakeMailboxPollTransport([], clock);
        const runtime = yield* createAgentRuntime(hby, {
          mailboxAdmission: { mode: "durable", limits: { maxRetainedRecords: 1 } },
          services: fakeRuntimeServices({ clock }),
          mailboxPollTransport: transport,
        });
        try {
          transport.enqueue({ messages: [{ topic: "/reply", idx: 0, msg: body }] });
          const first = yield* processMailboxTurn(runtime);
          transport.enqueue({ messages: [{ topic: "/reply", idx: 1, msg: body }] });
          let pressure = false;
          try {
            yield* scoped(() => processMailboxTurn(runtime));
          } catch (error) {
            pressure = error instanceof MailboxAdmissionError && error.kind === "capacity";
          }
          assertEquals(pressure, true);
          assertEquals(hby.db.tops.get([hab.pre, eid])?.topics["/reply"], 0);
          const delivery = first[0].deliveries![0], path = directory + "/retained.cesr";
          yield* call(async () => {
            const file = await Deno.open(path, { createNew: true, write: true, mode: 0o600 });
            try {
              let offset = 0;
              while (offset < body.length) offset += await file.write(body.subarray(offset));
              await file.sync();
            } finally {
              file.close();
            }
            const parent = await Deno.open(directory, { read: true });
            try {
              await parent.sync();
            } finally {
              parent.close();
            }
            assertEquals(await Deno.readFile(path), body);
            assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
          });
          hby.db.mailboxInbox.dispose(delivery, {
            kind: "acknowledged",
            reason: "exact bytes durably exported to protected consumer recovery artifact",
          });
          transport.enqueue({ messages: [{ topic: "/reply", idx: 1, msg: body }] });
          const resumed = yield* processMailboxTurn(runtime);
          assertEquals(resumed[0].deliveries![0].idx, 1);
          assertEquals(hby.db.tops.get([hab.pre, eid])?.topics["/reply"], 1);
          hby.db.mailboxInbox.dispose(resumed[0].deliveries![0], {
            kind: "acknowledged",
            reason: "reply durable and acknowledged by managed consumer",
          });
        } finally {
          yield* runtime.close();
        }
        const legacy = yield* createAgentRuntime(hby, {
          services: fakeRuntimeServices({ clock }),
          mailboxPollTransport: new FakeMailboxPollTransport(
            [{ messages: [{ topic: "/reply", idx: 2, msg: body }] }],
            clock,
          ),
        });
        try {
          const batch = yield* legacy.mailboxPoller.processOnce();
          assertEquals(batch[0].deliveries, undefined);
          assertEquals(hby.db.tops.get([hab.pre, eid])?.topics["/reply"], 2);
          assertEquals(hby.db.mailboxInbox.retained(), [], "legacy default does not impose a new acknowledgment quota");
        } finally {
          yield* legacy.close();
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("unknown inbox versions and malformed retained sizes fail closed without moving cursor", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    try {
      const inbox = hby.db.mailboxInbox, msg = new Uint8Array([1, 2, 3]);
      const [delivery] = inbox.admit("pre", "eid", [{ topic: "/reply", idx: 0, msg }]);
      const good = inbox.retained()[0];
      const raw = hby.db.env!.openDB("mbin.", { encoding: "binary", keyEncoding: "binary" });
      const key = new TextEncoder().encode(delivery.id);
      for (
        const corrupt of [{ ...good, version: 2 }, { ...good, size: null }, { ...good, size: -1 }, {
          ...good,
          payload: "AQIE",
        }]
      ) {
        raw.putSync(key, new TextEncoder().encode(JSON.stringify(corrupt)));
        assertThrows(() => inbox.pending(), Error);
        assertThrows(() => inbox.retained(), Error);
        if (corrupt.payload === good.payload) {
          assertThrows(() => inbox.admit("pre", "eid", [{ topic: "/reply", idx: 1, msg }]), Error);
        }
        assertEquals(hby.db.tops.get(["pre", "eid"])?.topics["/reply"], 0);
      }
      raw.putSync(key, new TextEncoder().encode(JSON.stringify(good)));
      inbox.admit("pre", "eid", [{ topic: "/reply", idx: 1, msg }]);
      assertEquals(inbox.retained().length, 2);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("retained replay waits for topic subscription in finite and continuous polling", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    try {
      const msg = new Uint8Array([1, 2, 3]);
      hby.db.mailboxInbox.admit("pre", "eid", [{ topic: "/later", idx: 0, msg }]);
      const poller = new MailboxPoller(hby, new MailboxDirector(hby), { mailboxAdmission: { mode: "durable" } });
      const received: Uint8Array[] = [];
      const task = yield* spawn(() => poller.pollDo((batch) => received.push(...batch.messages)));
      yield* sleep(10);
      yield* task.halt();
      assertEquals(received, [], "continuous zero-topic poll must not dispatch retained bytes");
      poller.registerTopic("/other");
      assertEquals(yield* poller.processOnce(), []);
      assertEquals(hby.db.mailboxInbox.retained().length, 1);
      poller.registerTopic("/later");
      assertEquals((yield* poller.processOnce()).flatMap((batch) => batch.messages), [msg]);
      assertEquals(yield* poller.processOnce(), []);
    } finally {
      yield* hby.close();
    }
  });
});
