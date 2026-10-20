import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { oobiTerminalState } from "../../../src/app/oobiery.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
/** KRAM admission through real mailbox hosts; controller keys never cross implementations. */

import { Diger, NumberPrimitive, parseBytes, Prefixer, Siger, t, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import {
  type AgentRuntime,
  createAgentRuntime,
  runAgentRuntimeUntil,
} from "../../../src/app/agent-runtime.ts";
import { requestFrame } from "../../../src/app/cesr-egress.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { consumeMailboxSse } from "../../../src/app/mailbox-sse.ts";
import { WitnessReceiptor } from "../../../src/app/witnessing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { query } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import {
  createInteropContext,
  type InteropContext,
  randomPort,
  spawnChild,
  startKeriPyWitnessHarness,
  withStartedChild,
} from "./interop-test-helpers.ts";

import { assertKeriPyWitnessStores } from "./interop-witness-helpers.ts";

const PYTHON_PEER = fromFileUrl(new URL("../../fixtures/kram-mailbox-peer.py", import.meta.url));
const TYPESCRIPT_PEER = fromFileUrl(new URL("../../fixtures/kram-mailbox-peer.ts", import.meta.url));
const PAYLOAD = "authenticated-mailbox-payload";

/** Captured packets carry public evidence only, including separate member signatures. */
interface SignedQuery {
  said: string;
  stamp: string;
  wires: string[];
}
interface ControllerPackets {
  pre: string;
  event: string;
  witnesses: string[];
  receipts: number[];
  members: string[];
  kel: string[];
  packets: {
    first: SignedQuery;
    stale: SignedQuery;
    forged: SignedQuery & { invalid: string };
    barrier: SignedQuery;
  };
}
interface Snapshot {
  pid: number;
  provider: string;
  sender: { event: string; witnesses: string[]; threshold: number; receipts: number[] } | null;
  rows: { said: string; cached: boolean; pending: boolean; stamp: string | null; proofs: number[] }[];
  streams: string[];
}
interface Sent {
  status: number;
  payload: string | null;
}
/** Closed commands for this test-owned endpoint, never a production protocol seam. */
interface WitnessOobi {
  pre: string;
  url: string;
}

type Command = { action: "info"; witnesses?: WitnessOobi[] } | { action: "store"; pre: string } | {
  action: "inspect";
  pre: string;
  saids: string[];
} | { action: "send"; url: string; wire: string; readEvent: boolean };

/** Read observations from the matching checked-in fixture, with HTTP failures exposed. */
async function control<T>(url: string, command: Command): Promise<T> {
  const response = await fetch(`${url}_fixture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assertEquals(response.status, 200, text);
  return JSON.parse(text) as T;
}

/** Construct the KRAM query controls independently of controller/witness setup. */
function queryPackets(signers: readonly Hab[], outsider: Hab): ControllerPackets["packets"] {
  const sender = signers[0];
  const now = Date.now();
  const packet = (offset: number): SignedQuery => {
    const body = query("mbx", { i: sender.pre, src: sender.pre, topics: { "/reply": 0 } }, {
      pre: sender.pre,
      pvrsn: Vrsn_2_0,
      stamp: new Date(now + offset).toISOString(),
    });
    return {
      said: body.said!,
      stamp: body.ked!.dt as string,
      wires: signers.map((hab) => encodeBase64(hab.endorse(body, { pipelined: false, gvrsn: Vrsn_2_0 }))),
    };
  };
  const forged = packet(1);
  const body = query("mbx", { i: sender.pre, src: sender.pre, topics: { "/reply": 0 } }, {
    pre: sender.pre,
    pvrsn: Vrsn_2_0,
    stamp: forged.stamp,
  });
  const invalid = messagize(body, {
    tsgs: [
      new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        NumberPrimitive.fromNum(BigInt(sender.kever!.lastEst.s)),
        new Diger({ qb64: sender.kever!.lastEst.d }),
        outsider.sign(body.raw, true),
      ),
    ],
    gvrsn: Vrsn_2_0,
  });
  return {
    first: packet(0),
    stale: packet(-86_400_000),
    forged: { ...forged, invalid: encodeBase64(invalid) },
    barrier: packet(2),
  };
}

/** Independent Haberies contribute the real group inception and one query proof each. */
async function typescriptPackets(count: number, witnesses: WitnessOobi[] = []): Promise<ControllerPackets> {
  return await run(function*() {
    const hbys: Habery[] = [];
    const runtimes: AgentRuntime[] = [];
    try {
      for (let index = 0; index < count; index++) {
        const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
        hbys.push(hby);
        runtimes.push(yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock));
      }
      const wits = witnesses.map((witness) => witness.pre);
      const witnessing = { wits, toad: wits.length ? 2 : 0 };
      const members = hbys.map((hby) => hby.makeHab("member", undefined, count === 1 ? witnessing : {}));
      const mids = members.map((hab) => hab.pre);
      assertEquals(new Set(mids).size, count);
      const kel = members.map((hab, index) => [...hbys[index].db.clonePreIter(hab.pre)][0]);
      let signers = members;
      if (count === 2) {
        for (const [index, runtime] of runtimes.entries()) yield* runtime.reactor.processBytes(kel[1 - index]);
        const groups = hbys.map((hby, index) =>
          hby.makeGroupHab("group", members[index], mids, mids, undefined, { isith: "2", nsith: "2", ...witnessing })
        );
        assertEquals(groups[0].hab.pre, groups[1].hab.pre);
        for (const [index, runtime] of runtimes.entries()) {
          yield* runtime.reactor.processBytes(groups[1 - index].message);
          hbys[index].kevery.processEscrows();
          assertExists(groups[index].hab.kever);
        }
        signers = groups.map((group) => group.hab);
        kel.push(...hbys[0].db.clonePreIter(signers[0].pre));
      }
      const sender = signers[0];
      if (witnesses.length) {
        const runtime = runtimes[0];
        for (const { url } of witnesses) runtime.oobiery.resolve(url);
        yield* runAgentRuntimeUntil(
          runtime,
          () => witnesses.every(({ url }) => oobiTerminalState(runtime.hby.db, url).status !== "pending"),
          { hab: members[0], timeoutMs: 20_000, pollMailbox: false },
        );
        for (const { pre, url } of witnesses) {
          assertEquals(oobiTerminalState(runtime.hby.db, url).status, "resolved");
          assertExists(hbys[0].db.getKever(pre));
        }
        yield* new WitnessReceiptor(hbys[0], runtime.protocol, runtime.http, runtime.clock).submit(
          sender.pre,
        );
        assertEquals(sender.db.wigs.get([sender.pre, sender.kever!.serder.said!]).map((sig) => sig.index).sort(), [
          0,
          1,
          2,
        ]);
      }
      const outsider = hbys[0].makeHab("outsider");
      return {
        pre: sender.pre,
        event: sender.kever!.serder.said!,
        witnesses: [...sender.kever!.wits],
        receipts: sender.db.wigs.get([sender.pre, sender.kever!.serder.said!]).map((sig) => sig.index).sort(),
        members: mids,
        // Select CESR v2 through the production serializer, including the group's
        // accepted combined inception proof. The mailbox host parses v2 counters.
        kel: [...members, ...(count === 2 ? [sender] : [])].map((hab) =>
          encodeBase64(messagize(hab.kever!.serder, {
            sigers: hab.db.getSigs(hab.pre, hab.kever!.serder.said!).map((qb64) => new Siger({ qb64 })),
            wigers: hab.db.wigs.get([hab.pre, hab.kever!.serder.said!]),
            gvrsn: Vrsn_2_0,
            genusify: true,
          }))
        ),
        packets: queryPackets(signers, outsider),
      };
    } finally {
      for (const runtime of runtimes) yield* runtime.close();
      for (const hby of hbys) yield* hby.close(true);
    }
  });
}

/** Use the real client SSE decoder and stop only after a complete mailbox event. */
async function send(url: string, wire: string, readEvent: boolean): Promise<Sent> {
  if (!readEvent) {
    // KERIpy's production bulk PUT queues exact CESR bytes without opening SSE.
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/cesr" },
      body: decodeBase64(wire),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return { status: response.status, payload: null };
  }
  return await run(function*() {
    const [frame] = yield* call(() => parseBytes(decodeBase64(wire)));
    // Real detached-header egress performs the reference media-type negotiation.
    const response = yield* requestFrame(url, frame, new FetchHttpClient(), {
      signal: AbortSignal.timeout(10_000),
    });
    let payload: string | null = null;
    yield* consumeMailboxSse(
      response,
      new AbortController(),
      function*(event) {
        payload = t(event.msg);
        return false;
      },
      systemClock,
      { maxDurationMs: 5000 },
    );
    return { status: response.status, payload };
  });
}

/** Observe a queued Python parser turn; a fresh accepted query is the refusal barrier. */
async function observed(read: () => Promise<Snapshot>, complete: (state: Snapshot) => boolean): Promise<Snapshot> {
  const expires = performance.now() + 10_000;
  let last: Snapshot | undefined;
  while (performance.now() < expires) {
    last = await read();
    if (complete(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`KRAM mailbox did not settle: ${JSON.stringify(last)}`);
}

/** One authentication flow: partial proof, completion, replay/refusal and valid controls. */
async function exercise(
  bundle: ControllerPackets,
  transmit: (wire: string, event: boolean) => Promise<Sent>,
  inspect: () => Promise<Snapshot>,
): Promise<void> {
  for (const kel of bundle.kel) assertEquals((await transmit(kel, false)).status, 204);
  const { first, stale, forged, barrier } = bundle.packets;
  assertEquals(new Set(bundle.members).size, first.wires.length, "independent controller participants");
  if (first.wires.length === 2) {
    await transmit(first.wires[0], false);
    const partial = await observed(inspect, (state) => state.rows[0].pending);
    assert(partial.sender);
    assertEquals(partial.rows[0].cached, true, "KRAM records partial receipt before threshold completion");
    assertEquals(partial.streams.includes(first.said), false, "one member cannot open the group mailbox");
  }
  const accepted = await transmit(first.wires.at(-1)!, true);
  assertEquals(accepted, { status: 200, payload: PAYLOAD });
  const complete = await observed(inspect, (state) => state.rows[0].cached && !state.rows[0].pending);
  assertEquals(complete.rows[0].stamp, first.stamp);

  for (const wire of [...first.wires, ...stale.wires, forged.invalid]) {
    const refused = await transmit(wire, false);
    assert([204, 403].includes(refused.status), `refusal transport status ${refused.status}`);
    assertEquals(refused.payload, null);
  }
  // KERIpy acknowledges queued PUTs before parsing. This later positive proves
  // every preceding refusal packet has reached its processing owner.
  for (const wire of barrier.wires) await transmit(wire, false);
  const refused = await observed(inspect, (state) => state.rows[3].cached && !state.rows[3].pending);
  assertEquals(refused.rows[0], complete.rows[0], "replay changes neither cache nor pending evidence");
  assertEquals(
    refused.rows[1],
    { said: stale.said, cached: false, pending: false, stamp: null, proofs: [] },
    "a validly signed day-old query is stale",
  );
  assertEquals(
    refused.rows[2],
    { said: forged.said, cached: false, pending: false, stamp: null, proofs: [] },
    "a foreign-key signature cannot authenticate this sender",
  );
  assertEquals(refused.streams.includes(first.said), false, "replay cannot dispatch another stream");
  assertEquals(refused.streams.includes(stale.said), false);
  assertEquals(refused.streams.includes(forged.said), false);

  // The same forged body succeeds with its real independent sender signatures.
  for (const wire of forged.wires.slice(0, -1)) await transmit(wire, false);
  assertEquals(await transmit(forged.wires.at(-1)!, true), { status: 200, payload: PAYLOAD });
  const repaired = await observed(inspect, (state) => state.rows[2].cached && !state.rows[2].pending);
  assertEquals(repaired.rows[2].stamp, forged.stamp);
}

for (const count of [1, 2]) {
  for (const direction of ["keri-ts -> KERIpy", "KERIpy -> keri-ts"]) {
    Deno.test(`KRAM mailbox ${direction}: ${count === 1 ? "single controller" : "independent two-of-two group"}`, async () => {
      const ctx = await createInteropContext();
      const port = randomPort();
      const pythonUrl = `http://127.0.0.1:${port}/`;
      const child = spawnChild(
        ctx.pythonCommand,
        [PYTHON_PEER, String(port), String(count), `${ctx.home}/python-provider`],
        ctx.env,
        ctx.repoRoot,
      );
      try {
        await withStartedChild(child, port, async () => {
          if (direction === "keri-ts -> KERIpy") {
            const bundle = await typescriptPackets(count);
            await control(pythonUrl, { action: "store", pre: bundle.pre });
            await exercise(bundle, (wire, event) => send(pythonUrl, wire, event), () =>
              control<Snapshot>(pythonUrl, {
                action: "inspect",
                pre: bundle.pre,
                saids: Object.values(bundle.packets).map((packet) => packet.said),
              }));
          } else {
            const bundle = await control<ControllerPackets>(pythonUrl, { action: "info" });
            const providerPort = randomPort();
            const url = `http://127.0.0.1:${providerPort}/`;
            const provider = spawnChild(
              Deno.execPath(),
              ["run", "-A", TYPESCRIPT_PEER, String(providerPort), `${ctx.home}/typescript-provider`],
              ctx.env,
              ctx.repoRoot,
            );
            await withStartedChild(provider, providerPort, async () => {
              await control(url, { action: "store", pre: bundle.pre });
              await exercise(
                bundle,
                (wire, readEvent) => control<Sent>(pythonUrl, { action: "send", url, wire, readEvent }),
                () =>
                  control<Snapshot>(url, {
                    action: "inspect",
                    pre: bundle.pre,
                    saids: Object.values(bundle.packets).map((packet) => packet.said),
                  }),
              );
            });
          }
        });
      } finally {
        await Deno.remove(ctx.home, { recursive: true });
      }
    });
  }
}

/** Kill/reopen actual provider processes against the same test-owned current-version stores. */
async function restartProvider(ctx: InteropContext, count: number, pythonClient?: string): Promise<void> {
  const bundle = pythonClient
    ? await control<ControllerPackets>(pythonClient, { action: "info" })
    : await typescriptPackets(count);
  const { first, barrier } = bundle.packets;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}/`;
  const root = `${ctx.home}/restart-provider`;
  const inspect = () =>
    control<Snapshot>(url, {
      action: "inspect",
      pre: bundle.pre,
      saids: Object.values(bundle.packets).map((packet) => packet.said),
    });
  const transmit = (wire: string, readEvent: boolean) =>
    pythonClient
      ? control<Sent>(pythonClient, { action: "send", url, wire, readEvent })
      : send(url, wire, readEvent);
  // This local resource helper runs one concrete fixture phase, then joins the
  // actual process. SIGKILL deliberately skips application cleanup after commit.
  const phase = async (body: () => Promise<Snapshot>, crash = false): Promise<Snapshot> => {
    const child = pythonClient
      ? spawnChild(Deno.execPath(), ["run", "-A", TYPESCRIPT_PEER, String(port), root], ctx.env, ctx.repoRoot)
      : spawnChild(ctx.pythonCommand, [PYTHON_PEER, String(port), String(count), root], ctx.env, ctx.repoRoot);
    return await withStartedChild(child, port, async () => {
      const state = await body();
      if (crash) {
        child.kill("SIGKILL");
        assertEquals((await child.status).signal, "SIGKILL");
      }
      return state;
    });
  };
  const initial = await phase(async () => {
    await control(url, { action: "store", pre: bundle.pre });
    for (const kel of bundle.kel) assertEquals((await transmit(kel, false)).status, 204);
    if (count === 2) {
      await transmit(first.wires[0], false);
      const pending = await observed(inspect, (state) => state.rows[0].pending);
      assert(pending.sender);
      assertEquals(pending.rows[0].proofs, [0]);
      assertEquals(pending.streams, []);
      return pending;
    }
    assertEquals(await transmit(first.wires[0], true), { status: 200, payload: PAYLOAD });
    return await observed(inspect, (state) => state.rows[0].cached && !state.rows[0].pending);
  }, true);

  let accepted = initial;
  if (count === 2) {
    accepted = await phase(async () => {
      const reopened = await inspect();
      assert(reopened.sender, "the sender's accepted KEL must survive without reintroduction");
      assert(reopened.pid !== initial.pid, "a different OS process reads the saved proof");
      assertEquals(reopened.provider, initial.provider, "provider identity/keys survive");
      assertEquals(reopened.rows[0], initial.rows[0], "exact partial evidence survives SIGKILL");
      // Do not resend proof zero or republish the mailbox payload after restart.
      assertEquals(await transmit(first.wires[1], true), { status: 200, payload: PAYLOAD });
      const completed = await observed(inspect, (state) => state.rows[0].cached && !state.rows[0].pending);
      assertEquals(completed.rows[0].proofs, [], "threshold completion retires partial signatures");
      return completed;
    }, true);
  }

  await phase(async () => {
    const reopened = await inspect();
    assert(reopened.sender);
    assert(reopened.pid !== accepted.pid, "accepted state is reopened in another OS process");
    assertEquals(reopened.provider, accepted.provider);
    assertEquals(reopened.rows[0], accepted.rows[0], "accepted cache survives without partial evidence");
    for (const wire of first.wires) await transmit(wire, false);
    for (const wire of barrier.wires.slice(0, -1)) await transmit(wire, false);
    assertEquals(await transmit(barrier.wires.at(-1)!, true), { status: 200, payload: PAYLOAD });
    const final = await observed(inspect, (state) => state.rows[3].cached && !state.rows[3].pending);
    assertEquals(final.rows[0], accepted.rows[0], "replay after restart cannot reset acceptance");
    assertEquals(final.streams.includes(first.said), false, "replay after restart cannot redispatch");
    assertEquals(final.rows[3].proofs, []);
    return final;
  });
}

for (const count of [1, 2]) {
  Deno.test(`KRAM mailbox keri-ts -> KERIpy: ${count}-signer provider survives SIGKILL/reopen`, async () => {
    const ctx = await createInteropContext();
    try {
      await restartProvider(ctx, count);
    } finally {
      await Deno.remove(ctx.home, { recursive: true });
    }
  });
  Deno.test(`KRAM mailbox KERIpy -> keri-ts: ${count}-signer provider survives SIGKILL/reopen`, async () => {
    const ctx = await createInteropContext();
    const port = randomPort();
    const child = spawnChild(
      ctx.pythonCommand,
      [PYTHON_PEER, String(port), String(count), `${ctx.home}/python-provider`],
      ctx.env,
      ctx.repoRoot,
    );
    try {
      await withStartedChild(child, port, () => restartProvider(ctx, count, `http://127.0.0.1:${port}/`));
    } finally {
      await Deno.remove(ctx.home, { recursive: true });
    }
  });
}

for (const count of [1, 2]) {
  for (const direction of ["keri-ts -> KERIpy", "KERIpy -> keri-ts"]) {
    Deno.test(`KRAM witnessed mailbox ${direction}: ${count}-signer controller, three witnesses`, async () => {
      const ctx = await createInteropContext();
      const aliases = ["wan", "wil", "wes"];
      try {
        const harness = await startKeriPyWitnessHarness(ctx, { aliases });
        try {
          const witnesses = harness.nodes.map((node) => ({ pre: node.pre, url: node.controllerOobi }));
          const port = randomPort();
          const pythonUrl = `http://127.0.0.1:${port}/`;
          const child = spawnChild(
            ctx.pythonCommand,
            [PYTHON_PEER, String(port), String(count), `${ctx.home}/python-provider`],
            ctx.env,
            ctx.repoRoot,
          );
          await withStartedChild(child, port, async () => {
            const bundle = direction === "keri-ts -> KERIpy"
              ? await typescriptPackets(count, witnesses)
              : await control<ControllerPackets>(pythonUrl, { action: "info", witnesses });
            assertEquals(bundle.witnesses, witnesses.map(({ pre }) => pre));
            assertEquals(bundle.receipts, [0, 1, 2], "source controller verified every witness receipt");
            const verify = async (url: string, transmit: (wire: string, event: boolean) => Promise<Sent>) => {
              const inspect = () =>
                control<Snapshot>(url, {
                  action: "inspect",
                  pre: bundle.pre,
                  saids: Object.values(bundle.packets).map(({ said }) => said),
                });
              await control(url, { action: "store", pre: bundle.pre });
              await exercise(bundle, transmit, inspect);
              assertEquals((await inspect()).sender, {
                event: bundle.event,
                witnesses: bundle.witnesses,
                threshold: 2,
                receipts: [0, 1, 2],
              }, "provider accepted the witnessed KEL and its actual receipt evidence");
            };
            if (direction === "keri-ts -> KERIpy") {
              await verify(pythonUrl, (wire, event) => send(pythonUrl, wire, event));
            } else {
              const providerPort = randomPort();
              const url = `http://127.0.0.1:${providerPort}/`;
              const provider = spawnChild(
                Deno.execPath(),
                ["run", "-A", TYPESCRIPT_PEER, String(providerPort), `${ctx.home}/typescript-provider`],
                ctx.env,
                ctx.repoRoot,
              );
              await withStartedChild(
                provider,
                providerPort,
                () =>
                  verify(url, (wire, readEvent) => control<Sent>(pythonUrl, { action: "send", url, wire, readEvent })),
              );
            }
            await assertKeriPyWitnessStores(ctx, harness, aliases, bundle.pre, 0, 3);
          });
        } finally {
          await harness.close();
          await Deno.remove(harness.home, { recursive: true });
          await Deno.remove(harness.configRoot, { recursive: true });
        }
      } finally {
        await Deno.remove(ctx.home, { recursive: true });
      }
    });
  }
}
