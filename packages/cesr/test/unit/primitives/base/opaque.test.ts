import { assertEquals } from "jsr:@std/assert";
import { OpaqueSpan } from "../../../../src/primitives/base/opaque.ts";

Deno.test("opaque spans copy original bytes without interpreting either domain", () => {
  for (const domain of ["txt", "bny"] as const) {
    const bytes = new Uint8Array([33, 255, 0, 65]);
    const span = new OpaqueSpan(bytes, domain);
    bytes.fill(0);
    assertEquals(span.raw, new Uint8Array([33, 255, 0, 65]));
    assertEquals(span.domain, domain);
  }
});
