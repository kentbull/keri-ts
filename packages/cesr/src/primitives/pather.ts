import { b } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import type { CesrDomain } from "../core/types.ts";
import { Bexter } from "./bexter.ts";
import { BEXTER_CODES, MtrDex, TEXTER_CODES } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

function isPatherCode(code: string): boolean {
  return BEXTER_CODES.has(code) || TEXTER_CODES.has(code);
}

function normalizeParts(
  path: string | readonly string[],
): string[] {
  if (typeof path !== "string") {
    return [...path];
  }
  if (path.includes("/")) {
    return path.split("/");
  }
  return path.split("-");
}

const RE_PATH_PART = /^[A-Za-z0-9_]*$/;

function strB64CodeForText(bext: string): string {
  const ts = bext.length % 4;
  const ls = (3 - ts) % 3;
  switch (ls) {
    case 0:
      return MtrDex.StrB64_L0;
    case 1:
      return MtrDex.StrB64_L1;
    case 2:
      return MtrDex.StrB64_L2;
    default:
      throw new DeserializeError(`Unsupported StrB64 leader size=${ls}`);
  }
}

function bytesCodeForRaw(raw: Uint8Array): string {
  const ls = (3 - (raw.length % 3)) % 3;
  switch (ls) {
    case 0:
      return MtrDex.Bytes_L0;
    case 1:
      return MtrDex.Bytes_L1;
    case 2:
      return MtrDex.Bytes_L2;
    default:
      throw new DeserializeError(`Unsupported bytes leader size=${ls}`);
  }
}

/**
 * Build a Pather from semantic route/path text.
 *
 * This mirrors the KERIpy `Pather(path=..., relative=..., pathive=...)`
 * constructor path:
 * - "pathive" base64-safe segments use compact StrB64 encoding with `-`
 *   separators
 * - non-pathive routes fall back to byte/text encoding when they contain
 *   characters like `/`
 * - relative routes keep the first segment as-is, while absolute paths are
 *   forced to start with an empty root segment
 * - Pather owns its `--` escape; Bexter's single-hyphen escaping is disabled
 *
 * Examples:
 * - `makePather("ksn", { relative: true, pathive: false }).qb64 === "4AABAksn"`
 * - `makePather("reply", { relative: true, pathive: false }).qb64 === "6AACAAAreply"`
 * - `makePather("credential/issue", { relative: true, pathive: false }).qb64 === "4AAEcredential-issue"`
 */
export function makePather(
  path: string | readonly string[],
  opts: { relative?: boolean; pathive?: boolean } = {},
): Pather {
  const relative = opts.relative ?? false;
  const pathive = opts.pathive ?? true;
  const parts = normalizeParts(path);

  let bextable = true;
  for (const part of parts) {
    if (!RE_PATH_PART.test(part)) {
      if (pathive) {
        throw new DeserializeError(`Invalid pathive path part=${part}`);
      }
      bextable = false;
    }
  }

  if (!relative) {
    if (parts.length > 0 && parts[0] !== "") {
      parts.unshift("");
    } else if (parts.length === 0) {
      parts.push("", "");
    }
  }

  if (bextable) {
    let bext = parts.join("-");
    if (bext.includes("--")) {
      throw new DeserializeError(
        `Non-unitary path separators for path=${bext}`,
      );
    }

    const ws = (4 - (bext.length % 4)) % 4;
    if (bext.startsWith("A") && (ws === 0 || ws === 1)) {
      // KERIpy reserves `--` as an escape prefix when the compact path would
      // otherwise start with an ambiguous leading `A`.
      bext = `--${bext}`;
    }
    return new Pather({
      raw: Bexter.rawify(bext, false),
      code: strB64CodeForText(bext),
    });
  }

  const text = parts.join("/");
  if (text.includes("//")) {
    throw new DeserializeError(`Non-unitary path separators for path=${text}`);
  }
  const raw = b(text);
  return new Pather({ raw, code: bytesCodeForRaw(raw) });
}

/**
 * CESR path primitive for SAD traversal routes.
 *
 * KERIpy semantics: path strings may be compactly encoded via StrB64 family
 * (`-` separators, optional `--` escape prefix) or carried as raw bytes.
 */
export class Pather extends Matter {
  constructor(init: Matter | MatterInit) {
    super(init);
    if (!isPatherCode(this.code)) {
      throw new UnknownCodeError(
        `Expected pather-compatible code, got ${this.code}`,
      );
    }
  }

  /** Decode `/`-separated paths, removing only Pather's own double-hyphen escape. */
  get path(): string {
    return this.parts.join("/");
  }

  /** Decoded components retain the absolute root and a trailing whole-node selector. */
  get parts(): string[] {
    if (BEXTER_CODES.has(this.code)) {
      return Bexter.derawify(this.raw, this.code, false).replace(/^--/, "").split("-");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.raw).split("/");
    } catch {
      throw new DeserializeError("Non-UTF-8 Pather bytes");
    }
  }

  /** Relative traversal discards only leading root components. */
  get rparts(): string[] {
    const parts = this.parts;
    while (parts[0] === "") parts.shift();
    return parts;
  }

  /** Resolve SAD labels or field/list ordinals without a traversal quota. */
  resolve(sad: unknown): unknown {
    const parts = this.rparts;
    let value = sad;
    for (const part of parts) {
      if (Array.isArray(value)) {
        if (!/^[+-]?\d+$/.test(part)) throw new DeserializeError("Invalid array pointer index");
        const ordinal = Number(part);
        const index = ordinal < 0 ? value.length + ordinal : ordinal;
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
          throw new DeserializeError("Array pointer index is outside the list");
        }
        value = value[index];
      } else if (value !== null && typeof value === "object") {
        if (part === "") return value;
        const key = /^\d+$/.test(part) ? Object.keys(value)[Number(part)] : part;
        if (key === undefined || !Object.hasOwn(value, key)) throw new DeserializeError("Invalid map pointer");
        value = (value as Record<string, unknown>)[key];
      } else throw new DeserializeError("Invalid path traversal type");
    }
    return value;
  }
}

/** Parse and hydrate a `Pather` from txt/qb2 bytes. */
export function parsePather(
  input: Uint8Array,
  cold: CesrDomain,
): Pather {
  return new Pather(parseMatter(input, cold));
}
