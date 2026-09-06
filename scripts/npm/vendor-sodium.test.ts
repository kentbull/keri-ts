import { assertEquals, assertThrows } from "jsr:@std/assert";
import { sodiumDistribution, vendorSodium } from "./vendor-sodium.ts";

Deno.test("npm sodium binding copies authenticated distributions and rejects drift before mutation", () => {
  const directory = Deno.makeTempDirSync({ prefix: "sodium-package-" });
  const entry = directory + "/esm/src/sodium.js";
  const original = 'import sodium from "libsodium-wrappers-sumo";\nawait sodium.ready;\nexport default sodium;\n';
  Deno.mkdirSync(directory + "/esm/src", { recursive: true });
  Deno.writeTextFileSync(entry, original);
  try {
    const source = sodiumDistribution();
    for (const key of ["wrapper", "raw", "license"] as const) {
      const changed = { ...source, [key]: new Uint8Array(source[key]) };
      changed[key][0] ^= 1;
      assertThrows(() => vendorSodium(directory, changed), Error, "distribution hash");
      assertEquals(Deno.readTextFileSync(entry), original);
    }
    Deno.writeTextFileSync(entry, original + original);
    assertThrows(() => vendorSodium(directory, source), Error, "import count");
    Deno.writeTextFileSync(entry, original);
    Deno.writeTextFileSync(directory + "/esm/extra.js", 'import raw from "libsodium-sumo";');
    assertThrows(() => vendorSodium(directory, source), Error, "external sodium");
    Deno.removeSync(directory + "/esm/extra.js");
    vendorSodium(directory, source);
    assertEquals(Deno.readTextFileSync(entry).includes("./sodium-0.8.4/wrapper.mjs"), true);
    const path = directory + "/esm/src/sodium-0.8.4/";
    assertEquals(Deno.readFileSync(path + "raw.mjs"), source.raw);
    assertEquals(Deno.readFileSync(path + "LICENSE"), source.license);
    const wrapper = Deno.readTextFileSync(path + "wrapper.mjs");
    assertEquals(wrapper.startsWith('import e from"./raw.mjs";'), true);
    assertEquals(wrapper.includes('from"libsodium-sumo"'), false);
    const provenance = JSON.parse(Deno.readTextFileSync(path + "provenance.json"));
    assertEquals(provenance.packages, { "libsodium-wrappers-sumo": "0.8.4", "libsodium-sumo": "0.8.4" });
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});
