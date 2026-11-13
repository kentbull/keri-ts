/**
 * Transport probes, bundled into the page and run in each engine. Every probe drives keri-ts's own
 * request builders (`FetchHttpClient`, `HTTPMessenger`, `HTTPStreamMessenger`, `sendWitnessMessage`,
 * `Poster`, `MailboxPoller`) from a page on another origin, so CORS applies for real. A probe
 * reports a normalized `observed` string, which the expectation table compares; `detail` is the
 * engine-specific evidence printed in the report.
 */

import { concatBytes, type Versionage, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run, sleep, spawn } from "npm:effection@^3.6.0";
import { Poster } from "../../src/app/delivery/forwarding.ts";
import { acceptedEventReplayMessage, type Hab, type Habery, openHabery } from "../../src/app/identity/habbing.ts";
import { collectKelSubmission } from "../../src/app/mailbox/kel-submission.ts";
import { postMailboxAdminCesr, postMailboxAdminMultipart } from "../../src/app/mailbox/mailbox-admin.ts";
import { MailboxDirector } from "../../src/app/mailbox/mailbox-director.ts";
import { MailboxPoller } from "../../src/app/mailbox/mailbox-poller.ts";
import { systemClock } from "../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../src/app/transport/http-client.ts";
import { HTTPMessenger } from "../../src/app/transport/http-messenger.ts";
import { HTTPStreamMessenger } from "../../src/app/transport/http-stream-messenger.ts";
import { TransportError } from "../../src/app/transport/transport-error.ts";
import { sendWitnessMessage } from "../../src/app/witness/receipt-client.ts";
import { exchange } from "../../src/core/exchange/protocol-exchanging.ts";
import { Roles } from "../../src/core/roles.ts";
import { indexedDbOpener } from "../../src/db/indexeddb.ts";

export type ServerName = "keripy" | "tufa" | "echo";
export interface ServerConfig {
  origin: string;
  /** Witness (KERIpy) or mailbox (Tufa) AID; unused for the echo server. */
  pre: string;
}
/** Server endpoints, plus an optional `only` pattern selecting probes as `probe|server` (for debugging). */
export type Config = Record<ServerName, ServerConfig> & { only?: string };
export interface ProbeResult {
  probe: string;
  server: ServerName;
  ok: boolean;
  observed: string;
  detail: string;
}
type Outcome = Pick<ProbeResult, "ok" | "observed"> & { detail?: string };

const http = new FetchHttpClient();
const text = new TextDecoder();
/** Headers keri-ts or the servers use, each tested for readability from the page. */
const HEADER_NAMES = ["content-type", "keri-aid", "oobi-aid", "cesr-attachment", "cesr-genus", "content-length"];

/**
 * Run an operation with a deadline so a hung engine fails the probe instead of the lane: halt it at
 * `ms`, and give up on it five seconds later if it will not even halt.
 */
async function within<T>(ms: number, operation: () => Operation<T>): Promise<T> {
  const task = run(operation);
  const timers: ReturnType<typeof setTimeout>[] = [setTimeout(() => task.halt(), ms)];
  const stuck = new Promise<never>((_, reject) => {
    timers.push(setTimeout(() => reject(new Error(`probe exceeded ${ms} ms and did not halt`)), ms + 5_000));
  });
  try {
    return await Promise.race([task, stuck]);
  } finally {
    timers.forEach(clearTimeout);
  }
}

/** Classify a thrown keri-ts transport failure as a browser-blocked request. */
function failure(error: unknown): Outcome {
  if (error instanceof TransportError) {
    return { ok: false, observed: "blocked", detail: String((error.cause as Error)?.message) };
  }
  return {
    ok: false,
    observed: "error",
    detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}

/** Report a CESR POST/PUT result: complete, a peer refusal with its status, or blocked. */
function sent(result: { kind: string; error?: { status: number } }): Outcome {
  return result.kind === "complete"
    ? { ok: true, observed: "delivered" }
    : { ok: false, observed: `refused HTTP ${result.error!.status}` };
}

/** One browser-side identity set for one server: a sender, a recipient and the recipient's mailbox route. */
interface Session {
  hby: Habery;
  sender: Hab;
  recipient: Hab;
  server: ServerConfig;
}

/** Open a Habery on real IndexedDB and incept sender and recipient habitats for `name`'s server. */
async function openSession(name: ServerName, server: ServerConfig): Promise<Session> {
  const hby = await run(() =>
    openHabery({
      name: `probe-${crypto.randomUUID()}`,
      opener: indexedDbOpener(),
      skipConfig: true,
      skipSignator: true,
    })
  );
  const keripy = name !== "tufa";
  // KERIpy's reference witness speaks v1; Tufa authors v2.
  const version: Versionage = keripy ? Vrsn_1_0 : Vrsn_2_0;
  const base = { transferable: true, icount: 1, isith: "1", ncount: 1, nsith: "1", version };
  const sender = hby.makeHab("sender", undefined, { ...base, toad: 0 });
  const recipient = hby.makeHab("recipient", undefined, {
    ...base,
    ...(keripy && server.pre ? { wits: [server.pre], toad: 1 } : { toad: 0 }),
  });
  if (server.pre) hby.db.locs.pin([server.pre, "http"], { url: `${server.origin}/` });
  if (name === "tufa") hby.db.ends.pin([recipient.pre, Roles.mailbox, server.pre], { allowed: true });
  return { hby, sender, recipient, server };
}

/** Replay bytes of the habitat's inception: the message a witness or mailbox first receives. */
function inception(s: Session, hab: Hab): Uint8Array {
  return acceptedEventReplayMessage(s.hby, hab.pre, 0, hab.kelVersion).message;
}

/** Deliver one signed message A -> B through `Poster` on `topic`; resolves to the delivery outcome. */
function* post(s: Session, topic: string, msg: Uint8Array, dest = s.recipient.pre): Operation<Outcome> {
  const poster = new Poster(s.hby, null, null, http, systemClock, null);
  const worker = yield* spawn(() => poster.deliverDo());
  try {
    const outcome = yield* poster.wait(
      poster.send({ src: s.sender.pre, dest, topic, msg }, { notify: true }),
    );
    return outcome.kin === "sent" ? { ok: true, observed: "posted" } : failure(outcome.error);
  } finally {
    yield* worker.halt();
    yield* poster.close();
  }
}

/** Poll the recipient's mailbox with the real `MailboxPoller` until `topic` yields a message or `ms` pass. */
function* poll(
  s: Session,
  topic: string,
  recipient = s.recipient.pre,
  ms = 20_000,
): Operation<{ messages: number; cursor: number | undefined }> {
  const director = new MailboxDirector(s.hby, { topics: [topic] });
  const poller = new MailboxPoller(s.hby, director, http, systemClock, null);
  let messages = 0;
  const worker = yield* spawn(() =>
    poller.pollDo(function*(batch) {
      if (batch.pre === recipient) messages += batch.messages.length;
    })
  );
  try {
    for (const end = Date.now() + ms; messages === 0 && Date.now() < end;) yield* sleep(100);
  } finally {
    yield* worker.halt();
  }
  return { messages, cursor: s.hby.db.tops.get([recipient, s.server.pre])?.topics[topic] };
}

/** A signed message whose mailbox topic is `topic`; the content only has to be genuine and verifiable. */
function message(s: Session, topic: string): Uint8Array {
  const a = s.sender;
  if (topic === "/reply") return a.makeEndRole(a.pre, Roles.controller, true);
  if (topic === "/receipt") return a.receipt(s.recipient.kever!.serder);
  const route = topic === "/multisig" ? "/multisig/vcp" : "/ipex/offer";
  return a.endorse(exchange(route, {}, { sender: a.pre, pvrsn: a.kelVersion })[0], { pipelined: false });
}

/** Mailbox administration through the library's two request builders: CESR body, or multipart form. */
function* admin(s: Session, hab: Hab, form: "cesr" | "multipart"): Operation<Outcome> {
  const submission = collectKelSubmission(s.hby, hab.pre);
  const rpy = hab.makeEndRole(s.server.pre, Roles.mailbox, true);
  const { origin, pre } = s.server;
  const response = form === "cesr"
    ? yield* postMailboxAdminCesr(http, origin, pre, concatBytes(submission.replay, rpy))
    : yield* postMailboxAdminMultipart(http, origin, pre, submission, rpy);
  return { ok: response.ok, observed: `HTTP ${response.status}`, detail: response.body.slice(0, 100) };
}

/** A third identifier authorized through the multipart form receives a message end to end. */
function* multipartDelivery(s: Session): Operation<Outcome> {
  const late = s.hby.makeHab("late", undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
  s.hby.db.ends.pin([late.pre, Roles.mailbox, s.server.pre], { allowed: true });
  const authorized = yield* admin(s, late, "multipart");
  if (!authorized.ok) return authorized;
  const posted = yield* post(s, "/reply", message(s, "/reply"), late.pre);
  if (!posted.ok) return posted;
  const polled = yield* poll(s, "/reply", late.pre);
  return {
    ok: polled.messages > 0,
    observed: polled.messages > 0 ? "delivered" : "not delivered",
    detail: `cursor ${polled.cursor}`,
  };
}

/** Read the recipient's mailbox topic: post one message, poll it, then prove the stored cursor skips it. */
function* topic(s: Session, name: string): Operation<Outcome> {
  const posted = yield* post(s, name, message(s, name));
  if (!posted.ok) return posted;
  const first = yield* poll(s, name);
  return {
    ok: first.messages > 0,
    observed: first.messages > 0 ? "delivered" : "not delivered",
    detail: `cursor ${first.cursor}`,
  };
}

/**
 * After a delivery, a fresh poller resumes from the stored cursor: a poll with nothing newer replays
 * nothing and ends idle (halting an idle poll is what hung WebKit), then a newer message arrives alone.
 */
function* resume(s: Session): Operation<Outcome> {
  const before = (yield* poll(s, "/reply", s.recipient.pre, 2_000)).messages;
  yield* post(s, "/reply", s.sender.makeEndRole(s.sender.pre, Roles.agent, true));
  const after = yield* poll(s, "/reply");
  return {
    ok: before === 0 && after.messages === 1,
    observed: `replayed ${before}, new ${after.messages}`,
    detail: `cursor ${after.cursor}`,
  };
}

/** Which response headers a page can read from an OOBI GET, by name. */
function* readable(s: Session): Operation<Outcome> {
  const response = yield* http.request(`${s.server.origin}/oobi/${s.server.pre}/controller`);
  const names = HEADER_NAMES.filter((name) => response.headers.has(name));
  return { ok: response.ok, observed: `HTTP ${response.status} readable ${names.join(",")}` };
}

/** Echo `/echo` and report what the server received, as parsed JSON. */
function* echo(
  url: string,
  init: { method: string; headers?: HeadersInit; body?: ArrayBuffer },
): Operation<Record<string, string>> {
  const response = yield* http.request(url, init);
  return JSON.parse(text.decode(response.body));
}

type Probe = (s: Session) => Operation<Outcome>;
/** Probes against a real server: the witness/mailbox exercised through keri-ts's own senders. */
const SERVER_PROBES: Record<string, { servers: ServerName[]; run: Probe }> = {
  "oobi-get": { servers: ["keripy", "tufa"], run: (s) => readable(s) },
  "post-detached-event": {
    servers: ["keripy", "tufa"],
    run: function*(s) {
      const result = yield* new HTTPMessenger(`${s.server.origin}/`, http, { destination: s.server.pre }).send(
        inception(s, s.recipient),
      );
      return sent(result);
    },
  },
  "put-native-stream": {
    servers: ["keripy", "tufa"],
    run: function*(s) {
      const response = yield* new HTTPStreamMessenger(`${s.server.origin}/`, http, inception(s, s.sender), {
        destination: s.server.pre,
      }).send();
      return { ok: response.ok, observed: `HTTP ${response.status}` };
    },
  },
  "witness-authorization-header": {
    servers: ["keripy", "tufa"],
    run: function*(s) {
      yield* sendWitnessMessage(
        s.recipient,
        s.server.pre,
        inception(s, s.recipient),
        http,
        systemClock,
        null,
        "totp-code-placeholder",
      );
      return { ok: true, observed: "delivered" };
    },
  },
  "mailbox-admin-cesr": { servers: ["keripy", "tufa"], run: (s) => admin(s, s.recipient, "cesr") },
  "mailbox-admin-multipart": { servers: ["keripy", "tufa"], run: (s) => admin(s, s.sender, "multipart") },
  "mailbox-delivery-multipart-authorized": { servers: ["tufa"], run: (s) => multipartDelivery(s) },
  "mailbox-topic-reply": { servers: ["keripy", "tufa"], run: (s) => topic(s, "/reply") },
  "mailbox-topic-receipt": { servers: ["keripy", "tufa"], run: (s) => topic(s, "/receipt") },
  "mailbox-topic-multisig": { servers: ["keripy", "tufa"], run: (s) => topic(s, "/multisig") },
  "mailbox-topic-credential": { servers: ["keripy", "tufa"], run: (s) => topic(s, "/credential") },
  "mailbox-cursor-resume": { servers: ["keripy", "tufa"], run: (s) => resume(s) },
};

/** Probes of browser mechanics, against the lane's own echo server, whose behavior is known. */
const ECHO_PROBES: Record<string, (origin: string, s: Session) => Operation<Outcome>> = {
  "forbidden-content-length": function*(origin) {
    // A page may not set Content-Length; the browser drops it and sends the true length.
    const body = new TextEncoder().encode("0123456789").buffer;
    const seen = yield* echo(`${origin}/echo`, {
      method: "PUT",
      headers: { "Content-Length": "5", "Content-Type": "application/cesr" },
      body,
    });
    return { ok: seen["content-length"] === "10", observed: `server saw content-length ${seen["content-length"]}` };
  },
  "genus-header-sent": function*(origin) {
    const seen = yield* echo(`${origin}/echo`, {
      method: "POST",
      headers: { "CESR-Genus": "2", "CESR-ATTACHMENT": "-AAA", "Content-Type": "application/cesr" },
      body: new ArrayBuffer(1),
    });
    return { ok: seen["cesr-genus"] === "2", observed: `server saw cesr-genus ${seen["cesr-genus"]}` };
  },
  // `redirect: "manual"`: a browser answers with an opaque redirect, status 0, where Deno sees the 307.
  "redirect-manual-post": function*(origin, s) {
    return sent(
      yield* new HTTPMessenger(`${origin}/redirect`, http, { destination: "E" }).send(inception(s, s.sender)),
    );
  },
  "redirect-manual-put": function*(origin, s) {
    const response = yield* new HTTPStreamMessenger(`${origin}/redirect`, http, inception(s, s.sender)).send();
    return { ok: response.ok, observed: `HTTP ${response.status}` };
  },
  "expose-headers": function*(origin) {
    const response = yield* http.request(`${origin}/expose`);
    const names = ["cesr-attachment", "keri-aid", "x-hidden"].filter((name) => response.headers.has(name));
    return { ok: true, observed: `readable ${names.join(",")}` };
  },
  "sse-streams-incrementally": function*(origin) {
    const stamps: number[] = [];
    const started = Date.now();
    const response = yield* http.open(`${origin}/sse?id=${crypto.randomUUID()}&events=4`);
    const controller = new AbortController();
    yield* call(async () => {
      for await (const _ of response.body(controller.signal)) stamps.push(Date.now() - started);
    });
    // Events are 250 ms apart: incremental delivery spreads arrival over the stream's life.
    return {
      ok: stamps.length > 1,
      observed: stamps.length > 1 && stamps.at(-1)! - stamps[0] > 400 ? "incremental" : "buffered",
      detail: `chunks at ${stamps.join(",")} ms`,
    };
  },
  "sse-abort": function*(origin) {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const response = yield* http.open(`${origin}/sse?id=${id}&events=40`);
    yield* call(async () => {
      for await (const _ of response.body(controller.signal)) {
        controller.abort();
        break;
      }
    });
    yield* sleep(1_000);
    const state = yield* echo(`${origin}/sse-state?id=${id}`, { method: "GET" });
    return {
      ok: state.aborted === true as never,
      observed: `server saw close: ${state.aborted}`,
      detail: `sent ${state.sent} of 40`,
    };
  },
};

/** Run every probe in the page. Servers are probed in order; a failed probe never stops the rest. */
export async function runProbes(config: Config): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const record = (probe: string, server: ServerName, outcome: Outcome) => {
    console.log(`probe ${probe} | ${server} | ${outcome.observed}`);
    results.push({ detail: "", ...outcome, probe, server });
  };
  for (const server of ["echo", "keripy", "tufa"] as const) {
    const session = await openSession(server, config[server]);
    try {
      const probes = server === "echo"
        ? Object.entries(ECHO_PROBES).map(([name, probe]) => [name, () => probe(config.echo.origin, session)] as const)
        : Object.entries(SERVER_PROBES).filter(([, probe]) => probe.servers.includes(server)).map(([name, probe]) =>
          [name, () => probe.run(session)] as const
        );
      for (const [name, probe] of probes) {
        if (config.only && !new RegExp(config.only).test(`${name}|${server}`)) continue;
        record(name, server, await within(60_000, probe).catch(failure));
      }
    } finally {
      await run(() => session.hby.close(true));
    }
  }
  return results;
}
