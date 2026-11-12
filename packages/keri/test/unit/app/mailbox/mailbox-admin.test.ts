import { concatBytes } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import type { Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  addMailbox,
  type MailboxAdminDeps,
  mailboxAdminUrl,
  mailboxStatus,
  removeMailbox,
  waitForMailboxState,
} from "../../../../src/app/mailbox/mailbox-admin.ts";
import { createProtocolProcessor } from "../../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import type { HttpClient, HttpRequestInit, HttpResponse } from "../../../../src/app/transport/http-client.ts";

const MAILBOX = `E${"MailboxProvider".padEnd(43, "A")}`;
const PROVIDER_URL = "http://mailbox.test:7723/base/";

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: Uint8Array;
}

/** Fetch-only HttpClient: no TCP, no node: modules; answers with scripted statuses. */
function fakeHttp(statuses: number[], requests: Recorded[]): HttpClient {
  return {
    *request(url: string, init: HttpRequestInit = {}): Operation<HttpResponse> {
      const body = init.body instanceof ArrayBuffer
        ? new Uint8Array(init.body)
        : typeof init.body === "string"
        ? new TextEncoder().encode(init.body)
        : (init.body ?? new Uint8Array());
      requests.push({ url, method: init.method, headers: new Headers(init.headers), body });
      const status = statuses.shift() ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Headers(),
        body: new TextEncoder().encode(status < 300 ? "" : `refused ${status}`),
      };
    },
    open() {
      throw new Error("streaming is not used by mailbox administration");
    },
  };
}

function* withDeps(
  statuses: number[],
  use: (deps: MailboxAdminDeps, hby: Habery, requests: Recorded[]) => Operation<void>,
): Operation<void> {
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  try {
    const protocol = createProtocolProcessor(hby);
    const requests: Recorded[] = [];
    hby.db.locs.pin([MAILBOX, "http"], { url: PROVIDER_URL });
    yield* use({ hby, http: fakeHttp(statuses, requests), reactor: new Reactor(protocol), protocol }, hby, requests);
  } finally {
    yield* hby.close(true);
  }
}

Deno.test("mailboxAdminUrl appends /mailboxes to the hosted endpoint path", () => {
  assertEquals(mailboxAdminUrl("http://example.com:7723/mailbox/"), "http://example.com:7723/mailbox/mailboxes");
  assertEquals(mailboxAdminUrl("http://example.com:7723"), "http://example.com:7723/mailboxes");
});

Deno.test("addMailbox posts a raw CESR body with the destination header and accepts the role", async () => {
  await run(function*() {
    yield* withDeps([200], function*(deps, hby, requests) {
      const hab = hby.makeHab("controller", undefined, {});
      assertEquals(mailboxStatus(hby, hab.pre, MAILBOX).state, "absent");

      const status = yield* addMailbox(deps, hab, MAILBOX);

      assertEquals(status, { mailbox: MAILBOX, state: "authorized" });
      assertEquals(requests.length, 1);
      const [request] = requests;
      assertEquals(request.url, "http://mailbox.test:7723/base/mailboxes");
      assertEquals(request.method, "POST");
      assertEquals(request.headers.get("content-type"), "application/cesr");
      assertEquals(request.headers.get("cesr-destination"), MAILBOX);
      const replay = concatBytes(...hby.db.clonePreIter(hab.pre));
      const rpy = hab.loadEndRole(hab.pre, MAILBOX, "mailbox");
      assertEquals(request.body, concatBytes(replay, rpy), "body is the controller replay then the signed reply");
    });
  });
});

Deno.test("removeMailbox cuts an authorized role", async () => {
  await run(function*() {
    yield* withDeps([200, 200], function*(deps, hby) {
      const hab = hby.makeHab("controller", undefined, {});
      yield* addMailbox(deps, hab, MAILBOX);
      assertEquals(yield* removeMailbox(deps, hab, MAILBOX), { mailbox: MAILBOX, state: "revoked" });
      assertEquals(mailboxStatus(hby, hab.pre, MAILBOX).state, "revoked");
    });
  });
});

Deno.test("a 415 answer falls back to the legacy multipart form", async () => {
  await run(function*() {
    yield* withDeps([415, 200], function*(deps, hby, requests) {
      const hab = hby.makeHab("controller", undefined, {});
      yield* addMailbox(deps, hab, MAILBOX);

      assertEquals(requests.length, 2);
      assertEquals(requests[0].headers.get("content-type"), "application/cesr");
      const multipart = requests[1];
      assertEquals(multipart.url, "http://mailbox.test:7723/base/mailboxes");
      assertEquals(multipart.method, "POST");
      assertEquals(multipart.headers.get("cesr-destination"), MAILBOX);
      const contentType = multipart.headers.get("content-type") ?? "";
      assert(/^multipart\/form-data; boundary=/.test(contentType), contentType);

      const form = yield* call(() =>
        new Response(new Blob([new Uint8Array(multipart.body)]), { headers: { "content-type": contentType } })
          .formData()
      );
      const decoder = new TextDecoder();
      assertEquals([...form.keys()].sort(), ["kel", "rpy"], "an undelegated controller sends no delkel field");
      assertEquals(form.get("kel"), decoder.decode(concatBytes(...hby.db.clonePreIter(hab.pre))));
      assertEquals(form.get("rpy"), decoder.decode(hab.loadEndRole(hab.pre, MAILBOX, "mailbox")));
    });
  });
});

Deno.test("a provider refusal surfaces the status and body and leaves local state untouched", async () => {
  await run(function*() {
    yield* withDeps([500], function*(deps, hby, requests) {
      const hab = hby.makeHab("controller", undefined, {});
      yield* assertEffectRejects(
        () => addMailbox(deps, hab, MAILBOX),
        "Mailbox admin request failed with HTTP 500: refused 500",
      );
      assertEquals(requests.length, 1, "only 406 and 415 trigger the multipart retry");
    });
  });
});

Deno.test("a mailbox without an accepted location is refused before any request", async () => {
  await run(function*() {
    yield* withDeps([], function*(deps, hby, requests) {
      const hab = hby.makeHab("controller", undefined, {});
      yield* assertEffectRejects(
        () => addMailbox(deps, hab, "EUnknownMailbox"),
        "No endpoint URL is stored for mailbox EUnknownMailbox.",
      );
      assertEquals(requests.length, 0);
    });
  });
});

Deno.test("waitForMailboxState returns a timed-out value without throwing and settles when state arrives", async () => {
  const absent = { mailbox: MAILBOX, state: "absent" } as const;
  const timedOut = await run(() =>
    waitForMailboxState(() => absent, { want: "authorized", deadline: Date.now() + 20, pollMs: 5 })
  );
  assertEquals(timedOut, { outcome: "timed-out", status: absent });

  let reads = 0;
  const settled = await run(() =>
    waitForMailboxState(
      () => ++reads < 3 ? absent : { mailbox: MAILBOX, state: "authorized" },
      { want: "authorized", deadline: Date.now() + 5_000, pollMs: 1 },
    )
  );
  assertEquals(settled, { outcome: "settled", status: { mailbox: MAILBOX, state: "authorized" } });
});

/** Run an operation expected to throw a message containing `text`. */
function* assertEffectRejects(make: () => Operation<unknown>, text: string): Operation<void> {
  try {
    yield* make();
  } catch (error) {
    assert((error as Error).message.includes(text), `unexpected error: ${(error as Error).message}`);
    return;
  }
  throw new Error(`expected rejection containing: ${text}`);
}
