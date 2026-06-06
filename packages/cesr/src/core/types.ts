import type { CounterGroupLike, GroupEntry, Primitive } from "../primitives/primitive.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { Kind, Protocol } from "../tables/versions.ts";

/** Version metadata discovered from one version string or native pre-read. */
export interface Smellage {
  proto: Protocol;
  pvrsn: Versionage;
  kind: Kind;
  size: number;
  gvrsn: Versionage | null;
}

/** Parser cold-start domain classification for the next unread stream bytes. */
export type ColdCode = "msg" | "txt" | "bny" | "ano";

/** Body payload for one parsed CESR frame. */
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
    /** Parsed native fields as hydrated primitives. */
    fields: Array<{ label: string | null; primitive: Primitive }>;
  };
}

/** One parsed attachment-group entry. */
export type AttachmentItem = GroupEntry;

/** Trailing attachment group parsed after a frame body. */
export interface AttachmentGroup extends CounterGroupLike {}

/**
 * Historical public type name for one parsed frame payload.
 *
 * Terminology note: parser docs use "frame" for the emitted unit
 * (`body` + trailing `attachments`), while this exported type name
 * remains `CesrMessage` for backward compatibility.
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

/** Parser stream event union: parsed frame payload or parse error. */
export type CesrFrame =
  | { type: "frame"; frame: CesrMessage }
  | { type: "error"; error: Error };
