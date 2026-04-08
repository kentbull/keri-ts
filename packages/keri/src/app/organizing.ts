import { type Cigar } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import type { Habery } from "./habbing.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export interface ContactRecord extends Record<string, unknown> {
  id: string;
}

/**
 * Minimal KERIpy-style contact organizer for remote identifier metadata.
 *
 * Current scope:
 * - exact alias lookup for EXN/challenge recipient resolution
 * - signed contact load/update for alias and OOBI fields
 * - no broader contact-management CLI surface yet
 */
export class Organizer {
  readonly hby: Habery;

  constructor(hby: Habery) {
    this.hby = hby;
  }

  /** Load one signed contact record by identifier prefix. */
  get(pre: string): ContactRecord | null {
    const raw = this.hby.db.cons.get([pre]);
    if (raw === null) {
      return null;
    }

    const cigar = this.hby.db.ccigs.get([pre]);
    if (cigar && this.hby.signator && !verifySignedContact(this.hby, raw, cigar)) {
      throw new ValidationError(`failed signature on ${pre} contact data`);
    }

    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed) {
      return null;
    }
    return { id: pre, ...parsed };
  }

  /**
   * Merge one partial contact update into the signed contact record.
   *
   * Field-index storage is intentionally limited to scalar string values in
   * this slice because EXN/challenge parity currently needs exact alias lookup
   * and OOBI URL recall, not arbitrary structured contact search.
   */
  update(
    pre: string,
    data: Record<string, unknown>,
  ): void {
    const signator = this.hby.signator;
    if (!signator) {
      throw new ValidationError(
        "Contact updates require an available habery signator.",
      );
    }

    const current = this.get(pre);
    const next = { ...(current ?? {}), ...data };
    delete next.id;

    const raw = JSON.stringify(next);
    this.hby.db.cons.pin([pre], raw);
    this.hby.db.ccigs.pin([pre], signator.sign(textEncoder.encode(raw)));

    for (const [field, value] of Object.entries(data)) {
      if (value === undefined || value === null) {
        continue;
      }
      this.hby.db.cfld.pin([pre, field], String(value));
    }
  }

  /** Find contacts whose indexed field exactly equals the provided value. */
  findExact(field: string, value: string): ContactRecord[] {
    const matches: ContactRecord[] = [];
    for (const [keys, current] of this.hby.db.cfld.getTopItemIter()) {
      const pre = keys[0];
      const currentField = keys[1];
      if (!pre || currentField !== field || current !== value) {
        continue;
      }
      const contact = this.get(pre);
      if (contact) {
        matches.push(contact);
      }
    }
    return matches;
  }
}

function verifySignedContact(
  hby: Habery,
  raw: string,
  cigar: Cigar,
): boolean {
  const signator = hby.signator;
  if (!signator) {
    return true;
  }
  return signator.verify(textEncoder.encode(raw), cigar);
}

/** Persist minimal alias/OOBI contact state once one remote AID resolves. */
export function persistResolvedContact(
  hby: Habery,
  pre: string | null | undefined,
  data: {
    alias?: string | null;
    oobi?: string | null;
  },
): void {
  if (!pre || !hby.signator) {
    return;
  }

  const next: Record<string, unknown> = {};
  if (typeof data.alias === "string" && data.alias.length > 0) {
    next.alias = data.alias;
  }
  if (typeof data.oobi === "string" && data.oobi.length > 0) {
    next.oobi = data.oobi;
  }
  if (Object.keys(next).length === 0) {
    return;
  }

  new Organizer(hby).update(pre, next);
}

/** Debug helper kept local so organizer serialization stays reviewable. */
export function signedContactJson(
  hby: Habery,
  pre: string,
): string | null {
  const raw = hby.db.cons.get([pre]);
  return raw === null ? null : textDecoder.decode(textEncoder.encode(raw));
}
