// @file-test-lane core-fast-a

import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { Ilks } from "../../../../cesr/mod.ts";
import { backerIssue, incept, issue, query, state, vcstate } from "../../../src/core/protocol-vdr-eventing.ts";
import { RegStateRecord, VcStateRecord } from "../../../src/core/records.ts";

const ISSUER = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REGISTRY = "EBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const VC = "ECcccccccccccccccccccccccccccccccccccccccccc";
const SAID = "EDdddddddddddddddddddddddddddddddddddddddddd";

Deno.test("protocol-vdr-eventing constructors preserve KERIpy field order", () => {
  const vcp = incept(ISSUER, {
    baks: [REGISTRY],
    toad: 1,
    cnfg: ["NB"],
    nonce: SAID,
  });
  const iss = issue(VC, REGISTRY, { dt: "2026-04-10T00:00:00.000000+00:00" });
  const bis = backerIssue(VC, REGISTRY, 3, SAID, {
    dt: "2026-04-10T00:00:00.000000+00:00",
  });

  assertEquals(vcp.ilk, Ilks.vcp);
  assertEquals(Object.keys(vcp.ked ?? {}), ["v", "t", "d", "i", "ii", "s", "c", "bt", "b", "n"]);
  assertEquals(iss.ilk, Ilks.iss);
  assertEquals(Object.keys(iss.ked ?? {}), ["v", "t", "d", "i", "s", "ri", "dt"]);
  assertEquals(bis.ilk, Ilks.bis);
  assertEquals(Object.keys(bis.ked ?? {}), ["v", "t", "d", "i", "ii", "s", "ra", "dt"]);
});

Deno.test("protocol-vdr-eventing state builders return KERIpy-shaped records", () => {
  const rsr = state(ISSUER, SAID, 2, REGISTRY, Ilks.vrt, {
    toad: 1,
    wits: [REGISTRY],
    cnfg: ["EO"],
  });
  const vsr = vcstate(VC, SAID, 0, REGISTRY, Ilks.iss, {
    s: "3",
    d: SAID,
  });
  const qry = query(REGISTRY, VC, { route: "tels" });

  assertInstanceOf(rsr, RegStateRecord);
  assertEquals(rsr.i, REGISTRY);
  assertInstanceOf(vsr, VcStateRecord);
  assertEquals(vsr.ri, REGISTRY);
  assertEquals(qry.ilk, Ilks.qry);
});
