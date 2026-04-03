import { decode as decodeMsgpack } from "@msgpack/msgpack";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { decodeKeriCbor } from "../../../../cesr/mod.ts";
import { KeyStateRecord, OobiQueryRecord, StateEERecord } from "../../../src/core/records.ts";

Deno.test("core/records - RawRecord helpers round-trip dict, JSON, CBOR, and MGPK without changing stored shape", () => {
  const state = KeyStateRecord.fromDict({
    i: "Eaid",
    d: "Esaid",
    s: "0",
    ee: {
      s: "0",
      d: "Esaid",
      br: [],
      ba: [],
    },
  });

  assertInstanceOf(state, KeyStateRecord);
  assertInstanceOf(state.ee, StateEERecord);
  assertEquals(state.asDict(), {
    i: "Eaid",
    d: "Esaid",
    s: "0",
    ee: {
      s: "0",
      d: "Esaid",
      br: [],
      ba: [],
    },
  });
  assertEquals(
    JSON.parse(new TextDecoder().decode(state.asJSON())),
    state.asDict(),
  );
  assertEquals(decodeKeriCbor(state.asCBOR()), state.asDict());
  assertEquals(decodeMsgpack(state.asMGPK()), state.asDict());
});

Deno.test("core/records - nested record hydration and KERIpy-style aliases are available", () => {
  const state = KeyStateRecord._fromdict({
    i: "Eaid",
    ee: { s: "1", d: "Eevt", br: ["Bw1"], ba: ["Bw2"] },
  });

  assertInstanceOf(state, KeyStateRecord);
  assertInstanceOf(state.ee, StateEERecord);
  assertEquals([...state], ["i", "ee"]);
  assertEquals(state._asdict(), {
    i: "Eaid",
    ee: { s: "1", d: "Eevt", br: ["Bw1"], ba: ["Bw2"] },
  });

  const query = OobiQueryRecord.fromDict({
    cid: "Ecid",
    role: "watcher",
    eids: ["Eeid"],
    scheme: "http",
  });
  assertInstanceOf(query, OobiQueryRecord);
  assertEquals(query.asDict(), {
    cid: "Ecid",
    role: "watcher",
    eids: ["Eeid"],
    scheme: "http",
  });
});
