import type { CounterGroupLike } from "../primitives/base/primitive.ts";
import type { Texter } from "../primitives/values/texter.ts";
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
export type ColdCode = "msg" | CesrDomain | "ano";

/** CESR text (qb64) or binary (qb2) encoding domain. */
export type CesrDomain = "txt" | "bny";

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
}

/** Trailing attachment group parsed after a frame body. */
export interface AttachmentGroup extends CounterGroupLike {}

/** One complete message and its parent-owned evidence. Ordinary values need no disposal. */
export interface CesrFrame {
  body: CesrBody;
  attachments: AttachmentGroup[];
  /** Resolved attachment genus; parser results always supply it. */
  gvrsn?: Versionage;
  /** Children belong to this message, never independent stream deliveries. */
  nests?: CesrFrame[];
  /** Ordered qualified ESSR fragments; ordinary attachments exclude these groups. */
  essrs?: Texter[];
}
