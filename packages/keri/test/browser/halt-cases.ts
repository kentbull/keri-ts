/**
 * Cancelling an in-flight request must finish and close the connection in every engine. WebKit loses
 * the abort link of a pending `fetch` once its `Request` is garbage collected, so these cases wait long
 * enough for a collection before they halt. The lane's own server (`/stall`, see `transport_echo.ts`)
 * answers nothing, headers only, or one chunk, then stays silent, and reports when the browser closed it.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import { call, run, suspend } from "npm:effection@^3.6.0";
import { systemClock } from "../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../src/app/transport/http-client.ts";
import { requestWithHeaderTimeout } from "../../src/app/transport/httping.ts";
import { note } from "./notes.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stall = (mode: string, id: string) => `${location.origin}/stall?mode=${mode}&id=${id}`;

/** Allocate enough short-lived garbage that the engine collects before the caller continues. */
async function collectGarbage(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    let keep: unknown[] = [];
    for (let i = 0; i < 400; i++) keep = [new Array(50_000).fill({ i }), keep.length > 20 ? [] : keep];
    await sleep(100);
  }
}

/** Milliseconds from open to the server seeing the browser close `id`, or null if it never does. */
async function serverSawClose(id: string): Promise<number | null> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { closedAfter } = await (await fetch(`${location.origin}/stall-state?id=${id}`)).json();
    if (closedAfter !== null) return closedAfter;
    await sleep(100);
  }
  return null;
}

/** Wait for `halting` to finish or report that it did not within `ms`. */
async function finishes(halting: Promise<unknown>, ms = 4000): Promise<boolean> {
  return await Promise.race([halting.then(() => true), sleep(ms).then(() => false)]);
}

/** Halt a request in `mode` after the engine has had time to collect; it must finish and close. */
async function haltStalled(mode: "none" | "headers" | "chunk"): Promise<void> {
  const id = crypto.randomUUID();
  const http = new FetchHttpClient();
  const task = run(function*() {
    const response = yield* http.open(stall(mode, id), { signal: new AbortController().signal });
    if (mode === "chunk") {
      yield* call(async () => {
        for await (const _ of response.body()) { /* drain until halted */ }
      });
    } else yield* suspend();
  });
  await sleep(700);
  await collectGarbage();
  assert(await finishes(task.halt()), `halting a ${mode} request did not finish`);
  const closed = await serverSawClose(id);
  assert(closed !== null, `the server never saw the ${mode} connection close`);
  note(`halt ${mode}: connection closed ${Math.round(closed)} ms after open`);
}

/** A poll's header deadline must fire even if the engine would never answer. */
async function headerTimeout(): Promise<void> {
  const id = crypto.randomUUID();
  const result = await run(function*() {
    const response = yield* requestWithHeaderTimeout(
      new FetchHttpClient(),
      systemClock,
      stall("none", id),
      { method: "POST" },
      1500,
    );
    return response;
  });
  assertEquals(result, null);
  assert((await serverSawClose(id)) !== null, "the timed-out request stayed open");
}

/** Register the halting cases. */
export function registerHaltCases(): void {
  for (const mode of ["none", "headers", "chunk"] as const) {
    Deno.test(`http client: halting a ${mode} request completes and closes the connection`, () => haltStalled(mode));
  }
  Deno.test("http client: the header deadline of a stalled request fires and closes the connection", headerTimeout);
}
