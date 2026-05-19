import { assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert";
import { type Logger, ValidationError } from "keri-ts/runtime";
import { createTufaApp } from "../src/http/app.ts";

interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta: unknown[];
}

function createStubLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record = (level: LogEntry["level"]) => (message: string, ...meta: unknown[]) => {
    entries.push({ level, message, meta });
  };

  return {
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
    entries,
  };
}

Deno.test("tufa/http app - health keeps protocol response while adding Stage 4 CORS headers", async () => {
  const app = createTufaApp();
  const response = await app.request("http://127.0.0.1/health");

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    response.headers.get("Access-Control-Expose-Headers"),
    "Content-Type, KERI-AID, Oobi-Aid",
  );
});

Deno.test("tufa/http app - OPTIONS short-circuits before protocol routing", async () => {
  const app = createTufaApp({
    protocolHandler: async () => {
      throw new Error("protocol handler should not run for preflight");
    },
  });
  const response = await app.request("http://127.0.0.1/health", {
    method: "OPTIONS",
  });

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, POST, PUT, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "Content-Type, CESR-ATTACHMENT, CESR-DESTINATION, Oobi-Aid",
  );
});

Deno.test("tufa/http app - request logging uses normalized path and omits request bodies", async () => {
  const { logger, entries } = createStubLogger();
  const app = createTufaApp({
    app: { logger },
    protocolHandler: async () => new Response(null, { status: 204 }),
  });

  const response = await app.request("http://127.0.0.1/foo/", {
    method: "POST",
    body: "super-secret-body",
    headers: { "Content-Type": "text/plain" },
  });

  assertEquals(response.status, 204);

  const infoEntries = entries.filter((entry) => entry.level === "info");
  assertEquals(infoEntries.length, 1);
  assertMatch(infoEntries[0]!.message, /^POST \/foo -> 204 \d+\.\dms$/);
  assertEquals(infoEntries[0]!.message.includes("super-secret-body"), false);
  assertEquals(
    infoEntries.some((entry) => `${entry.message} ${entry.meta.join(" ")}`.includes("super-secret-body")),
    false,
  );
});

Deno.test("tufa/http app - validation errors map to 400 text responses", async () => {
  const app = createTufaApp({
    protocolHandler: async () => {
      throw new ValidationError("bad request from protocol");
    },
  });
  const response = await app.request("http://127.0.0.1/fail");

  assertEquals(response.status, 400);
  assertEquals(response.headers.get("Content-Type"), "text/plain");
  assertEquals(await response.text(), "bad request from protocol");
});

Deno.test("tufa/http app - unknown errors map to generic 500 responses and log once", async () => {
  const { logger, entries } = createStubLogger();
  const app = createTufaApp({
    app: { logger },
    protocolHandler: async () => {
      throw new Error("sensitive internal detail");
    },
  });
  const response = await app.request("http://127.0.0.1/fail");

  assertEquals(response.status, 500);
  assertEquals(await response.text(), "Internal Server Error");

  const errorEntries = entries.filter((entry) => entry.level === "error");
  assertEquals(errorEntries.length, 1);
  assertStringIncludes(errorEntries[0]!.message, "Unhandled HTTP app error");
  assertEquals(
    `${errorEntries[0]!.message} ${errorEntries[0]!.meta.join(" ")}`.includes(
      "sensitive internal detail",
    ),
    true,
  );

  const infoEntries = entries.filter((entry) => entry.level === "info");
  assertEquals(infoEntries.length, 1);
  assertMatch(infoEntries[0]!.message, /^GET \/fail -> 500 \d+\.\dms$/);
});
