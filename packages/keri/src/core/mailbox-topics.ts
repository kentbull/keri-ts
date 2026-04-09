/**
 * Shared mailbox topic and cursor types.
 *
 * These types keep the mailbox query and streaming contract explicit:
 * configured topics are human-facing lists, while runtime work uses cursor maps
 * keyed by topic name and storing the next wanted mailbox index.
 */

/** Raw delegated event mailbox topic used for delegation approval flows. */
export const DELEGATE_MAILBOX_TOPIC = "/delegate";
/** Peer OOBI request mailbox topic used by KERIpy `/oobis` EXNs. */
export const OOBI_MAILBOX_TOPIC = "/oobi";
/**
 * Configured mailbox topic names for one poll or subscription setup.
 *
 * KERIpy correspondence:
 * - this matches the configured `self.topics` list used by mailbox pollers
 *   before they are expanded into per-topic cursors for an `mbx` query
 */
export type MbxTopics = readonly string[];

/**
 * Per-topic mailbox cursor positions for `mbx` queries and stream cues.
 *
 * KERIpy correspondence:
 * - mirrors the `topics` dict in `mbx` queries where each topic maps to the
 *   next mailbox index the requester wants to read
 */
export type MbxTopicCursor = Record<string, number>;

/**
 * Boundary-input mailbox topic shape accepted before runtime normalization.
 *
 * Use this only at ingress seams that may accept either configured topic names
 * or a precomputed mailbox cursor map. Runtime query and stream logic should
 * use `MbxTopicCursor` directly.
 */
export type MbxTopicSpec = MbxTopics | MbxTopicCursor;

/** Normalize mailbox topic input into the KERIpy-style cursor map shape. */
export function normalizeMbxTopicCursor(
  value: MbxTopicSpec,
): MbxTopicCursor;
export function normalizeMbxTopicCursor(
  value: unknown,
): MbxTopicCursor;
export function normalizeMbxTopicCursor(
  value: unknown,
): MbxTopicCursor {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((topic): topic is string => typeof topic === "string")
        .map((topic) => [topic, 0]),
    );
  }

  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([topic]) => typeof topic === "string")
      .map(([topic, idx]) => [topic, typeof idx === "number" ? idx : Number(idx) || 0]),
  );
}
