/** Map application routes to mailbox topics: queries use slash form; /fwd modifiers use bare form. */
import {
  CREDENTIAL_MAILBOX_TOPIC,
  DELEGATE_MAILBOX_TOPIC,
  OOBI_MAILBOX_TOPIC,
} from "../../core/mailbox/mailbox-topics.ts";

/**
 * Derive the default mailbox topic from the first non-empty route segment.
 *
 * @param route Exchange route whose first nonempty segment chooses the mailbox topic.
 * @returns Derived topic under the existing route mapping.
 */
function defaultTopicForRoute(route: string): string {
  if (route.startsWith("/delegate")) {
    return DELEGATE_MAILBOX_TOPIC;
  }
  if (route === "/oobis") {
    return OOBI_MAILBOX_TOPIC;
  }
  if (route.startsWith("/ipex/")) {
    return CREDENTIAL_MAILBOX_TOPIC;
  }
  const trimmed = route.replace(/^\/+/, "");
  return trimmed.split("/")[0] ?? "";
}

/**
 * KERIpy pollers query protocol mailbox topics with a leading slash.
 *
 * @param topic Protocol mailbox topic; leading slash is normalized where required.
 * @returns Slash-prefixed query topic.
 */
function pollMailboxTopic(topic: string): string {
  if (topic.length === 0 || topic.startsWith("/")) {
    return topic;
  }
  return `/${topic}`;
}

/**
 * KERIpy `/fwd` modifiers use the bare topic name, e.g. `multisig`.
 *
 * @param topic Protocol mailbox topic; leading slash is normalized where required.
 * @returns Bare /fwd modifier topic.
 */
export function transportMailboxTopic(topic: string): string {
  return topic.replace(/^\/+/, "");
}

/**
 * Public helper for deriving mailbox topic defaults from one EXN route.
 *
 * This stays exported because CLI and runtime call sites both need one shared
 * answer for "which mailbox topic should this route land in by default?"
 *
 * @param route Exchange route whose first nonempty segment chooses the mailbox topic.
 * @returns Derived topic under the existing route mapping.
 */
export function mailboxTopicForRoute(route: string): string {
  return pollMailboxTopic(defaultTopicForRoute(route));
}
