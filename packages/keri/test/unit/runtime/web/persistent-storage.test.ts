import { assertEquals } from "jsr:@std/assert";
import { requestPersistentStorage } from "../../../../runtime-web.ts";

Deno.test("persistence request reports a grant with quota and usage", async () => {
  const calls: string[] = [];
  const result = await requestPersistentStorage({
    persisted: () => (calls.push("persisted"), Promise.resolve(false)),
    persist: () => (calls.push("persist"), Promise.resolve(true)),
    estimate: () => Promise.resolve({ quota: 100, usage: 7 }),
  });
  assertEquals(result, { persisted: true, supported: true, quota: 100, usage: 7 });
  assertEquals(calls, ["persisted", "persist"]);
});

Deno.test("persistence request does not re-ask when already persistent", async () => {
  const result = await requestPersistentStorage({
    persisted: () => Promise.resolve(true),
    persist: () => Promise.reject(new Error("must not be called")),
  });
  assertEquals(result, { persisted: true, supported: true });
});

Deno.test("persistence request reports a refusal or failure without throwing", async () => {
  assertEquals(
    await requestPersistentStorage({ persist: () => Promise.resolve(false), estimate: () => Promise.resolve({}) }),
    { persisted: false, supported: true },
  );
  assertEquals(
    await requestPersistentStorage({
      persist: () => Promise.reject(new Error("blocked")),
      estimate: () => Promise.reject(new Error("blocked")),
    }),
    { persisted: false, supported: true },
  );
});

Deno.test("persistence request reports unsupported without throwing", async () => {
  const unsupported = { persisted: false, supported: false };
  assertEquals(await requestPersistentStorage({}), unsupported);
  assertEquals(await requestPersistentStorage(undefined), unsupported);
});
