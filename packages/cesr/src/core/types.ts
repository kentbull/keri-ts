import type { Kind, Protocol } from "../tables/versions.ts";
import type { Versionage } from "../tables/table-types.ts";

export interface Smellage {
  proto: Protocol;
  pvrsn: Versionage;
  kind: Kind;
  size: number;
  gvrsn: Versionage | null;
}

export type ColdCode = "msg" | "txt" | "bny" | "ano";

/**
 * The body of a CESR message, an envelope for a Serder KERI or ACDC payload.
 */
export interface CesrBody {
  /** The raw bytes of the body. */
  raw: Uint8Array;
  /**
   * The "key event dictionary" of the parsed bytes. Insertion ordered dictionary of fields.
   */
  ked: Record<string, unknown> | null;
  /** Serialization kind of the body. */
  kind: Kind;
  /** The size of the body in bytes. */
  size: number;
  /** The protocol of the body. */
  proto: Protocol;
  /** The protocol version of the body. */
  pvrsn: Versionage;
  /** The genus version of the body. */
  gvrsn: Versionage | null;
  /** The event type of the body. */
  ilk: string | null;
  /** The SAID of the body. */
  said: string | null;
  /** The native fields of the body. */
  native?: {
    /** The body code of the native fields. */
    bodyCode: string;
    /** The fields of the native fields. */
    fields: Array<{ label: string | null; code: string; qb64: string }>;
  };
}

/** Discriminated model for one parsed attachment payload unit. */
export type AttachmentItem =
  | AttachmentQb64Item
  | AttachmentQb2Item
  | AttachmentTupleItem
  | AttachmentNestedGroupItem;

/** Text-domain unit (single qb64 token or opaque quadlet). */
export interface AttachmentQb64Item {
  kind: "qb64";
  qb64: string;
  opaque: boolean;
}

/** Binary-domain unit (single qb2 token or opaque triplet). */
export interface AttachmentQb2Item {
  kind: "qb2";
  qb2: Uint8Array;
  opaque: boolean;
}

/** Tuple/repeated payload unit preserving source ordering. */
export interface AttachmentTupleItem {
  kind: "tuple";
  items: AttachmentItem[];
}

/** Wrapper-enclosed nested group summary. */
export interface AttachmentNestedGroupItem {
  kind: "group";
  code: string;
  name: string;
  count: number;
}

/**
 * CESR attachment group that comes after a CESR body.
 */
export interface AttachmentGroup {
  code: string;
  name: string;
  count: number;
  raw: Uint8Array;
  items: AttachmentItem[];
}

/**
 * A single unit of parsed CESR data including message and attachments.
 */
export interface CesrMessage {
  body: CesrBody;
  attachments: AttachmentGroup[];
}

/**
 * State of the CESR parser engine.
 * Contains the buffer of bytes to be parsed and the current offset.
 */
export interface ParserState {
  buffer: Uint8Array;
  offset: number;
}

/**
 * A single frame of parsed CESR data containing either a successfully parsed message or error.
 */
export type CesrFrame =
  | { type: "frame"; frame: CesrMessage }
  | { type: "error"; error: Error };
