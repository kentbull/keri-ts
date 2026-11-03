import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { Ilks, type Kind, Vrsn_2_0 } from "../../../../cesr/mod.ts";
import { exchange, exincept } from "../../../src/core/exchange/protocol-exchanging.ts";
import {
  exchange as eventExchange,
  exchept,
  incept,
  query,
  reply,
  rotate,
  state,
} from "../../../src/core/protocol-eventing.ts";
import { KeyStateRecord } from "../../../src/core/records.ts";
import fixture from "../../fixtures/keripy-xip-v2-spec-vectors.json" with { type: "json" };

const PRE = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RECIPIENT = "EBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SAID = "ECcccccccccccccccccccccccccccccccccccccccccc";
const NEXT = "EDdddddddddddddddddddddddddddddddddddddddddd";

Deno.test("protocol-eventing reply and query preserve KERIpy v1/v2 field order", () => {
  const v1Reply = reply(
    "/logs/processor",
    { name: "John" },
    "2026-04-10T00:00:00.000000+00:00",
  );
  const v2Reply = reply("/logs/processor", { name: "John" }, {
    pre: PRE,
    pvrsn: Vrsn_2_0,
    stamp: "2026-04-10T00:00:00.000000+00:00",
  });

  assertEquals(Object.keys(v1Reply.ked ?? {}), ["v", "t", "d", "dt", "r", "a"]);
  assertEquals(Object.keys(v2Reply.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "dt",
    "r",
    "a",
  ]);
  assertEquals(v2Reply.ked?.i, PRE);

  const v1Query = query(
    "logs",
    { i: PRE, src: RECIPIENT },
    "2026-04-10T00:00:00.000000+00:00",
  );
  const v2Query = query("logs", { i: PRE, src: RECIPIENT }, {
    pre: PRE,
    pvrsn: Vrsn_2_0,
    stamp: "2026-04-10T00:00:00.000000+00:00",
  });

  assertEquals(Object.keys(v1Query.ked ?? {}), [
    "v",
    "t",
    "d",
    "dt",
    "r",
    "rr",
    "q",
  ]);
  assertEquals(Object.keys(v2Query.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "dt",
    "r",
    "rr",
    "q",
  ]);
  assertEquals(v2Query.ked?.i, PRE);
});

Deno.test("protocol-eventing incept and rotate follow KERIpy-shaped field presence", () => {
  const dip = incept([PRE], {
    ndigs: [NEXT],
    wits: [RECIPIENT],
    toad: 1,
    delpre: RECIPIENT,
  });
  const rot = rotate(PRE, [RECIPIENT], SAID, {
    sn: 1,
    ndigs: [NEXT],
    wits: [RECIPIENT],
    cuts: [RECIPIENT],
    adds: [PRE],
    cnfg: ["EO"],
    data: [{ anchor: SAID }],
    pvrsn: Vrsn_2_0,
  });

  assertEquals(dip.ilk, Ilks.dip);
  assertEquals(Object.keys(dip.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "s",
    "kt",
    "k",
    "nt",
    "n",
    "bt",
    "b",
    "c",
    "a",
    "di",
  ]);
  assertEquals((dip.ked as Record<string, unknown>).di, RECIPIENT);

  assertEquals(rot.ilk, Ilks.rot);
  assertEquals(Object.keys(rot.ked ?? {}), [
    "v",
    "t",
    "d",
    "i",
    "s",
    "p",
    "kt",
    "k",
    "nt",
    "n",
    "bt",
    "br",
    "ba",
    "c",
    "a",
  ]);
  assertEquals((rot.ked as Record<string, unknown>).c, ["EO"]);
});

Deno.test("protocol-eventing state returns a KeyStateRecord", () => {
  const ksn = state(
    PRE,
    1,
    SAID,
    NEXT,
    5,
    Ilks.rot,
    [PRE],
    { s: "0", d: SAID, br: [], ba: [] },
    {
      ndigs: [NEXT],
      wits: [RECIPIENT],
      toad: 1,
      dpre: RECIPIENT,
    },
  );

  assertInstanceOf(ksn, KeyStateRecord);
  assertEquals(ksn.i, PRE);
  assertEquals(ksn.di, RECIPIENT);
  assertEquals(ksn.ee?.d, SAID);
});

Deno.test("selected v2-spec XIP and EXN transaction bodies match all four Python codecs", () => {
  const bytes = (raw: string) => Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  for (const row of fixture.cases) {
    const options = {
      sender: fixture.parties[0].pre,
      receiver: fixture.parties[1].pre,
      nonce: fixture.nonce,
      stamp: fixture.stamp,
      attributes: { m: "open" },
      kind: row.kind as Kind,
    };
    for (const opener of [exchept("/transaction", options), exincept("/transaction", options)]) {
      assertEquals(opener.raw, bytes(row.opener.raw), `${row.kind} opener`);
      assertEquals(opener.said, row.opener.said);
      assertEquals(opener.ilk, Ilks.xip);
    }
    const continuation = eventExchange("/transaction", {
      sender: fixture.parties[1].pre,
      receiver: fixture.parties[0].pre,
      xid: row.opener.said,
      prior: row.opener.said,
      stamp: fixture.stamp,
      attributes: { m: "continue" },
      kind: row.kind as Kind,
    });
    const [peerContinuation] = exchange("/transaction", { m: "continue" }, {
      sender: fixture.parties[1].pre,
      recipient: fixture.parties[0].pre,
      xid: row.opener.said,
      dig: row.opener.said,
      stamp: fixture.stamp,
      kind: row.kind as Kind,
      pvrsn: Vrsn_2_0,
    });
    for (const body of [continuation, peerContinuation]) {
      assertEquals(body.raw, bytes(row.continuation.raw), `${row.kind} continuation`);
      assertEquals(body.ked?.x, row.opener.said);
      assertEquals(body.ked?.p, row.opener.said);
    }
  }
});
