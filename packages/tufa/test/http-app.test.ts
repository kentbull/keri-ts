import { assertEquals } from "jsr:@std/assert";
import { createTufaApp } from "../src/http/app.ts";

Deno.test("tufa/http app - health remains a thin Hono-mounted protocol route", async () => {
  const app = createTufaApp();
  const response = await app.request("http://127.0.0.1/health");

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
});

Deno.test("tufa/http app - no Stage 4 middleware or CORS policy is added yet", async () => {
  const app = createTufaApp();
  const response = await app.request("http://127.0.0.1/health", {
    method: "OPTIONS",
  });

  assertEquals(response.status, 200);
  assertEquals(response.headers.has("access-control-allow-origin"), false);
});
