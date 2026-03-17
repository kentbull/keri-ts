import { b, t } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
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
      raw: Bexter.rawify(bext),
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

  /** Decoded `/`-separated path form regardless of underlying CESR code family. */
  get path(): string {
    if (BEXTER_CODES.has(this.code)) {
      const bext = Bexter.derawify(this.raw, this.code).replace(/^--/, "");
      return bext.split("-").join("/");
    }
    return t(this.raw);
  }
}

/** Parse and hydrate a `Pather` from txt/qb2 bytes. */
export function parsePather(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Pather {
  return new Pather(parseMatter(input, cold));
}
