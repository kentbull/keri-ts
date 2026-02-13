import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import {
  parseAttachmentDispatch,
  parseAttachmentDispatchCompat,
} from "../../src/parser/group-dispatch.ts";
import { supportedPrimitiveCodes } from "../../src/primitives/registry.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import { UnknownCodeError } from "../../src/core/errors.ts";
import { MATTER_SIZES } from "../../src/tables/matter.tables.generated.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_CODE_NAMES_V2,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";

function token(code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) {
    throw new Error(`Need fixed-size code for token, got ${code}`);
  }
  return code + "A".repeat(sizage.fs - code.length);
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function selectV2OnlyQuadletGroupCode(): string {
  const candidates = [
    CtrDexV2.ESSRWrapperGroup,
    CtrDexV2.BigESSRWrapperGroup,
    CtrDexV2.FixBodyGroup,
    CtrDexV2.BigFixBodyGroup,
    CtrDexV2.MapBodyGroup,
    CtrDexV2.BigMapBodyGroup,
    CtrDexV2.GenericMapGroup,
    CtrDexV2.BigGenericMapGroup,
    CtrDexV2.GenericListGroup,
    CtrDexV2.BigGenericListGroup,
  ];
  const code = candidates.find((value) => !(value in COUNTER_CODE_NAMES_V1));
  if (!code) {
    throw new Error("No v2-only quadlet-group code found for fallback tests");
  }
  return code;
}

Deno.test("primitive registry includes extended KERIpy codex entries", () => {
  const codes = supportedPrimitiveCodes();
  assert(codes.includes("0P")); // GramHeadNeck
  assert(codes.includes("7AAF")); // HPKEBase_Cipher_Big_L0
  assert(codes.includes("9AAH")); // Decimal_Big_L2
  assert(codes.includes("1___")); // TBD testing code
  assert(codes.length > 100);
});

Deno.test("dispatch parses v2 controller indexed signatures group", () => {
  const ims = `-KAB${sigerToken()}`;
  const parsed = parseAttachmentDispatch(new TextEncoder().encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "ControllerIdxSigs");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses v2 trans indexed sig group", () => {
  const ims = `-XAB${token("B")}${token("M")}${token("E")}-KAB${sigerToken()}`;
  const parsed = parseAttachmentDispatch(new TextEncoder().encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "TransIdxSigGroups");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses nested attachment wrapper", () => {
  const nested = `-KAB${sigerToken()}`;
  const ims = `${counterV2("-C", nested.length / 4)}${nested}`;
  const parsed = parseAttachmentDispatch(new TextEncoder().encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "AttachmentGroup");
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("legacy v1 sad path aliases persist in generated tables", () => {
  assertEquals(COUNTER_CODE_NAMES_V1["-J"], "SadPathSig");
  assertEquals(COUNTER_CODE_NAMES_V1["-K"], "SadPathSigGroup");
  assert(COUNTER_SIZES_V1.has("-J"));
  assert(COUNTER_SIZES_V1.has("-K"));
  assert(COUNTER_SIZES_V2.has("-J"));
});

Deno.test("strict attachment dispatch does not fallback across major versions", () => {
  const code = selectV2OnlyQuadletGroupCode();
  const ims = `${counterV2(code, 1)}AAAA`;

  assertThrows(
    () =>
      parseAttachmentDispatch(new TextEncoder().encode(ims), {
        major: 1,
        minor: 0,
      }, "txt"),
    UnknownCodeError,
  );
});

Deno.test("compat attachment dispatch falls back and reports warning callback", () => {
  const code = selectV2OnlyQuadletGroupCode();
  const ims = `${counterV2(code, 1)}AAAA`;
  const fallbackEvents: Array<{
    fromMajor: number;
    toMajor: number;
    domain: string;
    reason: string;
  }> = [];

  const parsed = parseAttachmentDispatchCompat(
    new TextEncoder().encode(ims),
    { major: 1, minor: 0 },
    "txt",
    {
      mode: "compat",
      onVersionFallback: (info) => {
        fallbackEvents.push({
          fromMajor: info.from.major,
          toMajor: info.to.major,
          domain: info.domain,
          reason: info.reason,
        });
      },
    },
  );

  assertEquals(parsed.group.code, code);
  assertEquals(
    parsed.group.name,
    COUNTER_CODE_NAMES_V2[code as keyof typeof COUNTER_CODE_NAMES_V2],
  );
  assertEquals(fallbackEvents.length, 1);
  assertEquals(fallbackEvents[0].fromMajor, 1);
  assertEquals(fallbackEvents[0].toMajor, 2);
  assertEquals(fallbackEvents[0].domain, "txt");
  assert(fallbackEvents[0].reason.length > 0);
});
