// @file-test-lane app-fast-parallel

import { type Operation, run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { AgentRuntime, AgentRuntimeOptions } from "../../../src/app/agent-runtime.ts";
import {
  type CommandContextDependencies,
  withAgentRuntime,
  withExistingHabery,
  withHabAndAgentRuntime,
} from "../../../src/app/cli/common/context.ts";
import type { Hab, Habery } from "../../../src/app/habbing.ts";
import { ValidationError } from "../../../src/core/errors.ts";

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
    createAgentRuntime: function*(_hby: Habery, options: AgentRuntimeOptions = {}): Operation<AgentRuntime> {
      events.push(`runtime:${options.mode ?? "unset"}`);
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
      { dependencies: fakeDependencies(events, hby) },
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

  assertEquals(events, ["setup:store", "runtime:local", "use:runtime", "runtime.close", "hby.close"]);
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

  assertEquals(events, ["setup:store", "runtime:local", "use:Ealice", "runtime.close", "hby.close"]);
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

  assertEquals(events, ["setup:store", "runtime:local", "runtime.close", "hby.close"]);
});
