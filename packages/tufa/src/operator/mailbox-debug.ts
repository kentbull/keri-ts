/**
 * Mailbox operator debug report collection.
 *
 * The CLI renders the returned report. This module owns the mailbox state scan,
 * cursor projection, remote `mbx` query, and SSE parsing used by the debug
 * command without printing directly.
 */
import type { Operation } from "effection";
import {
  buildCesrRequest,
  type CesrBodyMode,
  fetchEndpointUrls,
  fetchResponseHandle,
  type Hab,
  type Habery,
  Organizer,
  preferredUrl,
  readMailboxSseBody,
  Roles,
  ValidationError,
} from "keri-ts/runtime";

export interface ConfiguredMailboxRow {
  alias: string;
  eid: string;
  url: string;
}

export interface OutboxPendingRow {
  topic: string;
  eid: string;
  attempts: number;
}

export interface MailboxSseRow {
  idx: number;
  topic: string;
  msg: string;
}

export interface MailboxDebugReport {
  configuredMailboxes: ConfiguredMailboxRow[];
  localTopics: Record<string, number> | null;
  outboxEnabled: boolean;
  outboxPending: OutboxPendingRow[];
  messages: MailboxSseRow[] | null;
}

/** Collect local and remote mailbox debug state for one selected controller. */
export function* collectMailboxDebugReport(
  hby: Habery,
  hab: Hab,
  witness: string,
): Operation<MailboxDebugReport> {
  const configuredMailboxes = collectConfiguredMailboxes(hby, hab);
  const witrec = hby.db.tops.get([hab.pre, witness]);
  const localTopics = witrec ? { ...witrec.topics } : null;
  const outboxPending = collectOutboxPending(hby, witness);
  const endpointUrl = preferredUrl(fetchEndpointUrls(hby, witness));
  let messages: MailboxSseRow[] | null = null;

  if (endpointUrl) {
    const topics = localTopics ?? {
      "/challenge": 0,
      "/reply": 0,
      "/receipt": 0,
      "/replay": 0,
    };
    const cursor: Record<string, number> = {};
    for (const [topic, idx] of Object.entries(topics)) {
      cursor[topic] = idx + 1;
    }

    const response = yield* fetchMailboxDebug(
      endpointUrl,
      hab.query(hab.pre, witness, { topics: cursor }, "mbx"),
      hby.cesrBodyMode,
      witness,
    );
    messages = parseMailboxSse(response);
  }

  return {
    configuredMailboxes,
    localTopics,
    outboxEnabled: hby.obx.enabled,
    outboxPending,
    messages,
  };
}

/** Collect accepted mailbox endpoint-role rows for text/list rendering. */
export function collectConfiguredMailboxes(
  hby: Habery,
  hab: Hab,
): ConfiguredMailboxRow[] {
  const organizer = new Organizer(hby);
  const rows: ConfiguredMailboxRow[] = [];
  for (
    const [keys, end] of hby.db.ends.getTopItemIter([hab.pre, Roles.mailbox], {
      topive: true,
    })
  ) {
    const eid = keys[2];
    if (!eid || !end.allowed) {
      continue;
    }
    const contact = organizer.get(eid);
    rows.push({
      alias: typeof contact?.alias === "string" ? contact.alias : "",
      eid,
      url: preferredUrl(fetchEndpointUrls(hby, eid)) ?? "",
    });
  }
  return rows;
}

/** Normalize CLI topic input into the stored mailbox topic form. */
export function normalizeMailboxTopic(topic: string): string {
  return topic.startsWith("/") ? topic : `/${topic}`;
}

function collectOutboxPending(
  hby: Habery,
  witness: string,
): OutboxPendingRow[] {
  if (!hby.obx.enabled) {
    return [];
  }
  const rows: OutboxPendingRow[] = [];
  for (const pending of hby.obx.iterPending()) {
    if (pending.target.eid !== witness) {
      continue;
    }
    rows.push({
      topic: pending.message.topic,
      eid: pending.target.eid,
      attempts: pending.target.attempts ?? 0,
    });
  }
  return rows;
}

function* fetchMailboxDebug(
  url: string,
  query: Uint8Array,
  bodyMode: CesrBodyMode,
  destination: string,
): Operation<string> {
  const request = buildCesrRequest(query, {
    bodyMode,
    destination,
  });
  const { response, controller } = yield* fetchResponseHandle(url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) {
    throw new ValidationError(
      `Mailbox debug query failed with HTTP ${response.status}.`,
    );
  }

  return yield* readMailboxSseBody(response, controller, {
    idleTimeoutMs: 500,
    maxDurationMs: 5_000,
  });
}

function parseMailboxSse(text: string): MailboxSseRow[] {
  const messages: MailboxSseRow[] = [];
  for (const block of text.split("\n\n")) {
    if (block.trim().length === 0) {
      continue;
    }
    let idx = -1;
    let topic = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) {
        idx = Number(line.slice(3).trim());
      } else if (line.startsWith("event:")) {
        topic = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (idx >= 0 && topic.length > 0 && data.length > 0) {
      messages.push({ idx, topic, msg: data.join("\n") });
    }
  }
  return messages;
}
