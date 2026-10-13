import type { CesrDomain } from "../core/types.ts";

/** Uninterpreted payload bytes in their original encoding domain. */
export class OpaqueSpan {
  readonly raw: Uint8Array;
  readonly domain: CesrDomain;

  constructor(raw: Uint8Array, domain: CesrDomain) {
    this.raw = raw.slice();
    this.domain = domain;
  }
}
