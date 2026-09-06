import { assertEquals, assertThrows } from "jsr:@std/assert";
import { MtrDex } from "../../../src/primitives/codex.ts";
import { Salter } from "../../../src/primitives/salter.ts";
import sodium from "../../../src/primitives/sodium.ts";

interface NativePwhash {
  HEAPU8: Uint8Array;
  _malloc(length: number): number;
  _free(address: number): void;
  _crypto_pwhash(...args: number[]): number;
}
const nativeModule = () => (sodium as unknown as { libsodium: NativePwhash }).libsodium;
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
const path = "SYNTHETIC-owned-pwhash-lifetime-751c8924";

for (
  const failure of [
    "none",
    "growth",
    "native-return",
    "native-throw",
    "allocation-1",
    "allocation-2",
    "allocation-3",
  ] as const
) {
  Deno.test(`pwhash: zero before free on ${failure}`, () => {
    const native = nativeModule();
    const allocate = native._malloc, free = native._free, derive = native._crypto_pwhash;
    const owned = new Map<number, number>();
    const releases: boolean[] = [];
    let allocations = 0;
    const beforeHeap = native.HEAPU8;
    native._malloc = (length: number) => {
      allocations++;
      if (
        (failure === "allocation-1" && allocations === 1) || (failure === "allocation-2" && allocations === 2)
        || (failure === "allocation-3" && allocations === 3)
      ) return 0;
      const address = allocate(length);
      if (address) owned.set(address, length);
      return address;
    };
    native._free = (address: number) => {
      const length = owned.get(address);
      if (length !== undefined) {
        releases.push((native.HEAPU8 as Uint8Array).subarray(address, address + length).every((byte) => byte === 0));
        owned.delete(address);
      }
      free(address);
    };
    if (failure === "native-return" || failure === "native-throw") {
      native._crypto_pwhash = (output: number, length: number) => {
        (native.HEAPU8 as Uint8Array).fill(0x5a, output, output + length);
        if (failure === "native-throw") throw new Error("injected native failure");
        return -1;
      };
    }
    try {
      const stretch = () =>
        new Salter({ raw: salt, code: MtrDex.Salt_128 }).stretch({ temp: failure !== "growth", path });
      if (failure === "none" || failure === "growth") assertEquals(stretch().length, 32);
      else assertThrows(stretch);
      if (failure === "growth") {
        assertEquals(
          native.HEAPU8.buffer !== beforeHeap.buffer,
          true,
          "actual low-tier derivation replaces the initial 4MiB heap view",
        );
      }
      assertEquals(owned.size, 0, "all acquired buffers must be released");
      assertEquals(
        releases.length,
        failure === "allocation-1" ? 0 : failure === "allocation-2" ? 1 : failure === "allocation-3" ? 2 : 3,
      );
      assertEquals(releases.every(Boolean), true, "every owned range must be zero before _free");
    } finally {
      native._malloc = allocate;
      native._free = free;
      native._crypto_pwhash = derive;
      for (const [address, length] of owned) {
        (native.HEAPU8 as Uint8Array).fill(0, address, address + length);
        free(address);
      }
    }
  });
}

Deno.test("pwhash: invalid output sizes reject before any native allocation", () => {
  const native = nativeModule(), allocate = native._malloc;
  let allocations = 0;
  native._malloc = (length: number) => {
    allocations++;
    return allocate(length);
  };
  try {
    for (const size of [-1, 0, 4, 15, 16.5, NaN, Infinity, 0x80000000]) {
      assertThrows(() => new Salter({ raw: salt, code: MtrDex.Salt_128 }).stretch({ temp: true, size }), RangeError);
    }
    assertEquals(allocations, 0);
    assertEquals(new Salter({ raw: salt, code: MtrDex.Salt_128 }).stretch({ temp: true, size: 16 }).length, 16);
  } finally {
    native._malloc = allocate;
  }
});
