/** Status-only consumers must still finish response cleanup before recording HTTP success. */
import { resource, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { FetchHttpClient, type HttpStreamResponse, TransportError } from "keri-ts/runtime";
import { postWebhook } from "../src/webhook.ts";

Deno.test("webhook HTTP success cannot hide response cleanup failure", async () => {
  const failure = new Error("webhook response cleanup fault");
  const http = new FetchHttpClient();
  http.open = () =>
    resource<HttpStreamResponse>(function*(provide) {
      try {
        yield* provide({ status: 202, ok: true, headers: new Headers(), async *body() {} });
      } finally {
        throw failure;
      }
    });
  const error = await assertRejects(() =>
    run(() =>
      postWebhook(http, () => 0, "http://unused.test/", {
        action: "iss",
        actor: "issuer",
        data: { schema: "schema" },
      })
    )
  );
  assertStrictEquals(error, failure);
  http.open = () =>
    resource<HttpStreamResponse>(function*() {
      throw new TransportError("webhook socket unavailable");
    });
  assertEquals(
    await run(() => postWebhook(http, () => 0, "http://unused.test/", { action: "iss", actor: "issuer", data: {} })),
    false,
  );
});
