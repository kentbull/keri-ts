import { ResourcePolicy } from "cesr-ts";
import { action, call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { RegBaser } from "../../../src/acdc/regbasing.ts";
import { openRegistry } from "../../../src/acdc/registering.ts";
import { createRegery as createAcdcRegery, Regery as AcdcRegery } from "../../../src/acdc/registraring.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
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
      assertEquals(runtime.reactor.resources, runtime.resources);
      assertEquals(runtime.services.resources, runtime.resources);
      assertEquals(runtime.delegating.services, runtime.services);
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
  const hby = await run(() => createHabery(habitatOptions));
  const rgy = await run(() => createAcdcRegery({ hby, name: "borrowed", temp: true }));
  const registry = rgy.baser;
  const reger = await run(() => createReger({ name: "borrowed", temp: true }));
  try {
    await run(function*() {
      const resources = new ResourcePolicy({ streams: 3 });
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

Deno.test("runtime stores - failed reply cleanup still joins owned database close", async () => {
  await run(function*() {
    const hby = yield* createHabery(habitatOptions);
    try {
      const runtime = yield* createAgentRuntime(hby);
      const reader = runtime.replyStreams.open({
        *[Symbol.iterator]() {
          try {
            yield Uint8Array.of(1);
          } finally {
            // deno-lint-ignore no-unsafe-finally -- database owners must close even when replay cleanup fails.
            throw new Error("reply storage close failed");
          }
        },
      }).getReader();
      yield* call(() => reader.read());
      try {
        yield* runtime.close();
        throw new Error("Expected reply shutdown failure");
      } catch (error) {
        assertEquals(error instanceof AggregateError, true);
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

Deno.test("runtime stores - cancelling a live runtime closes scope-owned stores", async () => {
  const hby = await run(() => createHabery(habitatOptions));
  let registry!: RegBaser;
  let reger!: Reger;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => entered = resolve);
  const task = run(function*() {
    const runtime = yield* createAgentRuntime(hby);
    registry = runtime.acdc.rgy!.baser;
    reger = runtime.vdr.reger as Reger;
    entered();
    yield* action<void>(() => () => {});
  });
  try {
    await ready;
    await task.halt();
    assertReleased(registry);
    assertReleased(reger);
    assertEquals(hby.db.opened, true);
  } finally {
    await task.halt();
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
