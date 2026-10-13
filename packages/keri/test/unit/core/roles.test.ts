import { assertEquals } from "jsr:@std/assert";
import { EndpointRoles, isEndpointRole, isRole, Roles } from "../../../src/core/roles.ts";
import { isScheme, Schemes } from "../../../src/core/schemes.ts";

Deno.test("KERI role codex includes watcher while endpoint-role subset stays narrow", () => {
  assertEquals(isRole(Roles.controller), true);
  assertEquals(isRole(Roles.watcher), true);
  assertEquals(isRole("bogus"), false);

  assertEquals(isEndpointRole(EndpointRoles.controller), true);
  assertEquals(isEndpointRole(Roles.watcher), false);
});

Deno.test("KERI scheme codex mirrors KERIpy-authoritative values", () => {
  assertEquals(Schemes.http, "http");
  assertEquals(Schemes.https, "https");
  assertEquals(Schemes.tcp, "tcp");
  assertEquals(isScheme(Schemes.http), true);
  assertEquals(isScheme("bogus"), false);
});
