import type { Versionage } from "../tables/table-types.ts";

/** Attachment-dispatch recovery can only occur in counter domains. */
export type RecoveryDispatchDomain = "txt" | "bny";

/** Wrapper nested parse failure recovered by preserving opaque tail units. */
export interface WrapperOpaqueTailPreservedDiagnostic {
  type: "wrapper-opaque-tail-preserved";
  version: Versionage;
  domain: RecoveryDispatchDomain;
  wrapperCode: string;
  opaqueItemCount: number;
  errorName: string;
  reason: string;
}

/** Parser non-shortage error handling path that emits error + reset. */
export interface ParserErrorResetDiagnostic {
  type: "parser-error-reset";
  offset: number;
  errorName: string;
  reason: string;
}

/** Structured recovery diagnostics union for parser/dispatch observability. */
export type RecoveryDiagnostic =
  | WrapperOpaqueTailPreservedDiagnostic
  | ParserErrorResetDiagnostic;

/** Observer contract for structured recovery diagnostics. */
export type RecoveryDiagnosticObserver = (
  diagnostic: RecoveryDiagnostic,
) => void;
