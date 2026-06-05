import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  DeserializeError,
  UnknownCodeError,
} from "../../../src/core/errors.ts";
import { makePather, parsePather } from "../../../src/primitives/pather.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import {
  assertTxtBnyQb64Parity,
  txt,
} from "../../fixtures/primitive-test-helpers.ts";

Deno.test("pather: parses KERIpy path vector", () => {
  const pather = parsePather(txt(KERIPY_MATTER_VECTORS.patherSimple), "txt");
  assertEquals(pather.qb64, KERIPY_MATTER_VECTORS.patherSimple);
  assertEquals(pather.path.length > 0, true);
});

Deno.test("pather: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.patherSimple,
    parsePather,
  );
  assertEquals(txtValue.path, bnyValue.path);
});

Deno.test("pather: rejects non-path code families", () => {
  assertThrows(
    () => parsePather(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1), "txt"),
    UnknownCodeError,
  );
});

Deno.test("pather: makePather mirrors KERIpy route encoding for relative route strings", () => {
  // Native KERI route fields do not use generic label/text encoding. They go
  // through the Pather route contract (`relative=True`, `pathive=False`), so
  // even plain values like `ksn` produce a compact path token.
  assertEquals(
    makePather("ksn", { relative: true, pathive: false }).qb64,
    "4AABAksn",
  );
  assertEquals(
    makePather("reply", { relative: true, pathive: false }).qb64,
    "6AACAAAreply",
  );
});

Deno.test("pather: makePather mirrors KERIpy route encoding for slash-delimited routes", () => {
  // This is the route case that used to fail in native exn tests. KERIpy keeps
  // slash-separated semantic routes but compacts them into StrB64 path tokens
  // when each segment stays base64-safe.
  const pather = makePather("credential/issue", {
    relative: true,
    pathive: false,
  });

  assertEquals(pather.qb64, "4AAEcredential-issue");
  assertEquals(pather.path, "credential/issue");
});

Deno.test("pather: makePather rejects pathive-invalid segments when caller requires pathive mode", () => {
  assertThrows(
    () => makePather("Not$Base64", { relative: true, pathive: true }),
    DeserializeError,
  );
});
