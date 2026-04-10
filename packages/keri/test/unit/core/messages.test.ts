// @file-test-lane core-fast-a

import { assertEquals } from "jsr:@std/assert";
import { Ilks } from "../../../../cesr/mod.ts";
import { receipt as makeReceiptSerder } from "../../../src/core/protocol-eventing.ts";

Deno.test("core/messages - makeReceiptSerder builds the canonical `rct` serder", () => {
  const pre = "BCuDiSPCTq-qBBFDHkhf1_kmysrH8KSsFvoaOSgEbx-X";
  const sn = 15;
  const said = "EF6L5iM3lY4U9vQz4i2rQ5t8Y6uQ0w3r9eD4m2n8aBcD";

  const serder = makeReceiptSerder(pre, sn, said);

  assertEquals(serder.ilk, Ilks.rct);
  assertEquals(serder.pre, pre);
  assertEquals(serder.sn, sn);
  assertEquals(serder.said, said);
  assertEquals(serder.ked?.s, sn.toString(16));
});
