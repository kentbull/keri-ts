// @file-test-lane app-fast-parallel

import { parseBytes, type SerderKERI, Vrsn_1_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createHabery } from "keri-ts/db/lmdb";
import type { Habery } from "keri-ts/runtime";
import {
  configFileCandidates,
  mailboxAdminUrl,
  normalizeHttpUrl,
  resolveListenHost,
  resolveListenPort,
} from "../src/operator/host-planning.ts";
import { normalizeMailboxTopic } from "../src/operator/mailbox-debug.ts";
import { resolveConfiguredMailboxStartup, resolveMailboxHostStartup } from "../src/operator/mailbox-startup.ts";
import { resolveWitnessHostStartup, resolveWitnessStartupMaterial } from "../src/operator/witness-startup.ts";

const EMPTY_ENDPOINT_STATE = {
  db: {
    locs: {
      getTopItemIter: () => [],
    },
  },
} as unknown as Habery;

Deno.test("tufa/operator planning - config candidates preserve KLI and Tufa lookup paths", () => {
  const paths = configFileCandidates("wil", {
    headDirPath: "/tmp/tufa-head",
    home: "/home/operator",
  });

  assertEquals(paths.includes("wil"), true);
  assertEquals(paths.includes("wil.json"), true);
  assertEquals(paths.includes("/tmp/tufa-head/.tufa/cf/wil.json"), true);
  assertEquals(paths.includes("/tmp/tufa-head/keri/cf/wil.json"), true);
  assertEquals(paths.includes("/home/operator/.tufa/cf/wil.json"), true);
  assertEquals(paths.includes("/home/operator/keri/cf/wil.json"), true);
  assertEquals(paths.includes("/usr/local/var/keri/cf/wil.json"), true);
});

Deno.test("tufa/operator planning - host URL and listener helpers keep advertised paths stable", () => {
  assertEquals(
    normalizeHttpUrl("http://example.com:7723/mailbox/", "Mailbox"),
    "http://example.com:7723/mailbox",
  );
  assertEquals(
    mailboxAdminUrl("http://example.com:7723/mailbox/"),
    "http://example.com:7723/mailbox/mailboxes",
  );
  assertEquals(resolveListenHost(undefined, "http://example.com:7723"), "0.0.0.0");
  assertEquals(resolveListenHost(undefined, "http://127.0.0.1:7723"), "127.0.0.1");
  assertEquals(resolveListenHost("127.0.0.1", "http://example.com:7723"), "127.0.0.1");
  assertEquals(resolveListenPort(undefined, "http://example.com:7723", 8000), 7723);
  assertEquals(resolveListenPort(undefined, "http://example.com", 8000), 8000);
});

Deno.test("tufa/operator planning - mailbox startup config normalizes and rejects conflicts", () => {
  assertEquals(
    resolveConfiguredMailboxStartup(
      {
        url: "http://127.0.0.1:5632/mailbox/",
        datetime: "2026-06-11T17:00:00.000Z",
      },
      null,
      "relay",
    ),
    {
      url: "http://127.0.0.1:5632/mailbox",
      datetime: "2026-06-11T17:00:00.000000+00:00",
      source: "cli",
    },
  );

  assertThrows(
    () =>
      resolveConfiguredMailboxStartup(
        {
          url: "http://127.0.0.1:5632/mailbox",
          datetime: "2026-06-11T17:00:00.000Z",
        },
        {
          relay: {
            dt: "2026-06-11T17:00:01.000Z",
            curls: ["http://127.0.0.1:5632/mailbox"],
          },
        },
        "relay",
      ),
    Error,
    "conflicts with explicit --url/--datetime",
  );
});

Deno.test("tufa/operator planning - witness explicit startup resolves partial CLI URLs", () => {
  const material = resolveWitnessStartupMaterial(
    EMPTY_ENDPOINT_STATE,
    "EWIT",
    {
      alias: "wan",
      url: "http://example.com:5642/witness/",
      tcp: 5643,
      datetime: "2026-06-11T17:00:00.000Z",
    },
    null,
  );

  assertEquals(material, {
    httpUrl: "http://example.com:5642/witness",
    tcpUrl: "tcp://127.0.0.1:5643",
    datetime: "2026-06-11T17:00:00.000000+00:00",
    source: "cli",
  });
});

Deno.test("tufa/operator planning - mailbox topic normalization preserves leading slash", () => {
  assertEquals(normalizeMailboxTopic("receipt"), "/receipt");
  assertEquals(normalizeMailboxTopic("/replay"), "/replay");
});

Deno.test("tufa/operator planning - a host AID created as KERI 1.0 signs v1 /loc/scheme replies", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const datetime = "2026-06-11T17:00:00.000Z";
      const witness = resolveWitnessHostStartup(hby, {
        alias: "witness",
        url: "http://127.0.0.1:5631",
        tcpUrl: "tcp://127.0.0.1:5632",
        datetime,
        version: Vrsn_1_0,
      }, null).hab;
      const mailbox = resolveMailboxHostStartup(hby, {
        alias: "mailbox",
        url: "http://127.0.0.1:8000",
        datetime,
        version: Vrsn_1_0,
      }, null).hab;

      for (const hab of [witness, mailbox]) {
        assertEquals(hab.kelVersion.major, 1);
        const reply = parseBytes(hab.makeLocScheme("http://127.0.0.1:5631", hab.pre, "http", datetime))[0]!;
        assertEquals((reply.body as SerderKERI).pvrsn.major, 1);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
