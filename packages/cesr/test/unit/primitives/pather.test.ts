import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DeserializeError, UnknownCodeError } from "../../../src/core/errors.ts";
import { MtrDex } from "../../../src/primitives/codex.ts";
import { makePather, parsePather, Pather } from "../../../src/primitives/pather.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

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

Deno.test("pather: resolves SAD labels and mapping or list ordinals with whole-node selectors", () => {
  const sad = { d: "said", a: { name: "Alice", grades: ["A", "B"] } };
  assertEquals(makePather("/a/name").resolve(sad), "Alice");
  assertEquals(makePather("/1/0").resolve(sad), "Alice");
  assertEquals(makePather("a/grades/1", { relative: true }).resolve(sad), "B");
  assertEquals(makePather("/a/").resolve(sad), sad.a);
  assertEquals(makePather("/").rparts, []);
  assertEquals(makePather("/").resolve(sad), sad);
  const path = makePather("/a/grades/0");
  assertEquals(path.parts, ["", "a", "grades", "0"]);
  assertEquals(path.rparts, ["a", "grades", "0"]);
  assertEquals(path.resolve(sad), "A");
  assertEquals(path.rparts, ["a", "grades", "0"]);
  for (const invalid of ["/a/absent", "/a/grades/4", "/a/grades/name", "/a/name/child", "/constructor"]) {
    assertThrows(() => makePather(invalid).resolve(sad), DeserializeError);
  }
});

Deno.test("pather: resolution follows the complete legal path", () => {
  const path = makePather("a/b", { relative: true });
  const sad = { a: { b: "value" } };
  assertEquals(path.resolve(sad), "value");
  const deep = makePather(Array(257).fill("a"), { relative: true });
  assertEquals(parsePather(deep.qb64b, "txt").path, deep.path);
  const nested = Array(257).fill("a").reduceRight((child) => ({ a: child }), "value" as unknown);
  assertEquals(deep.resolve(nested), "value");
});

Deno.test("pather: byte paths reject malformed UTF-8 before resolving", () => {
  const pather = new Pather({ raw: Uint8Array.of(255), code: MtrDex.Bytes_L2 });
  assertThrows(() => pather.path, DeserializeError, "UTF-8");
  assertThrows(() => pather.resolve({}), DeserializeError, "UTF-8");
});
