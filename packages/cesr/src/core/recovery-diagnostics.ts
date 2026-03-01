import type { Versionage } from "../tables/table-types.ts";

/** Attachment-dispatch recovery can only occur in counter domains. */
export type RecoveryDispatchDomain = "txt" | "bny";

/** Backward-compatible fallback callback payload shape. */
export interface RecoveryVersionFallbackInfo {
  from: Versionage;
  to: Versionage;
  domain: RecoveryDispatchDomain;
  reason: string;
}

/** Version-retry fallback accepted in attachment dispatch. */
export interface VersionFallbackAcceptedDiagnostic {
  type: "version-fallback-accepted";
  from: Versionage;
  to: Versionage;
  domain: RecoveryDispatchDomain;
  reason: string;
}

/** Version-retry fallback rejected in attachment dispatch. */
export interface VersionFallbackRejectedDiagnostic {
  type: "version-fallback-rejected";
  version: Versionage;
  domain: RecoveryDispatchDomain;
  errorName: string;
  reason: string;
}

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
  | VersionFallbackAcceptedDiagnostic
  | VersionFallbackRejectedDiagnostic
  | WrapperOpaqueTailPreservedDiagnostic
  | ParserErrorResetDiagnostic;

/** Observer contract for structured recovery diagnostics. */
export type RecoveryDiagnosticObserver = (
  diagnostic: RecoveryDiagnostic,
) => void;

/**
 * Compose diagnostics and legacy fallback callback observers.
 *
 * Why:
 * keeps compatibility with legacy fallback callbacks while normalizing
 * observability through one structured diagnostics stream.
 */
export function composeRecoveryDiagnosticObserver(options: {
  onRecoveryDiagnostic?: RecoveryDiagnosticObserver;
  onAttachmentVersionFallback?: (info: RecoveryVersionFallbackInfo) => void;
} = {}): RecoveryDiagnosticObserver | undefined {
  const {
    onRecoveryDiagnostic,
    onAttachmentVersionFallback,
  } = options;

  if (!onRecoveryDiagnostic && !onAttachmentVersionFallback) {
    return undefined;
  }

  return (diagnostic: RecoveryDiagnostic): void => {
    onRecoveryDiagnostic?.(diagnostic);
    if (diagnostic.type !== "version-fallback-accepted") {
      return;
    }
    onAttachmentVersionFallback?.({
      from: diagnostic.from,
      to: diagnostic.to,
      domain: diagnostic.domain,
      reason: diagnostic.reason,
    });
  };
}
