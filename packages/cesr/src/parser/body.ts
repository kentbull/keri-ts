import { isCodecSyntaxFailure } from "../core/codec-errors.ts";
import { isCesrDomain, tokenSize, unitBytes } from "../core/domain.ts";
import {
  ColdStartError,
  DeserializeError,
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
  VersionError,
} from "../core/errors.ts";
import type { CesrBody, CesrDomain, Smellage } from "../core/types.ts";
import { type Counter, parseCounter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import { reapSerder } from "../serder/serdery.ts";
import { smell } from "../serder/smell.ts";
import { resolveCounterSizeTable } from "../tables/counter-version-registry.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds, Protocols } from "../tables/versions.ts";
import { sniff } from "./cold-start.ts";
import { DEFAULT_GVRSN, FRAME_STARTS, NATIVE_BODIES, WRAPPED_BODIES } from "./common.ts";

/** One hydrated finite body, before progressive traversal reads its attachments. */
interface ParsedBody {
  /** Serder or opaque non-native body whose bytes are retained by the frame. */
  body: CesrBody;
  /** Complete body extent, including its own wrapper counter when present. */
  consumed: number;
  /** Validated attachment genus; protocol version remains independent. */
  gvrsn: Versionage;
}

/**
 * Hydrate one body without parsing enclosures, selectors, or attachments.
 * Progressive traversal owns those stream boundaries and supplies the selected genus.
 */
export function parseBody(
  input: Uint8Array,
  selected: Versionage | null,
  onDecodeFailure?: (error: unknown) => void,
): ParsedBody {
  const domain = sniff(input);
  if (domain === "msg") {
    const { serder, consumed } = reapSerder(input, onDecodeFailure);
    return { body: serder, consumed, gvrsn: bodyGenus(serder, selected) };
  }
  if (!isCesrDomain(domain)) throw new ColdStartError(`Expected a body but got ${domain}`);
  const gvrsn = selected ?? DEFAULT_GVRSN;
  const counter = parseCounter(input, gvrsn, domain);
  const header = tokenSize(counter, domain);
  const size = header + counter.count * unitBytes(domain);
  if (input.length < size) throw new ShortageError(size, input.length);
  if (WRAPPED_BODIES.has(counter.name)) {
    return { body: wrappedBody(input.subarray(header, size), domain, gvrsn, onDecodeFailure), consumed: size, gvrsn };
  }
  if (NATIVE_BODIES.has(counter.name)) {
    let body: CesrBody;
    try {
      // Native message counters must hydrate a Serder; arbitrary maps belong to Mapper/Aggor.
      ({ serder: body } = reapSerder(input.subarray(0, size)));
    } catch (error) {
      if (error instanceof ShortageError) throw new GroupSizeError("Incomplete field inside native body payload");
      throw error;
    }
    bodyGenus(body, gvrsn);
    return { body, consumed: size, gvrsn };
  }
  throw new ColdStartError(`Unsupported body counter: ${counter.code}`);
}

/** Unwrap exactly one Matter value, preserving opaque non-native material. */
function wrappedBody(
  input: Uint8Array,
  domain: CesrDomain,
  gvrsn: Versionage,
  onDecodeFailure?: (error: unknown) => void,
): CesrBody {
  let matter: ReturnType<typeof parseMatter>;
  try {
    matter = parseMatter(input, domain);
  } catch (error) {
    if (error instanceof ShortageError) throw new GroupSizeError("Incomplete primitive inside NonNativeBodyGroup");
    throw error;
  }
  const size = tokenSize(matter, domain);
  if (input.length !== size) {
    throw new ColdStartError(`NonNativeBodyGroup payload size mismatch: expected=${input.length} actual=${size}`);
  }

  // Recognizable metadata must obey the selected genus even when hydration stays opaque.
  let metadata: Smellage | undefined;
  try {
    metadata = smell(matter.raw).smellage;
  } catch (error) {
    if (!(error instanceof ShortageError || error instanceof VersionError)) throw error;
    // Opaque non-native material need not contain a message version string.
  }
  if (metadata) bodyGenus(metadata, gvrsn);
  try {
    return reapSerder(matter.raw, onDecodeFailure).serder;
  } catch (error) {
    if (
      metadata
      && (metadata.kind === Kinds.json
        || metadata.kind === Kinds.mgpk || metadata.kind === Kinds.cbor)
      && !isCodecSyntaxFailure(error, metadata.kind)
    ) throw error;
    return {
      raw: matter.raw,
      ked: null,
      proto: Protocols.keri,
      kind: Kinds.cesr,
      size: matter.raw.length,
      pvrsn: gvrsn,
      gvrsn,
      ilk: null,
      said: null,
    };
  }
}

/** Infer unselected legacy bodies, otherwise validate metadata against the stream genus. */
function bodyGenus(body: Pick<CesrBody, "pvrsn" | "gvrsn">, selected: Versionage | null): Versionage {
  const genus = selected ?? body.gvrsn
    ?? (body.pvrsn.major === 1 ? { major: 1, minor: 0 } : DEFAULT_GVRSN);
  resolveCounterSizeTable(genus);
  if (body.pvrsn.major > genus.major) {
    throw new VersionError(
      `Protocol ${body.pvrsn.major}.${body.pvrsn.minor} exceeds stream genus ${genus.major}.${genus.minor}`,
    );
  }
  if (body.gvrsn) {
    resolveCounterSizeTable(body.gvrsn);
    if (body.gvrsn.major > genus.major || body.gvrsn.minor > genus.minor) {
      throw new VersionError(
        `Body genus ${body.gvrsn.major}.${body.gvrsn.minor} exceeds stream genus ${genus.major}.${genus.minor}`,
      );
    }
  }
  return genus;
}

/** Resolve frame counters in the selected genus; infer legacy forms only when unselected. */
export function readFrameCounter(
  input: Uint8Array,
  preferredGvrsn: Versionage,
  cold: CesrDomain,
  inferLegacy: boolean,
): { counter: Counter; gvrsn: Versionage } {
  const alternate: Versionage = preferredGvrsn.major >= 2
    ? { major: 1, minor: 0 }
    : { major: 2, minor: 0 };
  const attempts = inferLegacy ? [preferredGvrsn, alternate] : [preferredGvrsn];
  let firstParsed: { counter: Counter; gvrsn: Versionage } | null = null;
  let firstError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const counter = parseCounter(input, attempt, cold);
      if (!firstParsed) {
        firstParsed = { counter, gvrsn: attempt };
      }
      if (FRAME_STARTS.has(counter.name)) {
        return { counter, gvrsn: attempt };
      }
    } catch (error) {
      if (error instanceof ShortageError) {
        throw error;
      }
      if (
        error instanceof UnknownCodeError
        || error instanceof DeserializeError
      ) {
        if (!firstError) {
          firstError = error;
        }
        continue;
      }
      throw error;
    }
  }

  if (firstParsed) {
    return firstParsed;
  }
  if (firstError) {
    throw firstError;
  }
  throw new ColdStartError("Unable to resolve frame-start counter");
}
