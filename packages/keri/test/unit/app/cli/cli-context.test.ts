import { parseBytes, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createHabery, type Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import type { AgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import {
  type CommandContextDependencies,
  withAgentRuntime,
  withExistingHab,
  withExistingHabery,
  withHabAndAgentRuntime,
} from "../../../../src/cli/common/context.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { query } from "../../../../src/core/protocol-eventing.ts";

function fakeHabery(events: string[], hab?: Hab): Habery {
  return {
    habByName: (alias: string) => alias === "alice" ? hab : undefined,
    *close(): Operation<void> {
      events.push("hby.close");
    },
  } as unknown as Habery;
}

function fakeRuntime(events: string[]): AgentRuntime {
  return {
    *close(): Operation<void> {
      events.push("runtime.close");
    },
  } as unknown as AgentRuntime;
}

function fakeHab(): Hab {
  return { pre: "Ealice" } as unknown as Hab;
}

function fakeDependencies(events: string[], hby: Habery, runtime?: AgentRuntime): CommandContextDependencies {
  return {
    setupHby: function*(name: string): Operation<Habery> {
      events.push(`setup:${name}`);
      return hby;
    },
    createAgentRuntime: function*(_hby: Habery): Operation<AgentRuntime> {
      events.push("runtime");
      return runtime ?? fakeRuntime(events);
    },
  };
}

Deno.test("cli context - withExistingHabery closes hby after successful callback", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events);

  const result = await run(() =>
    withExistingHabery(
      { name: "store" },
      {
        dependencies: fakeDependencies(events, hby),
      },
      function*({ hby: opened }) {
        events.push(opened === hby ? "use:hby" : "use:other");
        return "done";
      },
    )
  );

  assertEquals(result, "done");
  assertEquals(events, ["setup:store", "use:hby", "hby.close"]);
});

Deno.test("cli context - withExistingHabery closes hby when callback throws", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events);

  await assertRejects(
    () =>
      run(() =>
        withExistingHabery(
          { name: "store" },
          { dependencies: fakeDependencies(events, hby) },
          function*() {
            events.push("use");
            throw new Error("boom");
          },
        )
      ),
    Error,
    "boom",
  );

  assertEquals(events, ["setup:store", "use", "hby.close"]);
});

Deno.test("cli context - withExistingHab passes selected hab and closes hby", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events, fakeHab());

  const result = await run(() =>
    withExistingHab(
      { name: "store" },
      "alice",
      { dependencies: fakeDependencies(events, hby) },
      function*({ hab }) {
        events.push(`use:${hab.pre}`);
        return hab.pre;
      },
    )
  );

  assertEquals(result, "Ealice");
  assertEquals(events, ["setup:store", "use:Ealice", "hby.close"]);
});

Deno.test("cli context - withExistingHab closes hby when callback throws", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events, fakeHab());

  await assertRejects(
    () =>
      run(() =>
        withExistingHab(
          { name: "store" },
          "alice",
          { dependencies: fakeDependencies(events, hby) },
          function*({ hab }) {
            events.push(`use:${hab.pre}`);
            throw new Error("hab failed");
          },
        )
      ),
    Error,
    "hab failed",
  );

  assertEquals(events, ["setup:store", "use:Ealice", "hby.close"]);
});

Deno.test("cli context - withExistingHab rejects missing alias before opening resources", async () => {
  const events: string[] = [];

  await assertRejects(
    () =>
      run(() =>
        withExistingHab(
          { name: "store" },
          undefined,
          { dependencies: fakeDependencies(events, fakeHabery(events)) },
          function*() {
            events.push("use");
          },
        )
      ),
    ValidationError,
    "Alias is required and cannot be empty",
  );

  assertEquals(events, []);
});

Deno.test("cli context - withExistingHab rejects invalid alias and closes hby", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events);

  await assertRejects(
    () =>
      run(() =>
        withExistingHab(
          { name: "store" },
          "missing",
          { dependencies: fakeDependencies(events, hby) },
          function*() {
            events.push("use");
          },
        )
      ),
    ValidationError,
    "Alias missing is invalid",
  );

  assertEquals(events, ["setup:store", "hby.close"]);
});

Deno.test("cli context - withAgentRuntime closes runtime before hby", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events);
  const runtime = fakeRuntime(events);

  await run(() =>
    withAgentRuntime(
      { name: "store" },
      { dependencies: fakeDependencies(events, hby, runtime) },
      function*({ hby: openedHby, runtime: openedRuntime }) {
        events.push(openedHby === hby && openedRuntime === runtime ? "use:runtime" : "use:other");
      },
    )
  );

  assertEquals(events, ["setup:store", "runtime", "use:runtime", "runtime.close", "hby.close"]);
});

Deno.test("cli context - runtime uses only loaded per-store KRAM config", async () => {
  const kram = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } };
  for (const mode of ["configured", "absent", "skipped"]) {
    const headDirPath = await Deno.makeTempDir({ prefix: "cli-kram-" });
    const name = `store-${mode}`;
    try {
      await run(function*() {
        const hby = yield* createHabery({ name, headDirPath });
        try {
          hby.makeHab("alice");
          hby.cf!.put(mode === "absent" ? {} : { kram });
        } finally {
          yield* hby.close();
        }
        yield* withAgentRuntime(
          { name, headDirPath },
          { skipConfig: mode === "skipped" },
          function*({ hby, runtime }) {
            const configured = mode === "configured";
            assertEquals(!!runtime.reactor.kvy.kramer, configured);
            assertStrictEquals(runtime.reactor.kvy.db, hby.db);
            const hab = hby.habByName("alice")!;
            const body = query("ksn", { i: hab.pre, src: hab.pre }, { pre: hab.pre, pvrsn: Vrsn_2_0 });
            const [frame] = yield* call(() => parseBytes(hab.endorse(body, { gvrsn: Vrsn_2_0 })));
            const before = Date.now();
            const result = runtime.reactor.kvy.kramer?.intake(envelopeFromFrame(frame));
            assertEquals(result?.kind, configured ? "ready" : undefined);
            if (result?.kind === "ready") {
              const receipt = Date.parse(result.receiverTime!);
              assertEquals(receipt >= before && receipt <= Date.now(), true);
            }
            assertEquals(!!hby.db.msgc.get([hab.pre, body.said!]), configured);
          },
        );
      });
    } finally {
      await Deno.remove(headDirPath, { recursive: true });
    }
  }
});

Deno.test("cli context - withHabAndAgentRuntime closes resources when callback throws", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events, fakeHab());
  const runtime = fakeRuntime(events);

  await assertRejects(
    () =>
      run(() =>
        withHabAndAgentRuntime(
          { name: "store" },
          "alice",
          { dependencies: fakeDependencies(events, hby, runtime) },
          function*({ hab }) {
            events.push(`use:${hab.pre}`);
            throw new Error("delegate failed");
          },
        )
      ),
    Error,
    "delegate failed",
  );

  assertEquals(events, ["setup:store", "runtime", "use:Ealice", "runtime.close", "hby.close"]);
});

Deno.test("cli context - missing name is rejected before opening resources", async () => {
  const events: string[] = [];

  await assertRejects(
    () =>
      run(() =>
        withExistingHabery(
          {},
          { dependencies: fakeDependencies(events, fakeHabery(events)) },
          function*() {
            events.push("use");
          },
        )
      ),
    ValidationError,
    "Name is required and cannot be empty",
  );

  assertEquals(events, []);
});

Deno.test("cli context - invalid alias is rejected and opened resources are closed", async () => {
  const events: string[] = [];
  const hby = fakeHabery(events);
  const runtime = fakeRuntime(events);

  await assertRejects(
    () =>
      run(() =>
        withHabAndAgentRuntime(
          { name: "store" },
          "missing",
          { dependencies: fakeDependencies(events, hby, runtime) },
          function*() {
            events.push("use");
          },
        )
      ),
    ValidationError,
    "Alias missing is invalid",
  );

  assertEquals(events, ["setup:store", "runtime", "runtime.close", "hby.close"]);
});

Deno.test("cli context - command, runtime and Habery failures remain observable", async () => {
  const events: string[] = [];
  const commandFailure = new Error("command failed");
  const runtimeFailure = new Error("runtime close failed");
  const databaseFailure = new Error("database close failed");
  const hby = fakeHabery(events);
  hby.close = function*() {
    events.push("hby.close");
    throw databaseFailure;
  };
  const runtime = fakeRuntime(events);
  runtime.close = function*() {
    events.push("runtime.close");
    throw runtimeFailure;
  };
  const error = await assertRejects(() =>
    run(() =>
      withAgentRuntime(
        { name: "store" },
        { dependencies: fakeDependencies(events, hby, runtime) },
        function*() {
          throw commandFailure;
        },
      )
    ), AggregateError);
  const outer = error as AggregateError;
  assertStrictEquals(outer.errors[1], databaseFailure);
  assertEquals((outer.errors[0] as AggregateError).errors, [commandFailure, runtimeFailure]);
  assertEquals(events, ["setup:store", "runtime", "runtime.close", "hby.close"]);
});

Deno.test("cli context - Habery attempts every owned close and preserves failures", async () => {
  const events: string[] = [];
  const dbFailure = new Error("Baser close failed");
  const ksFailure = new Error("Keeper close failed");
  const hby = {
    db: {
      *close() {
        events.push("db");
        throw dbFailure;
      },
    },
    ks: {
      *close() {
        events.push("ks");
        throw ksFailure;
      },
    },
    cf: {
      *close() {
        events.push("cf");
      },
    },
  } as unknown as Habery;
  const error = await assertRejects(() => run(() => Habery.prototype.close.call(hby)), AggregateError);
  assertEquals((error as AggregateError).errors, [dbFailure, ksFailure]);
  assertEquals(events, ["db", "ks", "cf"]);
});
