import { ResourcePolicy } from "cesr-ts";
import { action, call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { openRegistry } from "../../../src/acdc/registering.ts";
import { createRegery as createAcdcRegery, Regery as AcdcRegery } from "../../../src/acdc/registraring.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { MailboxAdmissionError } from "../../../src/db/mailbox-inbox.ts";
import { createReger, Reger } from "../../../src/db/reger.ts";

const habitatOptions = { name: "runtime-ownership", temp: true, skipConfig: true, skipSignator: true };

/** Assert native close has joined before a temporary owner is released. */
function assertReleased(store: RegBaser | Reger): void {
  assertEquals(store.opened, false);
  assertEquals(store.env, null);
  assertThrows(() => Deno.statSync(store.path!), Deno.errors.NotFound);
}

Deno.test("runtime stores - default owners close explicitly and scope exit is harmless", async () => {
  let registry!: RegBaser;
  let reger!: Reger;
  await run(function*() {
    const hby = yield* createHabery(habitatOptions);
    try {
      const runtime = yield* createAgentRuntime(hby);
      assertEquals(runtime.resources, hby.db.resources);
      assertEquals(runtime.reactor.resources, runtime.resources);
      assertEquals(runtime.services.resources, runtime.resources);
      assertEquals(runtime.delegating.services, runtime.services);
      assertEquals(runtime.reactor.exchanger.resources, runtime.resources);
      assertEquals(runtime.resources.limits.streams, 2);
      registry = runtime.acdc.rgy!.baser;
      reger = runtime.vdr.reger as Reger;
      assertEquals(registry.opened, true);
      assertEquals(reger.opened, true);
      assertEquals(registry.path === reger.path, false, "v1 and v2 use separate environments");
      const issuer = hby.makeHab("issuer");
      const local = runtime.acdc.rgy!.makeRegistry("local", issuer.pre);
      assertEquals(local.sn, -1n);
      issuer.interact({ data: [{ i: local.regk!, s: "0", d: local.regk! }] });
      yield* runtime.reactor.processEscrowsOnce();
      assertEquals(local.sn, 0n, "runtime advances the real v2 registry manager");
      yield* runtime.close();
      assertReleased(registry);
      assertReleased(reger);
      assertEquals(hby.db.opened, true, "runtime borrows its Habery");
    } finally {
      yield* hby.close(true);
    }
  });
  assertReleased(registry);
  assertReleased(reger);
});

Deno.test("runtime stores - injected stores survive explicit close and scope exit", async () => {
  const resources = new ResourcePolicy({ streams: 3 });
  const hby = await run(() => createHabery({ ...habitatOptions, resources }));
  const rgy = await run(() => createAcdcRegery({ hby, name: "borrowed", temp: true }));
  const registry = rgy.baser;
  const reger = await run(() => createReger({ name: "borrowed", temp: true }));
  try {
    await run(function*() {
      const runtime = yield* createAgentRuntime(hby, { acdc: { rgy }, vdr: { reger }, resources });
      assertEquals(runtime.resources, resources);
      assertEquals(runtime.services.resources, resources);
      assertEquals(runtime.reactor.resources, resources);
      assertEquals(runtime.acdc.rgy, rgy);
      assertEquals(runtime.reactor.acdc.rgy, rgy);
      assertEquals(runtime.vdr.reger, reger);
      yield* runtime.close();
      assertEquals(registry.opened, true);
      assertEquals(reger.opened, true);
    });
    assertExists(registry.env);
    assertExists(reger.env);
  } finally {
    await run(function*() {
      yield* rgy.close();
      yield* reger.close(true);
      yield* hby.close(true);
    });
  }
});

Deno.test("runtime stores - policy is fixed before opening and survives borrowed runtime close", async () => {
  const resources = new ResourcePolicy();
  const hby = await run(() => createHabery({ ...habitatOptions, resources }));
  const other = new ResourcePolicy();
  try {
    for (
      const options of [{ resources: other }, { services: { resources: other } }, {
        resources,
        services: { resources: other },
      }]
    ) {
      await assertRejects(() => run(() => createAgentRuntime(hby, options)), RangeError, "Baser resource policy");
    }
    await assertRejects(() => run(() => hby.db.reopen({ resources: other })), RangeError, "original resource policy");
    assertEquals(hby.db.opened, true);
    assertEquals(hby.db.resources, resources);
    const held = resources.reserve({ bytes: 1 });
    if (held.kind !== "reserve") throw new Error("Expected policy admission");
    try {
      await run(function*() {
        const runtime = yield* createAgentRuntime(hby, { services: { resources } });
        yield* runtime.close();
        assertEquals(resources.used.bytes, 1, "runtime cannot release another owner's credit");
        hby.makeHab("after-runtime-close");
      });
    } finally {
      held.reservation.release();
    }
    await run(() => hby.db.close());
    await run(() => hby.db.reopen({ resources }));
    assertEquals(hby.db.resources, resources);
    assertEquals(hby.db.prefixes.has(hby.habByName("after-runtime-close")!.pre), true);
  } finally {
    await run(() => hby.close(true));
  }
});

Deno.test("runtime stores - failed reply cleanup still joins owned database close", async () => {
  for (const failure of [undefined, new Error("reply storage close failed")]) {
    await run(function*() {
      const hby = yield* createHabery(habitatOptions);
      try {
        const runtime = yield* createAgentRuntime(hby);
        const reader = runtime.replyStreams.open({
          *[Symbol.iterator]() {
            try {
              yield Uint8Array.of(1);
            } finally {
              assertEquals(runtime.acdc.rgy!.baser.opened, true);
              assertEquals((runtime.vdr.reger as Reger).opened, true);
              // deno-lint-ignore no-unsafe-finally -- database owners close even when replay cleanup fails.
              throw failure;
            }
          },
        }).getReader();
        yield* call(() => reader.read());
        try {
          yield* runtime.close();
          throw new Error("Expected reply shutdown failure");
        } catch (error) {
          assertEquals(error instanceof AggregateError, true);
          assertStrictEquals((error as AggregateError).errors[0].errors[1], failure);
        }
        assertReleased(runtime.acdc.rgy!.baser);
        assertReleased(runtime.vdr.reger as Reger);
        assertEquals(runtime.resources.used.bytes, 0);
        yield* call(() => assertRejects(() => reader.read(), AggregateError));
        reader.releaseLock();
        yield* runtime.close();
      } finally {
        yield* hby.close(true);
      }
    });
  }
});

Deno.test("runtime stores - readonly Habery acquires no default store", async () => {
  const headDirPath = Deno.makeTempDirSync({ prefix: "readonly-runtime-" });
  const options = { ...habitatOptions, temp: false, headDirPath };
  try {
    await run(function*() {
      const hby = yield* createHabery(options);
      yield* hby.close();
      const readonly = yield* createHabery({ ...options, readonly: true });
      try {
        const runtime = yield* createAgentRuntime(readonly);
        assertEquals(runtime.acdc.rgy, undefined);
        assertEquals(runtime.vdr.reger, undefined);
        yield* runtime.close();
        assertEquals(readonly.db.opened, true);
        assertThrows(() => Deno.statSync(`${headDirPath}/keri/acdc/reg`), Deno.errors.NotFound);
      } finally {
        yield* readonly.close();
      }
    });
  } finally {
    Deno.removeSync(headDirPath, { recursive: true });
  }
});

Deno.test("runtime stores - construction failure releases acquired default stores", async () => {
  const registryReopen = RegBaser.prototype.reopen;
  const regerReopen = Reger.prototype.reopen;
  let registry!: RegBaser;
  let reger!: Reger;
  RegBaser.prototype.reopen = function*(options) {
    const opened = yield* registryReopen.call(this, options);
    registry = this;
    return opened;
  };
  Reger.prototype.reopen = function*(options) {
    const opened = yield* regerReopen.call(this, options);
    reger = this;
    return opened;
  };
  const hby = await run(() => createHabery(habitatOptions));
  try {
    await assertRejects(() =>
      run(() =>
        createAgentRuntime(hby, {
          mailboxAdmission: { mode: "durable", limits: { maxRecordBytes: 0 } },
        })
      ), MailboxAdmissionError);
    assertReleased(registry);
    assertReleased(reger);
    assertEquals(hby.db.opened, true);
  } finally {
    RegBaser.prototype.reopen = registryReopen;
    Reger.prototype.reopen = regerReopen;
    await run(() => hby.close(true));
  }
});

Deno.test("runtime stores - manager construction failure joins its acquired store cleanup", async () => {
  const original = AcdcRegery.prototype.loadRegistries;
  const failure = new Error("registry alias loading failed");
  let registry!: RegBaser;
  AcdcRegery.prototype.loadRegistries = function() {
    registry = this.baser;
    throw failure;
  };
  const hby = await run(() => createHabery(habitatOptions));
  try {
    const rejected = await assertRejects(() => run(() => createAgentRuntime(hby)));
    assertEquals(rejected, failure, "construction failure must propagate unchanged");
    assertReleased(registry);
    assertEquals(hby.db.opened, true);
  } finally {
    AcdcRegery.prototype.loadRegistries = original;
    await run(() => hby.close(true));
  }
});

Deno.test("runtime stores - cancellation during acquisition joins unreturned store cleanup", async () => {
  const original = RegBaser.prototype.reopen;
  let registry!: RegBaser;
  let entered!: () => void;
  const opened = new Promise<void>((resolve) => entered = resolve);
  RegBaser.prototype.reopen = function*(options) {
    const result = yield* original.call(this, options);
    registry = this;
    entered();
    yield* action<void>(() => () => {});
    return result;
  };
  const hby = await run(() => createHabery(habitatOptions));
  const task = run(() => createAgentRuntime(hby));
  try {
    await opened;
    assertEquals(registry.opened, true);
    await task.halt();
    assertReleased(registry);
    assertEquals(hby.db.opened, true);
  } finally {
    RegBaser.prototype.reopen = original;
    await task.halt();
    await run(() => hby.close(true));
  }
});

Deno.test("runtime stores - cancelling a live runtime joins output before scope-owned stores", async () => {
  const hby = await run(() =>
    createHabery({
      ...habitatOptions,
      name: crypto.randomUUID(),
      skipSignator: false,
      resources: new ResourcePolicy({ streams: 3 }),
    })
  );
  const ready = Promise.withResolvers<void>(), reading = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let runtime!: AgentRuntime;
  let replyClosed = false;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      reading.resolve();
    },
    async cancel() {
      cleanup.resolve();
      await release.promise;
    },
  }, { highWaterMark: 0 });
  const task = run(function*() {
    runtime = yield* createAgentRuntime(hby, {
      services: { http: { fetch: () => Promise.resolve(new Response(body)) } },
    });
    const reader = runtime.replyStreams.open({
      *[Symbol.iterator]() {
        try {
          yield Uint8Array.of(1);
        } finally {
          assertEquals(runtime.acdc.rgy!.baser.opened, true);
          assertEquals((runtime.vdr.reger as Reger).opened, true);
          replyClosed = true;
        }
      },
    }).getReader();
    yield* call(() => reader.read());
    reader.releaseLock();
    const hab = hby.makeHab("sender");
    runtime.deliveries.enqueue(() => ({
      url: "https://query.test/",
      body: hab.query(hab.pre, hab.pre, {}, "logs"),
      bodyMode: "header",
      destination: hab.pre,
    }));
    ready.resolve();
    yield* action<void>(() => () => {});
  });
  await Promise.race([
    ready.promise,
    task.then(() => {
      throw new Error("Owner ended before output setup");
    }),
  ]);
  // An independently running borrower makes the queue's own abort/join seam observable on scope exit.
  const delivery = run(() => runtime.deliveries.process(runtime));
  const result = delivery.catch((error) => error);
  try {
    await Promise.race([
      reading.promise,
      result.then((error) => {
        throw error;
      }),
    ]);
    const closing = Promise.resolve(task.halt());
    await cleanup.promise;
    assertEquals(runtime.acdc.rgy!.baser.opened, true);
    assertEquals((runtime.vdr.reger as Reger).opened, true);
    assertEquals(runtime.resources.used.bytes > 0, true);
    assertEquals(replyClosed, false);
    release.resolve();
    await closing;
    assertEquals((await result) instanceof DOMException, true);
    assertEquals(replyClosed, true);
    assertReleased(runtime.acdc.rgy!.baser);
    assertReleased(runtime.vdr.reger as Reger);
    assertEquals(runtime.resources.used.bytes, 0);
    assertEquals(hby.db.opened, true);
  } finally {
    release.resolve();
    await task.halt();
    await result;
    await run(() => hby.close(true));
  }
});

Deno.test("runtime stores - mailbox cleanup joins before stores and failure still closes every owner", async () => {
  const hby = await run(() => createHabery(habitatOptions));
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const failure = new Error("mailbox cleanup failed");
  try {
    await run(function*() {
      const runtime = yield* createAgentRuntime(hby, { mode: "indirect" });
      const original = runtime.mailboxDirector.close.bind(runtime.mailboxDirector);
      runtime.mailboxDirector.close = async () => {
        await original();
        entered.resolve();
        await release.promise;
        throw failure;
      };
      try {
        yield* call(async () => {
          const closing = run(() => runtime.close());
          await entered.promise;
          assertEquals(runtime.mailboxer!.opened, true);
          assertEquals(runtime.acdc.rgy!.baser.opened, true);
          release.resolve();
          assertEquals(await assertRejects(() => closing), failure);
        });
        assertEquals(runtime.mailboxer!.opened, false);
        assertReleased(runtime.acdc.rgy!.baser);
        assertReleased(runtime.vdr.reger as Reger);
        assertEquals(hby.db.opened, true);
      } finally {
        release.resolve();
        runtime.mailboxDirector.close = original;
      }
    });
  } finally {
    await run(() => hby.close(true));
  }
});

Deno.test("registry opener - failed and cancelled acquisition joins backing-store cleanup", async () => {
  const original = RegBaser.prototype.reopen;
  const failure = new Error("registry open failed after acquisition");
  let baser!: RegBaser;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => entered = resolve);
  try {
    RegBaser.prototype.reopen = function*(options) {
      yield* original.call(this, options);
      baser = this;
      throw failure;
    };
    assertEquals(await assertRejects(() => run(() => openRegistry({ temp: true }))), failure);
    assertReleased(baser);
    RegBaser.prototype.reopen = function*(options) {
      const opened = yield* original.call(this, options);
      baser = this;
      entered();
      yield* action<void>(() => () => {});
      return opened;
    };
    const task = run(() => openRegistry({ temp: true }));
    try {
      await ready;
      await task.halt();
      assertReleased(baser);
    } finally {
      await task.halt();
    }
  } finally {
    RegBaser.prototype.reopen = original;
  }
  const closed = await run(() => openRegistry({ reopen: false, temp: true }));
  assertEquals(closed.opened, false);
  await run(() => closed.close(true));
  await assertRejects(() => run(() => openRegistry({ web: true })), Error, "web registry backend");
});
