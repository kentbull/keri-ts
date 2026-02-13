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

export interface SerderEnvelope {
  raw: Uint8Array;
  ked: Record<string, unknown> | null;
  proto: Protocol;
  kind: Kind;
  size: number;
  pvrsn: Versionage;
  gvrsn: Versionage | null;
  ilk: string | null;
  said: string | null;
}

export interface AttachmentGroup {
  code: string;
  name: string;
  count: number;
  raw: Uint8Array;
  items: unknown[];
}

export interface CesrFrame {
  serder: SerderEnvelope;
  attachments: AttachmentGroup[];
}

export interface ParserState {
  buffer: Uint8Array;
  offset: number;
}

export type ParseEmission =
  | { type: "frame"; frame: CesrFrame }
  | { type: "error"; error: Error };
