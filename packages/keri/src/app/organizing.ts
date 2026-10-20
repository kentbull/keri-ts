import { type Cigar } from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import type { Baser } from "../db/basing.ts";
import type { Habery, Signator } from "./habbing.ts";

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
  /** Borrow contact storage and its optional signing authority without owning their lifetime. */
  constructor(readonly db: Baser, readonly signator: Signator | null) {}

  /**
   * Resolve one application recipient input into the actual destination prefix.
   *
   * Resolution order matches the mailbox CLI mental model:
   * - exact known prefix wins
   * - otherwise exact organizer alias lookup is required
   *
   * @param recipient Known AID prefix or exact organizer alias.
   * @returns Resolved destination AID.
   * @throws ValidationError for absent or ambiguous aliases.
   */
  resolveRecipient(recipient: string): string {
    if (this.db.getKever(recipient)) {
      return recipient;
    }

    const matches = this.findExact("alias", recipient);
    if (matches.length === 0) {
      throw new ValidationError(`no contact found with alias '${recipient}'`);
    }
    if (matches.length > 1) {
      throw new ValidationError(
        `multiple contacts match alias '${recipient}', use prefix instead`,
      );
    }

    return matches[0]!.id;
  }

  /** Load one signed contact record by identifier prefix. */
  get(pre: string): ContactRecord | null {
    const raw = this.db.cons.get([pre]);
    if (raw === null) {
      return null;
    }

    const cigar = this.db.ccigs.get([pre]);
    if (
      cigar && this.signator && !verifySignedContact(this.signator, raw, cigar)
    ) {
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
    const signator = this.signator;
    if (!signator) {
      throw new ValidationError(
        "Contact updates require an available habery signator.",
      );
    }

    const current = this.get(pre);
    const next = { ...(current ?? {}), ...data };
    delete next.id;

    const raw = JSON.stringify(next);
    this.db.cons.pin([pre], raw);
    this.db.ccigs.pin([pre], signator.sign(textEncoder.encode(raw)));

    for (const [field, value] of Object.entries(data)) {
      if (value === undefined || value === null) {
        continue;
      }
      this.db.cfld.pin([pre, field], String(value));
    }
  }

  /** Find contacts whose indexed field exactly equals the provided value. */
  findExact(field: string, value: string): ContactRecord[] {
    const matches: ContactRecord[] = [];
    for (const [keys, current] of this.db.cfld.getTopItemIter()) {
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
  signator: Signator,
  raw: string,
  cigar: Cigar,
): boolean {
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

  new Organizer(hby.db, hby.signator).update(pre, next);
}

/** Debug helper kept local so organizer serialization stays reviewable. */
export function signedContactJson(
  db: Baser,
  pre: string,
): string | null {
  const raw = db.cons.get([pre]);
  return raw === null ? null : textDecoder.decode(textEncoder.encode(raw));
}
