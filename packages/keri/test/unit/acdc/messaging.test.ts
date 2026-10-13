import { assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { Ilks, Kinds, Mapper, SerderACDC, t } from "../../../../cesr/mod.ts";
import {
  acdcatt,
  acdcmap,
  acgSchemaDefault,
  acmSchemaDefault,
  actSchemaDefault,
  blindate,
  regcept,
  sectionate,
  update,
} from "../../../src/acdc/messaging.ts";
import { ValidationError } from "../../../src/core/errors.ts";

const issuer = "EA2X8Lfrl9lZbCGz8cfKIvM_cqLyTYVLSFLhnttezlzQ";
const issuee = "EAKCxMOuoRzREVHsHCkLilBrUXTvyenBiuM2QtV8BB0C";
const uuid = "0AAxyHwW6htOZ_rANOaZb2N2";
const stamp = "2020-08-22T17:50:09.988921+00:00";
const regid = "EM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8";
const blid = "EBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769";
const tsaid = "EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ";
const updateStamp = "2020-08-23T18:06:10.988921+00:00";

Deno.test("acdc/messaging - regcept matches KERIpy JSON and CESR vectors", () => {
  const json = regcept(issuer, { uuid, stamp });
  assertEquals(json.said, "EPC9M2c8LnocZRbaLC-nk2IC06pc-xlhipwgaoCdK_Wq");
  assertEquals(json.sad, {
    v: "ACDCCAACAAJSONAADa.",
    t: Ilks.rip,
    d: "EPC9M2c8LnocZRbaLC-nk2IC06pc-xlhipwgaoCdK_Wq",
    u: uuid,
    i: issuer,
    n: "0",
    dt: stamp,
  });
  assertEquals(
    t(json.raw),
    "{\"v\":\"ACDCCAACAAJSONAADa.\",\"t\":\"rip\",\"d\":\"EPC9M2c8LnocZRbaLC-nk2IC06pc-xlhipwgaoCdK_Wq\",\"u\":\"0AAxyHwW6htOZ_rANOaZb2N2\",\"i\":\"EA2X8Lfrl9lZbCGz8cfKIvM_cqLyTYVLSFLhnttezlzQ\",\"n\":\"0\",\"dt\":\"2020-08-22T17:50:09.988921+00:00\"}",
  );

  const cesr = regcept(issuer, { uuid, stamp, kind: Kinds.cesr });
  assertEquals(cesr.said, regid);
  assertEquals(
    t(cesr.raw),
    "-FAq0OACDCCAACAAXripEM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR80AAxyHwW6htOZ_rANOaZb2N2EA2X8Lfrl9lZbCGz8cfKIvM_cqLyTYVLSFLhnttezlzQMAAA1AAG2020-08-22T17c50c09d988921p00c00",
  );
  assertEquals(new SerderACDC({ raw: cesr.raw }).sad, cesr.sad);
});

Deno.test("acdc/messaging - registry update messages match KERIpy vectors", () => {
  const bupJson = blindate(regid, regid, blid, { stamp: updateStamp });
  assertEquals(bupJson.said, "EDGouTZMjO0HbHefvBrYtpWTY6y5TykF2LDgaZJNiJjB");
  assertEquals(
    t(bupJson.raw),
    "{\"v\":\"ACDCCAACAAJSONAAEi.\",\"t\":\"bup\",\"d\":\"EDGouTZMjO0HbHefvBrYtpWTY6y5TykF2LDgaZJNiJjB\",\"rd\":\"EM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8\",\"n\":\"1\",\"p\":\"EM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8\",\"dt\":\"2020-08-23T18:06:10.988921+00:00\",\"b\":\"EBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769\"}",
  );

  const bupCesr = blindate(regid, regid, blid, { stamp: updateStamp, kind: Kinds.cesr });
  assertEquals(bupCesr.said, "EIOVlgnJvK96aMVLtB3PoaIcjpvPDoq41xtIKQE92Rx_");
  assertEquals(
    t(bupCesr.raw),
    "-FA60OACDCCAACAAXbupEIOVlgnJvK96aMVLtB3PoaIcjpvPDoq41xtIKQE92Rx_EM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8MAABEM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR81AAG2020-08-23T18c06c10d988921p00c00EBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769",
  );

  const updJson = update(regid, regid, tsaid, "issued", { stamp: updateStamp });
  assertEquals(updJson.said, "ELI-gUF8FFE_eTllQSwUZMlY-BeBcnFaIar0V23uxy6A");
  assertEquals(
    t(updJson.raw),
    "{\"v\":\"ACDCCAACAAJSONAAEx.\",\"t\":\"upd\",\"d\":\"ELI-gUF8FFE_eTllQSwUZMlY-BeBcnFaIar0V23uxy6A\",\"rd\":\"EM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8\",\"n\":\"1\",\"p\":\"EM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8\",\"dt\":\"2020-08-23T18:06:10.988921+00:00\",\"td\":\"EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ\",\"ts\":\"issued\"}",
  );

  const updCesr = update(regid, updJson.said!, tsaid, "issued", { sn: 2, stamp: updateStamp, kind: Kinds.cesr });
  assertEquals(updCesr.said, "ECeZ647uldGDcTjWV8wHABE3w4CzrblKGJhzIBiFjS4Q");
  assertEquals(
    t(updCesr.raw),
    "-FA80OACDCCAACAAXupdECeZ647uldGDcTjWV8wHABE3w4CzrblKGJhzIBiFjS4QEM1hJSHgqklxe-SFOWkGRKRTIzbSh7yd0inf8RZ8paR8MAACELI-gUF8FFE_eTllQSwUZMlY-BeBcnFaIar0V23uxy6A1AAG2020-08-23T18c06c10d988921p00c00EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0Missued",
  );
});

Deno.test("acdc/messaging - default schema SAIDs match KERIpy JSON and CESR vectors", () => {
  assertEquals(actSchemaDefault()[0], "EANZuuCmPzwr81sZiX-2e-bC6nBDt7Gb4xkZo__wzGBu");
  assertEquals(actSchemaDefault(Kinds.cesr)[0], "EFd28O1tMjNISThEXiWpZPJL9Ud-ocu2QmOGuMD1RvSi");
  assertEquals(acgSchemaDefault()[0], "EIgmaDpd1IHrG76EEMkrBbmUJ7xeIl7680PKWVtdebyO");
  assertEquals(acgSchemaDefault(Kinds.cesr)[0], "EB1_MVIk_DSkPNFejlfTEmxf7txIrc9NpUEwV_cLjWnl");
  assertEquals(acmSchemaDefault()[0], "EPrsJF2BXyDUgDCVbGURsGNwCZjyrxD5M2qnBmhvoZYQ");
  assertEquals(acmSchemaDefault(Kinds.cesr)[0], "EEVFmM1Q_obsLcCCeY0G2wAAGJZUNAzPAwNT5N13bIeK");
});

Deno.test("acdc/messaging - native Mapper encodes ambiguous ordinary text like KERIpy", () => {
  const mapper = new Mapper({
    mad: { description: "Uncompacted Edge Section" },
    strict: false,
    kind: Kinds.cesr,
  });
  assertEquals(t(mapper.raw).includes("descriptionUncompacted Edge Section"), false);
  assertEquals(t(mapper.raw), "-IAMZdescription4BAIVW5jb21wYWN0ZWQgRWRnZSBTZWN0aW9u");
});

Deno.test("acdc/messaging - top-level and section builders produce compact disclosure set", () => {
  const attribute = { LEI: "5493001KJTIIGC8Y1R12" };
  const [acdc, sch, att, agg, edg, rul] = sectionate(issuer, {
    ilk: Ilks.act,
    uuid,
    regid,
    issuee,
    attribute,
  });

  assertInstanceOf(acdc, SerderACDC);
  assertEquals(acdc.ilk, Ilks.act);
  assertEquals(acdc.issuer, issuer);
  assertEquals(acdc.regid, regid);
  assertEquals(agg, null);
  assertEquals(att?.ked?.a, { d: acdc.ked?.a, ...attribute, i: issuee });
  assertEquals(sch.ked?.s, actSchemaDefault()[1]);
  assertEquals(edg.ked?.e, { d: acdc.ked?.e });
  assertEquals(rul.ked?.r, { d: acdc.ked?.r });
  assertEquals(new SerderACDC({ raw: acdc.raw }).said, acdc.said);

  const expanded = acdcatt(issuer, { uuid, regid, issuee, attribute });
  assertEquals(expanded.said, acdc.said);
  assertEquals(typeof expanded.ked?.a, "object");
  assertEquals(typeof acdc.ked?.a, "string");
});

Deno.test("acdc/messaging - map builder enforces attribute xor aggregate", () => {
  assertThrows(
    () => acdcmap(issuer, { attribute: {}, aggregate: [] }),
    ValidationError,
    "Either one or the other",
  );
  assertThrows(
    () => acdcmap(issuer),
    ValidationError,
    "Either one or the other",
  );
});
