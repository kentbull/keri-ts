import type { ColdCode } from "../core/types.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import type { Versionage } from "../tables/table-types.ts";

/** Attachment dispatch fallback is only defined for counter domains. */
export type AttachmentDispatchDomain = Extract<ColdCode, "txt" | "bny">;
/** Named presets for default attachment fallback strategy behavior. */
export type AttachmentDispatchMode = "strict" | "compat";

/** Structured info emitted when compat fallback crosses major versions. */
export interface VersionFallbackInfo {
  /** Version used for the failed primary dispatch attempt. */
  from: Versionage;
  /** Version selected for retry by compat policy. */
  to: Versionage;
  /** Parse domain where fallback occurred (`txt` qb64 or `bny` qb2). */
  domain: AttachmentDispatchDomain;
  /** Root parse failure message from the primary attempt. */
  reason: string;
}

/**
 * Policy decision for versioned attachment dispatch failure handling.
 *
 * `throw`:
 * - preserve strict fail-fast behavior.
 *
 * `retry`:
 * - perform one alternate-major retry and surface structured fallback info.
 */
export type VersionDispatchDecision =
  | { action: "throw" }
  | {
    action: "retry";
    retryVersion: Versionage;
    info: VersionFallbackInfo;
  };

/**
 * Strategy interface for strict/compat dispatch fallback and wrapper recovery
 * semantics.
 */
export interface AttachmentVersionFallbackPolicy {
  /**
   * Decide whether a versioned dispatch failure should rethrow or retry.
   *
   * Why this exists:
   * keeps strict-vs-compat behavior out of parser control flow so policy can be
   * injected and validated independently.
   */
  onVersionDispatchFailure(
    error: Error,
    version: Versionage,
    domain: AttachmentDispatchDomain,
  ): VersionDispatchDecision;
  /**
   * Observe accepted fallback decisions (callback/telemetry/warning hook).
   *
   * Why this exists:
   * dispatch logic should not hardcode observability side effects.
   */
  onVersionFallback(info: VersionFallbackInfo): void;
  /**
   * Decide whether wrapper nested parse errors should preserve opaque remainder.
   *
   * Why this exists:
   * strict mode must fail on malformed wrapper tails; compat mode intentionally
   * keeps opaque remainder to preserve real-world stream tolerance.
   */
  shouldPreserveWrapperRemainder(error: Error): boolean;
}

/** Legacy strict/compat configuration inputs for policy construction. */
export interface AttachmentVersionFallbackPolicyOptions {
  /** Legacy strict/compat selector used only when no explicit policy is supplied. */
  mode?: AttachmentDispatchMode;
  /** Optional callback invoked when compat policy accepts a major-version retry. */
  onVersionFallback?: (info: VersionFallbackInfo) => void;
}

/**
 * Classify parse failures that are safe for alternate-major retry.
 *
 * Why:
 * only unknown-code and deserialize failures are treated as compatibility
 * boundaries; structural/boundary errors should remain fail-fast.
 */
function isVersionFallbackError(error: Error): boolean {
  return error instanceof UnknownCodeError || error instanceof DeserializeError;
}

/**
 * Compute one-step alternate-major retry target.
 *
 * Why:
 * compat behavior intentionally toggles between v1 and v2 majors and does not
 * perform multi-step or minor-version search.
 */
function alternateMajorVersion(version: Versionage): Versionage {
  return version.major >= 2 ? { major: 1, minor: 0 } : { major: 2, minor: 0 };
}

/**
 * Strict fallback policy.
 *
 * What:
 * - no version retry
 * - no wrapper opaque-tail recovery
 *
 * Why:
 * strict mode is intended for parity/fail-fast validation where ambiguous
 * compatibility recovery must not hide malformed or mixed-major input.
 */
class StrictAttachmentVersionFallbackPolicy
  implements AttachmentVersionFallbackPolicy {
  /**
   * Always reject retry and preserve original error.
   *
   * Why `throw`:
   * strict policy must not reinterpret unknown/deserialize failures as
   * compatibility drift.
   */
  onVersionDispatchFailure(
    _error: Error,
    _version: Versionage,
    _domain: AttachmentDispatchDomain,
  ): VersionDispatchDecision {
    return { action: "throw" };
  }

  /**
   * No-op fallback observer.
   *
   * Why:
   * strict policy never accepts fallback; observer is intentionally inert.
   */
  onVersionFallback(_info: VersionFallbackInfo): void {
    // Strict policy never falls back; this is intentionally a no-op.
  }

  /**
   * Disable wrapper opaque remainder preservation.
   *
   * Why `false`:
   * strict mode must expose nested wrapper parse failures directly.
   */
  shouldPreserveWrapperRemainder(_error: Error): boolean {
    return false;
  }
}

/**
 * Compatibility fallback policy.
 *
 * What:
 * - retry unknown/deserialize failures on alternate major version
 * - preserve unread wrapper remainder as opaque payload on recoverable errors
 *
 * Why:
 * interop streams in the ecosystem can mix major-version counters/payloads, and
 * compat mode intentionally favors successful parse continuity.
 */
class CompatAttachmentVersionFallbackPolicy
  implements AttachmentVersionFallbackPolicy {
  private readonly fallbackObserver?: (info: VersionFallbackInfo) => void;

  /**
   * @param fallbackObserver Optional callback for accepted fallback events.
   */
  constructor(fallbackObserver?: (info: VersionFallbackInfo) => void) {
    this.fallbackObserver = fallbackObserver;
  }

  /**
   * Retry only for compatibility-classified failures.
   *
   * Why conditional:
   * unknown/deserialize errors often indicate major-table mismatch; other error
   * classes generally represent structural issues that should not be retried.
   */
  onVersionDispatchFailure(
    error: Error,
    version: Versionage,
    domain: AttachmentDispatchDomain,
  ): VersionDispatchDecision {
    if (!isVersionFallbackError(error)) {
      return { action: "throw" };
    }
    const retryVersion = alternateMajorVersion(version);
    return {
      action: "retry",
      retryVersion,
      info: {
        from: version,
        to: retryVersion,
        domain,
        reason: error.message,
      },
    };
  }

  /**
   * Emit fallback event through optional callback.
   *
   * Why:
   * keeps observability side effects caller-controlled.
   */
  onVersionFallback(info: VersionFallbackInfo): void {
    this.fallbackObserver?.(info);
  }

  /**
   * Preserve unread wrapper payload as opaque units.
   *
   * Why `true`:
   * compat mode intentionally tolerates nested wrapper irregularities and
   * retains undecoded remainder for downstream visibility.
   */
  shouldPreserveWrapperRemainder(_error: Error): boolean {
    return true;
  }
}

/**
 * Build default fallback strategy from legacy options.
 *
 * Why:
 * preserves backward-compatible `mode` API while allowing explicit policy
 * injection for new call sites.
 */
export function createAttachmentVersionFallbackPolicy(
  options: AttachmentVersionFallbackPolicyOptions = {},
): AttachmentVersionFallbackPolicy {
  const mode = options.mode ?? "compat";
  return mode === "strict"
    ? new StrictAttachmentVersionFallbackPolicy()
    : new CompatAttachmentVersionFallbackPolicy(options.onVersionFallback);
}
