import { clearSource, Decoder } from "cbor-x/decode";
import { Encoder } from "cbor-x/encode";
import { codecSyntaxFailure } from "./codec-errors.ts";

/**
 * Normalize encoder output to a plain `Uint8Array`.
 *
 * `cbor-x` may return subclasses or reused backing buffers depending on the
 * runtime and code path. The shared KERI codec deliberately copies the result
 * so callers see a stable, plain `Uint8Array` contract that is safe to compare,
 * persist, and hand across package boundaries without inheriting library
 * implementation details.
 */
function normalizeEncodedBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

/**
 * Reject JavaScript `Map` values anywhere in the payload graph.
 *
 * This is not a statement about CBOR in general. CBOR absolutely supports map
 * values. The narrower rule here is about KERI/ACDC parity: KERIpy serializes
 * the same semantic payloads through JSON, MGPK, and CBOR, and the CBOR paths
 * we are mirroring are dict/list shaped rather than "generic CBOR" shaped.
 *
 * In TypeScript, allowing `Map` values would silently widen the contract past
 * what the JSON and MGPK paths can represent and past what KERIpy currently
 * exercises in the mirrored protocol/storage serializers. This guard fails
 * early so parity drift becomes an explicit decision instead of an accidental
 * convenience.
 *
 * The walk is cycle-safe because this function is defensive validation, not a
 * serializer in its own right. Cycles would fail later in the encoder anyway,
 * but we avoid infinite recursion here while still checking the reachable graph
 * for `Map` instances.
 */
function assertNoMapValues(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (value instanceof Map) {
    throw new TypeError(
      "KERI/ACDC CBOR payloads must use JSON-compatible plain objects/arrays, not JavaScript Map.",
    );
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoMapValues(item, seen);
    }
    return;
  }

  for (const item of Object.values(value)) {
    assertNoMapValues(item, seen);
  }
}

/**
 * Canonical KERI/ACDC CBOR encoder configuration.
 *
 * Two choices matter for parity:
 * - `useRecords: false` disables `cbor-x` record extensions so plain objects
 *   stay plain maps on the wire, matching KERIpy's `cbor2` behavior.
 * - `variableMapSize: true` forces preferred-size map headers, avoiding the
 *   default `map16` preallocation strategy that broke exact byte parity.
 *
 * We import `Encoder` from `cbor-x/encode` rather than the package root because
 * the root Node entrypoint probes `process.env` during module evaluation. That
 * widened Deno test permissions for no KERI value, so the shared codec avoids
 * that entrypoint on purpose.
 */
const keriCborEncoder = new Encoder({
  useRecords: false,
  variableMapSize: true,
});

/**
 * Canonical KERI/ACDC CBOR decoder configuration.
 *
 * `mapsAsObjects: true` keeps decoded values aligned with the JSON-compatible
 * object/list contract enforced by `encodeKeriCbor()`. This prevents the decode
 * side from reintroducing `Map`-typed semantics that the encode side forbids
 * and keeps protocol/storage callers working with the same value shapes they
 * would see from JSON or MGPK decoding.
 *
 * Like the encoder, this uses the `cbor-x/decode` subpath to avoid the package
 * root's Node-oriented environment probe.
 */
const keriCborDecoder = new Decoder({
  useRecords: false,
  mapsAsObjects: true,
}) as Decoder & { mapsAsObjects: boolean };

/**
 * Encode KERI/ACDC CBOR with the same preferred map-size choices as KERIpy's
 * `cbor2.dumps`.
 *
 * This is a protocol/storage codec for KERI/ACDC payloads, not a generic CBOR
 * helper. KERIpy's corresponding emitters serialize dict/list-shaped data
 * through `cbor2.dumps`, for example:
 * - `keri.core.coring.dumps`
 * - `keri.core.serdering.Serder.dumps`
 * - `keri.db.koming.Komer.__serializeCBOR`
 *
 * The same semantic payloads also serialize as JSON and MGPK in KERIpy, so the
 * intended cross-format contract is JSON-compatible plain objects and arrays.
 * The default `cbor-x` encoder intentionally uses fixed-width `map16` headers
 * for plain JS objects so it can preallocate and patch in the size later. That
 * is valid CBOR but not byte-identical to KERIpy. This helper enables
 * `variableMapSize` so small maps use the same compact headers that `cbor2`
 * emits and rejects `Map` values so we do not silently drift into a broader
 * CBOR type contract than KERIpy currently uses.
 */
export function encodeKeriCbor(value: unknown): Uint8Array {
  assertNoMapValues(value);
  return normalizeEncodedBytes(keriCborEncoder.encode(value));
}

/**
 * Decode KERI/ACDC CBOR into plain JS objects/arrays.
 *
 * This keeps the decoder aligned with the encoder policy surface and avoids
 * record-extension or `Map`-typed decode behavior on KERI/ACDC protocol and
 * storage paths. Decoded schema-defined values remain unknown until their
 * consumer validates the required shape; this codec cannot promise a caller type.
 */
export function decodeKeriCbor(raw: Uint8Array): unknown {
  return decodeCborScope(raw, keriCborDecoder.decode);
}

const nativeDecode = Decoder.prototype.decode;
// Private fixed bytes never reach an injected decode method or tag callback.
const resetSource = Uint8Array.of(0xf6);
Object.defineProperty(resetSource, "dataView", { value: new DataView(resetSource.buffer) });
let decodeDepth = 0;

/**
 * Reset message-bearing decoder globals before returning ownership to the caller.
 * Pinned native null decoding clears strings/packed/source/structures/references and
 * replaces dataView with fixed one-byte backing. Instance options configure no tables;
 * encoder state, injected callbacks and native residency remain separate boundaries.
 */
function decodeCborScope(
  raw: Uint8Array,
  decode: Decoder["decode"],
  onResetFailure?: (error: unknown) => void,
): unknown {
  decodeDepth++;
  let value: unknown, primary: unknown, failed = false;
  try {
    value = decode.call(keriCborDecoder, raw);
  } catch (error) {
    primary = error;
    failed = true;
  } finally {
    decodeDepth--;
  }
  if (decodeDepth === 0) {
    try {
      // Tag259 can leave this option false on malformed/non-map input.
      keriCborDecoder.mapsAsObjects = true;
      nativeDecode.call(keriCborDecoder, resetSource);
    } catch (cleanup) {
      clearSource(); // A foreign option/getter failure may precede checkedRead cleanup.
      const failure = failed ? new AggregateError([primary, cleanup], "CBOR decode and reset failed") : cleanup;
      onResetFailure?.(failure);
      throw failure;
    }
  }
  if (failed) throw primary;
  return value;
}

/**
 * Preserve the shared codec's exact shapes; only scanned malformed boundaries are intrinsic.
 * Complete-input/tag/infrastructure failures propagate; incomplete/RangeError alone is not provenance.
 * Special tag expansion, external table/callback mutation and native residency remain unqualified.
 */
export function decodeAdmittedKeriCbor(
  raw: Uint8Array,
  boundaryFailure: boolean,
  onFailure?: (error: unknown) => void,
): unknown {
  const decode = keriCborDecoder.decode;
  let resetFailed = false;
  try {
    return decodeCborScope(raw, decode, (error) => {
      resetFailed = true;
      onFailure?.(error);
    });
  } catch (error) {
    if (resetFailed) throw error;
    if (
      !boundaryFailure || !(error instanceof Error)
    ) {
      onFailure?.(error);
      throw error;
    }
    throw codecSyntaxFailure("CBOR", `Failed to decode CBOR Serder: ${String(error)}`);
  }
}
