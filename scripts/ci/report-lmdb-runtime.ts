/** Require the actual addon's NAPI build and report its newly written LMDB data format. */
import { createRequire } from "node:module";
import { open } from "npm:lmdb@3.5.3";
import * as lmdbBinding from "npm:lmdb@3.5.3";

/** Node's module cache is the npm addon loader boundary; filesystem work remains Deno-native. */
const require = createRequire(import.meta.url);
/** V1 layout alone cannot identify a portable addon; Node V8 symbols can fail on a later large read. */
const nativeVersion = (lmdbBinding as unknown as { version?: { nodeCompiledVersion?: number } }).version;
if (!nativeVersion || "nodeCompiledVersion" in nativeVersion) {
  throw new Error("Loaded LMDB addon is not the required NAPI build; run setup:compat-lmdb.");
}
/** A disposable database proves the format emitted by this loaded addon. */
const directory = await Deno.makeTempDir({ prefix: "keri-lmdb-provenance-" });
try {
  const database = open({ path: directory, encoding: "binary" });
  try {
    database.putSync("probe", new Uint8Array([1]));
  } finally {
    await database.close();
  }
  const file = await Deno.readFile(`${directory}/data.mdb`);
  // LMDB's first meta page begins with the native page header, magic, then uint32 version.
  const headerBytes = Deno.build.arch === "x86_64" || Deno.build.arch === "aarch64" ? 16 : 12;
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const dataVersion = new DataView(file.buffer, file.byteOffset).getUint32(headerBytes + 4, littleEndian);
  const addons = Object.keys(require.cache).filter((path) =>
    path.endsWith(".node") && /\/node_modules\/(?:lmdb|@lmdb\/[^/]+)\//.test(path.replaceAll("\\", "/"))
  );
  if (addons.length !== 1) throw new Error(`Expected one loaded LMDB addon, observed ${JSON.stringify(addons)}`);
  const addon = await Deno.realPath(addons[0]);
  const bytes = await Deno.readFile(addon);
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const evidence = {
    addon,
    sha256,
    dataVersion,
    nativeVersion,
    napi: true,
    LMDB_DATA_V1: Deno.env.get("LMDB_DATA_V1") ?? null,
    deno: Deno.version,
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (dataVersion !== 1) {
    throw new Error(`Loaded addon writes LMDB data version ${dataVersion}; run setup:compat-lmdb.`);
  }
} finally {
  await Deno.remove(directory, { recursive: true });
}
