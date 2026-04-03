import { assertEquals } from "jsr:@std/assert";
import { Ilks, isIlk, isTier, Tiers } from "../../src/index.ts";

Deno.test("KERI vocabulary exports authoritative Tiers and Ilks", () => {
  assertEquals(Tiers.low, "low");
  assertEquals(Tiers.med, "med");
  assertEquals(Tiers.high, "high");
  assertEquals(isTier(Tiers.low), true);
  assertEquals(isTier("bogus"), false);

  assertEquals(Ilks.icp, "icp");
  assertEquals(Ilks.rpy, "rpy");
  assertEquals(Ilks.acm, "acm");
  assertEquals(isIlk(Ilks.drt), true);
  assertEquals(isIlk("bogus"), false);
});
