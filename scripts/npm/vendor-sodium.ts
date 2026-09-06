/** Bind the generated npm runtime to the exact reviewed sodium ESM distribution.
 * Only the wrapper's raw-module import and the generated private entry import change.
 * Types may still reference the exact external wrapper package; runtime never does.
 */
import "npm:libsodium-wrappers-sumo@0.8.4";
import "npm:libsodium-sumo@0.8.4";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { listFilesSync } from "./dnt-helpers.ts";

const version = "0.8.4";
const wrapperImport = 'import e from"libsodium-sumo";';
const runtimeImport = 'import sodium from "libsodium-wrappers-sumo";';
const pins = {
  wrapper: "40de1ef7cb8f2caae02c2a8f04809151904fa28cb9364cadedc57af89a6c9284",
  raw: "4c94708f7e78eac7a32b29e2ce0ff96f4bd599d78c129f27bf8a061e20776c8c",
  license: "ce7b8ba14db085aadb72359226ccf7273225db31dad653242a7726a10dabbbd4",
} as const;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Resolve through the same Deno npm graph, then verify package identity and distribution bytes. */
export function sodiumDistribution(): { wrapper: Uint8Array; raw: Uint8Array; license: Uint8Array } {
  const require = createRequire(import.meta.url);
  const read = (name: string, filename: string) => {
    const root = dirname(dirname(dirname(require.resolve(name))));
    const metadata = JSON.parse(Deno.readTextFileSync(join(root, "package.json")));
    if (metadata.name !== name || metadata.version !== version) throw new Error("Unexpected sodium package resolution");
    return {
      bytes: Deno.readFileSync(join(root, "dist", "modules-sumo-esm", filename)),
      license: Deno.readFileSync(join(root, "LICENSE")),
    };
  };
  const wrapper = read("libsodium-wrappers-sumo", "libsodium-wrappers.mjs");
  const raw = read("libsodium-sumo", "libsodium-sumo.mjs");
  if (hash(wrapper.license) !== pins.license || hash(raw.license) !== pins.license) {
    throw new Error("Unexpected sodium license");
  }
  return { wrapper: wrapper.bytes, raw: raw.bytes, license: raw.license };
}

/** Fail before modifying generated files if source hashes or generated import shape drift. */
export function vendorSodium(outDir: string, distribution = sodiumDistribution()): void {
  for (const key of ["wrapper", "raw", "license"] as const) {
    if (hash(distribution[key]) !== pins[key]) throw new Error(`Unexpected sodium ${key} distribution hash`);
  }
  const wrapper = new TextDecoder().decode(distribution.wrapper);
  if (wrapper.split(wrapperImport).length !== 2) throw new Error("Unexpected sodium raw import count");
  const files = listFilesSync(join(outDir, "esm")).filter((file) => /\.[cm]?js$/.test(file));
  const external = files.filter((file) =>
    /["']libsodium(?:-wrappers)?(?:-sumo)?["']/.test(Deno.readTextFileSync(file))
  );
  if (external.length !== 1 || !external[0].endsWith("/sodium.js")) {
    throw new Error("Unexpected external sodium runtime import");
  }
  const entry = external[0], original = Deno.readTextFileSync(entry);
  if (original.split(runtimeImport).length !== 2) throw new Error("Unexpected generated sodium import count");
  const source = wrapper.replace(wrapperImport, 'import e from"./raw.mjs";');
  const vendor = join(dirname(entry), "sodium-0.8.4");
  Deno.mkdirSync(vendor); // Fresh DNT output only; never silently overwrite an earlier copy.
  Deno.writeTextFileSync(join(vendor, "wrapper.mjs"), source, { createNew: true });
  Deno.writeFileSync(join(vendor, "raw.mjs"), distribution.raw, { createNew: true });
  Deno.writeFileSync(join(vendor, "LICENSE"), distribution.license, { createNew: true });
  Deno.writeTextFileSync(
    join(vendor, "provenance.json"),
    JSON.stringify(
      {
        version: 1,
        packages: { "libsodium-wrappers-sumo": version, "libsodium-sumo": version },
        original_sha256: pins,
        wrapper_sha256: hash(new TextEncoder().encode(source)),
        modification: "The wrapper's one libsodium-sumo import points to adjacent raw.mjs; no crypto code changes.",
      },
      null,
      2,
    ) + "\n",
    { createNew: true },
  );
  Deno.writeTextFileSync(entry, original.replace(runtimeImport, 'import sodium from "./sodium-0.8.4/wrapper.mjs";'));
}
