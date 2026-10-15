import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { Diger, Ilks, NumberPrimitive, Prefixer, SealEvent } from "../../../../cesr/mod.ts";
import type { ReplyCue } from "../../../src/core/cues.ts";
import { backerIssue, incept, issue, query, state, vcstate } from "../../../src/core/protocol-vdr-eventing.ts";
import {
  type CredentialKelAnchor,
  type RegistrySealFields,
  RegStateRecord,
  VcStateRecord,
} from "../../../src/core/records.ts";

const ISSUER = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REGISTRY = "EBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const VC = "ECcccccccccccccccccccccccccccccccccccccccccc";
const SAID = "EDdddddddddddddddddddddddddddddddddddddddddd";

// @ts-expect-error A credential KEL anchor sequence is an integer, not registry-seal hex text.
void ({ s: "3", d: SAID } satisfies CredentialKelAnchor);
// @ts-expect-error A registry seal's sequence is hex text, not a credential KEL integer.
void ({ i: REGISTRY, s: 3, d: SAID } satisfies RegistrySealFields);
// @ts-expect-error Known registry seal fields provide no arbitrary metadata slot.
void ({ extra: "value" } satisfies Partial<RegistrySealFields>);
// @ts-expect-error An anchor must carry its digest as well as its sequence.
void ({ s: 3 } satisfies CredentialKelAnchor);

Deno.test("protocol-vdr-eventing constructors preserve KERIpy field order", () => {
  const vcp = incept(ISSUER, {
    baks: [REGISTRY],
    toad: 1,
    nonce: SAID,
  });
  const iss = issue(VC, REGISTRY, { dt: "2026-04-10T00:00:00.000000+00:00" });
  const bis = backerIssue(VC, REGISTRY, 3, SAID, {
    dt: "2026-04-10T00:00:00.000000+00:00",
  });

  assertEquals(vcp.ilk, Ilks.vcp);
  assertEquals(Object.keys(vcp.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "ii",
    "s",
    "c",
    "bt",
    "b",
    "n",
  ]);
  assertEquals(iss.ilk, Ilks.iss);
  assertEquals(Object.keys(iss.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "s",
    "ri",
    "dt",
  ]);
  assertEquals(bis.ilk, Ilks.bis);
  assertEquals(Object.keys(bis.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "ii",
    "s",
    "ra",
    "dt",
  ]);
});

Deno.test("protocol-vdr-eventing state builders return KERIpy-shaped records", () => {
  const rsr = state(ISSUER, SAID, 2, REGISTRY, Ilks.vrt, {
    toad: 1,
    wits: [REGISTRY],
    cnfg: ["EO"],
  });
  const vsr = vcstate(VC, SAID, 0, REGISTRY, Ilks.iss, {
    s: 3,
    d: SAID,
  });
  const qry = query(REGISTRY, VC, { route: "tels" });

  // @ts-expect-error A registry reply cannot carry credential state.
  void ({ kin: "reply", route: "/tsn/registry", data: vsr, dest: ISSUER } satisfies ReplyCue);
  // @ts-expect-error A credential reply cannot carry registry state.
  void ({ kin: "reply", route: "/tsn/credential", data: rsr, dest: ISSUER } satisfies ReplyCue);
  // @ts-expect-error Prebuilt replies cannot also carry a second route/data representation.
  void ({ kin: "reply", serder: qry, route: "/tsn/registry", data: rsr, dest: ISSUER } satisfies ReplyCue);
  // @ts-expect-error A TSN data reply must retain its requester's destination.
  void ({ kin: "reply", route: "/tsn/registry", data: rsr } satisfies ReplyCue);

  assertInstanceOf(rsr, RegStateRecord);
  assertEquals(rsr.i, REGISTRY);
  assertEquals(rsr.b.length, 1);
  assertInstanceOf(vsr, VcStateRecord);
  assertEquals(vsr.ri, REGISTRY);
  assertEquals(vsr.a, { s: 3, d: SAID });
  assertEquals(vsr.a.s, 3);
  assertEquals(vsr.ra, {});
  const partial = vcstate(VC, SAID, 0, REGISTRY, Ilks.bis, { s: 3, d: SAID }, { ra: { i: REGISTRY, d: SAID } });
  assertEquals(partial.ra, { i: REGISTRY, d: SAID }, "Raw state preserves partial registry references");
  const seal = SealEvent.fromTuple([
    new Prefixer({ code: "E", raw: new Uint8Array(32) }),
    NumberPrimitive.fromNum(3n),
    new Diger({ code: "E", raw: new Uint8Array(32).fill(1) }),
  ]);
  const typed = vcstate(VC, SAID, 0, REGISTRY, Ilks.bis, { s: 3, d: SAID }, { ra: seal });
  assertEquals(typed.ra, SealEvent.toSad(seal));
  assertEquals(qry.ilk, Ilks.qry);
});
