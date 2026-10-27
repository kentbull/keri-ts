import { oobiTerminalState } from "../../../src/app/bootstrap/oobiery.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
/** Independent TS issuer/holder/receiver stores with live KERIpy witness evidence. */

import { createProtocolHandler } from "@keri-ts/hosting";
import { createWalletBaser, Wallet, type WalletBaser, WalletDiscloser } from "@keri-ts/wallet";
import {
  type CesrFrame,
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  framePayload,
  Kinds,
  type MapperMap,
  parseBytes,
  Prefixer,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { publicOpeningAttachment } from "keri-ts/db";
import { acdcmap, acmSchemaDefault } from "../../../src/acdc/messaging.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex/ipex-building.ts";
import { consumeMailboxSse } from "../../../src/app/mailbox/mailbox-sse.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  runAgentRuntimeUntil,
} from "../../../src/app/runtime/agent-runtime.ts";
import { requestFrame } from "../../../src/app/transport/cesr-egress.ts";
import { Receiptor, WitnessReceiptor } from "../../../src/app/witness/receipting.ts";
import { query, reply } from "../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../src/db/exchange/exchange-nests.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import {
  createInteropContext,
  startKeriPyWitnessHarness,
} from "./interop-test-helpers.ts";
import { assertKeriPyWitnessStores } from "./interop-witness-helpers.ts";
import {
  accepted,
  anchor,
  inspectMailbox,
  introduce,
  introduceProvider,
  nonce,
  post,
  signed,
} from "./ipex-witness-helpers.ts";

/** Preserve the same independent stores and three-witness workflow across direct and mailbox delivery. */
export async function presentationCutoff(count: number, mailboxUrl?: string): Promise<void> {
  const ctx = await createInteropContext();
  const aliases = ["wan", "wil", "wes"];
  try {
    const providerPre = mailboxUrl ? (await inspectMailbox(mailboxUrl, "unknown")).provider : undefined;
    const witnesses = await startKeriPyWitnessHarness(ctx, { aliases });
    try {
      await run(function*() {
        const hbys: Habery[] = [], runtimes: AgentRuntime[] = [];
        const walletDbs: WalletBaser[] = [];
        const listeners: {
          server: Deno.HttpServer<Deno.NetAddr>;
          handler: ReturnType<typeof createProtocolHandler>;
        }[] = [];
        let now = Date.now();
        let receiverNow = now;
        const sent = makeNowIso8601(new Date(now));
        const receipt = makeNowIso8601(new Date(now + count - 1));
        const earlier = makeNowIso8601(new Date(now - 1000));
        try {
          for (let index = 0; index < count + 2; index++) {
            const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
            hbys.push(hby);
            runtimes.push(
              yield* createAgentRuntime(
                hby,
                new FetchHttpClient(),
                {
                  now: () => index === 1 ? receiverNow : now,
                  setTimeout,
                  clearTimeout: (timer) => clearTimeout(timer as number),
                },
                { kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } },
              ),
            );
          }
          const [issuerHby, receiverHby, ...holderHbys] = hbys;
          const [issuerRuntime, receiverRuntime, ...holderRuntimes] = runtimes;
          const wit = { wits: witnesses.nodes.map((node) => node.pre), toad: 2 };
          const issuer = issuerHby.makeHab("issuer", undefined, wit);
          const receiver = receiverHby.makeHab("receiver", undefined, mailboxUrl ? wit : {});
          const members = holderHbys.map((hby) => hby.makeHab("member", undefined, count === 1 ? wit : {}));
          let holders = members;
          if (count === 2) {
            const inceptions = holderHbys.map((hby, i) => acceptedEventReplayMessage(hby, members[i].pre, 0).message);
            for (const [i, runtime] of holderRuntimes.entries()) {
              yield* runtime.reactor.processBytes(inceptions[1 - i]);
            }
            const mids = members.map((hab) => hab.pre);
            const groups = holderHbys.map((hby, i) =>
              hby.makeGroupHab("holder", members[i], mids, mids, undefined, { isith: "2", nsith: "2", ...wit })
            );
            for (const [i, runtime] of holderRuntimes.entries()) {
              yield* runtime.reactor.processBytes(groups[1 - i].message);
              runtime.hby.kevery.processEscrows();
              assertExists(groups[i].hab.kever);
            }
            holders = groups.map(({ hab }) => hab);
          }
          const holder = holders[0], holderRuntime = holderRuntimes[0];
          const introductions = [
            [issuerRuntime, issuer],
            [holderRuntime, members[0]],
            ...(mailboxUrl ? [[receiverRuntime, receiver] as const] : []),
          ] as const;
          for (const [runtime, signer] of introductions) {
            const oobis = [
              ...witnesses.nodes.map((node) => node.controllerOobi),
              ...(mailboxUrl ? [`${mailboxUrl}oobi/${providerPre}/controller`] : []),
            ];
            for (const url of oobis) runtime.oobiery.resolve(url);
            yield* runAgentRuntimeUntil(
              runtime,
              () => oobis.every((url) => oobiTerminalState(runtime.hby.db, url).status !== "pending"),
              { hab: signer, timeoutMs: 20_000, pollMailbox: false },
            );
            for (const url of oobis) {
              assertEquals(oobiTerminalState(runtime.hby.db, url).status, "resolved");
            }
          }

          // Establish both controllers at every witness before publishing subsequent anchors.
          for (
            const [runtime, hab] of [
              [issuerRuntime, issuer],
              [holderRuntime, holder],
              ...(mailboxUrl ? [[receiverRuntime, receiver] as const] : []),
            ] as const
          ) {
            yield* new WitnessReceiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock)
              .submit(
                hab.pre,
              );
          }
          const issuerRegistry = issuerRuntime.acdc!.makeRegistry("issuance", issuer.pre, { stamp: earlier });
          const presentation = holderRuntime.acdc!.makeRegistry("presentation", holder.pre, { stamp: earlier });
          const irip = issuerRuntime.acdc!.store.event(issuerRegistry.regk!)!;
          const prip = holderRuntime.acdc!.store.event(presentation.regk!)!;
          yield* anchor(irip, [issuer], [issuerRuntime]);
          accepted(issuerRegistry, irip);
          yield* anchor(prip, holders, holderRuntimes);
          accepted(presentation, prip);

          // The negotiated whole status subtree needs declared closure; its private sibling stays hidden.
          const schema = acmSchemaDefault()[1];
          schema.$id = "";
          ((schema.properties as MapperMap).a as MapperMap).oneOf = [
            { type: "string" },
            {
              type: "object",
              properties: {
                status: {
                  type: "object",
                  required: ["d", "u", "value"],
                  properties: { d: { type: "string" }, u: { type: "string" }, value: { type: "string" } },
                  additionalProperties: false,
                },
              },
            },
          ];
          const credential = acdcmap(issuer.pre, {
            schema,
            regid: irip.said!,
            uuid: nonce(),
            attribute: {
              d: "",
              u: nonce(),
              i: holder.pre,
              rd: prip.said!,
              status: { d: "", u: nonce(), value: "citizen" },
              private: { d: "", u: nonce(), value: "hidden-value" },
            },
          });
          const compactor = new Compactor({
            mad: structuredClone(credential.sad!.a) as MapperMap,
            kind: Kinds.json,
            verify: false,
          });
          compactor.compact(["a/status/"], "a");
          const partial = acdcmap(issuer.pre, {
            regid: irip.said!,
            uuid: credential.sad!.u as string,
            schema: credential.sad!.s as MapperMap,
            attribute: compactor.partials!["a/status/"].mad,
          });
          assertEquals(partial.said, credential.said);
          const [issuance, issued] = issuerRegistry.blind(credential, "issued", { stamp: earlier });
          yield* anchor(issued, [issuer], [issuerRuntime]);
          accepted(issuerRegistry, issued);

          const urls: string[] = [];
          for (const [runtime, hab] of [[holderRuntime, holder], [receiverRuntime, receiver]] as const) {
            const handler = createProtocolHandler(runtime, { serviceHab: hab });
            const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
            listeners.push({ server, handler });
            urls.push(`http://127.0.0.1:${server.addr.port}/`);
          }
          const [holderUrl, receiverUrl] = urls;
          for (const url of urls) {
            yield* call(() => introduce(url, issuerHby, issuer.pre));
            for (const [i, hby] of holderHbys.entries()) yield* call(() => introduce(url, hby, members[i].pre));
            if (count === 2) yield* call(() => introduce(url, holderHbys[0], holder.pre));
            yield* call(() => introduce(url, receiverHby, receiver.pre));
            for (const body of [irip, issued]) {
              yield* call(() => post(url, { body, attachments: [], gvrsn: Vrsn_2_0 }));
            }
          }
          const offerOptions = {
            message: "status disclosure",
            recipient: receiver.pre,
            xid: credential.said!,
            stamp: sent,
            plan: [[(credential.schema as { $id: string }).$id, "/", ["a/status/"]]] as [string, string, string[]][],
          };
          const offer = ipexExnBody(holder.pre, "/ipex/offer", [partial], offerOptions);
          let discloser: WalletDiscloser | undefined;
          const transferred = messagize(partial, publicOpeningAttachment(issuance), {
            gvrsn: Vrsn_2_0,
            genusify: true,
          });
          if (count === 1) {
            const db = yield* createWalletBaser({ name: holderHbys[0].name, temp: true });
            walletDbs.push(db);
            const wallet = new Wallet({
              hby: holderHbys[0],
              registry: holderRuntime.acdc!.store,
              exc: holderRuntime.exc,
              db,
            });
            discloser = new WalletDiscloser(
              wallet,
              new Receiptor(holderHbys[0], holderRuntime.protocol, holderRuntime.http, holderRuntime.clock),
            );
          }
          const walletOffer = discloser
            ? yield* discloser.prepareOffer(holder.pre, { transferred, presenterAuthorized: true }, offerOptions)
            : undefined;
          if (walletOffer) assertEquals(walletOffer.exn.raw, offer.raw, "wallet preserves the negotiated body bytes");
          const agree = ipexExnBody(receiver.pre, "/ipex/agree", [], {
            message: "agree",
            prior: offer,
            stamp: sent,
          });
          for (const body of [offer, agree]) {
            const frame = body === offer && walletOffer ? parseBytes(walletOffer.wire)[0] : signed(
              body,
              body === offer ? holders : [receiver],
              body === offer ? [{ body: partial, attachments: [], gvrsn: Vrsn_2_0 }] : [],
            );
            for (const url of urls) yield* call(() => post(url, frame));
            for (const hby of [holderHbys[0], receiverHby]) {
              assertExists(hby.db.exns.get(body.said!), `${body.route} accepted by ${hby.name}`);
            }
          }
          const grant = ipexExnBody(holder.pre, "/ipex/grant", [partial], {
            message: "grant",
            prior: agree,
            stamp: sent,
          });
          if (discloser) {
            const before = holder.kever!.sn;
            yield* call(() =>
              assertRejects(
                () =>
                  run(() =>
                    discloser!.prepareGrant(holder.pre, { transferred }, {
                      message: "grant",
                      priorSaid: agree.said!,
                      stamp: sent,
                      presentation,
                    })
                  ),
                Error,
                "presenter authorization",
              )
            );
            assertEquals(holder.kever!.sn, before, "unapproved transfer authors no source anchor");
          }
          const walletGrant = discloser
            ? yield* discloser.prepareGrant(holder.pre, { transferred, presenterAuthorized: true }, {
              message: "grant",
              priorSaid: agree.said!,
              stamp: sent,
              presentation,
            })
            : undefined;
          if (walletGrant) {
            assertEquals(walletGrant.exn.raw, grant.raw, "presentation proof never changes the frozen Grant");
          }
          const walletNode = walletGrant ? envelopeFromFrame(parseBytes(walletGrant.wire)[0].nests![0]) : undefined;
          const [presentationProof, presented] = walletNode
            ? [
              walletNode.bsqs.find(proof => proof.td.nonce === grant.said)!,
              presentation.store.headEvent(presentation.regk!)!,
            ] as const
            : presentation.present(grant, "presented", { stamp: receipt });
          const source = walletNode
            ? walletNode.ssts.find(seal => seal.i.qb64 === holder.pre)!
            : yield* anchor(presented, holders, holderRuntimes);
          accepted(presentation, presented);
          yield* call(() => introduce(receiverUrl, holderHbys[0], holder.pre));
          let cursor = 0;
          if (mailboxUrl) {
            for (
              const [hby, pre] of [
                [receiverHby, receiver.pre],
                ...holderHbys.map((hby, i) => [hby, members[i].pre] as const),
                [holderHbys[0], holder.pre],
              ] as const
            ) {
              yield* call(() => introduceProvider(mailboxUrl, hby, pre));
            }
            const authorization = reply("/end/role/add", { cid: receiver.pre, role: "mailbox", eid: providerPre }, {
              pre: receiver.pre,
              pvrsn: Vrsn_2_0,
            });
            for (const url of [...urls, mailboxUrl]) {
              yield* call(() => post(url, signed(authorization, [receiver])));
            }
          }
          /** The grant crosses the selected real transport before normal receiver HTTP verification. */
          const receiveGrant = function*(frame: CesrFrame) {
            if (!mailboxUrl) {
              yield* call(() => post(receiverUrl, frame));
              return;
            }
            const message = yield* call(() => collectPayload(framePayload(frame)));
            const delivery = yield* call(function*() {
              const postman = holderRuntime.postman;
              yield* spawn(() => postman.deliverDo());
              const evt = postman.send({
                src: members[0].pre,
                dest: receiver.pre,
                topic: "/credential",
                msg: message,
              }, { notify: true });
              const outcome = yield* postman.wait(evt);
              if (outcome.kin === "failed") throw outcome.error;
              return outcome;
            });
            assertEquals(delivery.deliveries, [mailboxUrl]);
            const body = query("mbx", { i: receiver.pre, src: providerPre, topics: { "/credential": cursor } }, {
              pre: receiver.pre,
              pvrsn: Vrsn_2_0,
            });
            const [request] = parseBytes(messagize(body, {
              sigers: receiver.sign(body.raw, true),
              seal: { i: new Prefixer({ qb64: receiver.pre }) },
              gvrsn: Vrsn_2_0,
              genusify: true,
            }));
            const response = yield* requestFrame(mailboxUrl, request, new FetchHttpClient(), {
              signal: AbortSignal.timeout(10_000),
            });
            assertEquals(response.status, 200);
            let received = false;
            yield* consumeMailboxSse(
              response,
              new AbortController(),
              function*(event) {
                const forwarded = parseBytes(event.msg);
                assertEquals(forwarded.length, 1);
                assertEquals(forwarded[0].body.raw, frame.body.raw);
                assertEquals(
                  forwarded[0].attachments.map((group) => group.raw),
                  frame.attachments.map((group) => group.raw),
                );
                assertEquals(forwarded[0].nests?.length, 1);
                const carried = forwarded[0].nests![0];
                assertEquals(carried.body.raw, node.body.raw);
                const parsed = envelopeFromFrame(carried);
                const original = envelopeFromFrame(node);
                // Python coalesces the two blind-state groups and puts the source seal first.
                // Compare every ordered proof and its actual anchor, not an incidental wrapper layout.
                assertEquals(parsed.bsqs, original.bsqs);
                assertEquals(parsed.ssts, original.ssts);
                assertEquals(new TextDecoder().decode(event.msg).includes("hidden-value"), false);
                yield* call(() => post(receiverUrl, forwarded[0]));
                cursor = event.idx + 1;
                received = true;
                return false;
              },
              systemClock,
              { idleTimeoutMs: 2000, maxDurationMs: 5000 },
            );
            assertEquals(received, true, "grant crossed provider storage and authenticated SSE retrieval");
            const state = yield* call(() => inspectMailbox(mailboxUrl, receiver.pre, [body.said!]));
            assertEquals(state.rows[0].cached, true);
            assertEquals(state.rows[0].pending, false);
            assertEquals(state.sender?.witnesses, wit.wits);
            assertEquals(state.sender?.threshold, 2);
            assertEquals(state.sender?.receipts, [0, 1, 2]);
          };
          const proofs = [issuance, presentationProof].map((proof) =>
            Counter.enclose({
              code: "BlindedStateQuadruples",
              version: Vrsn_2_0,
              qb64: concatBytes(proof.d.qb64b, proof.u.qb64b, proof.td.qb64b, proof.ts.qb64b),
            })
          );
          // Parsing the real nested wire constructs attachment records and preserves all proof domains.
          const [node] = parseBytes(
            messagize(
              partial,
              concatBytes(
                ...proofs,
                ...messageAttachmentGroups({ sourceSeals: [source] }, Vrsn_2_0).map((group) => group.raw),
              ),
              { gvrsn: Vrsn_2_0, genusify: true },
            ),
          );
          const frame = walletGrant ? parseBytes(walletGrant.wire)[0] : signed(grant, holders, [node]);
          now += count - 1;
          yield* call(() => post(holderUrl, frame));
          assertExists(holderHbys[0].db.exns.get(grant.said!));
          for (const [index, signer] of holders.entries()) {
            yield* receiveGrant(walletGrant ? frame : signed(grant, [signer], [node]));
            if (index < holders.length - 1) {
              assertExists(receiverHby.db.pmkm.get([holder.pre, grant.said!]));
              assertEquals(receiverHby.db.exns.get(grant.said!), null);
              assertEquals(receiverHby.db.tmsc.get([holder.pre, credential.said!, grant.said!])?.rdt, "");
              receiverNow = now;
            }
          }
          assertExists(receiverHby.db.epse.get(grant.said!));
          assertEquals(receiverHby.db.exchangeMeta.get(grant.said!)?.receiverTime, receipt);
          assertEquals(receiverHby.db.tmsc.get([holder.pre, credential.said!, grant.said!])?.rdt, receipt);
          assertEquals(receiverHby.db.exns.get(grant.said!), null);

          now += 2000;
          receiverNow = now;
          yield* receiverRuntime.acdc!.baser.reopen();
          yield* receiverHby.db.reopen();
          const [, later] = presentation.present(credential.said!, "revoked", {
            stamp: makeNowIso8601(new Date(now)),
          });
          yield* anchor(later, holders, holderRuntimes);
          accepted(presentation, later);
          yield* call(() => introduce(receiverUrl, holderHbys[0], holder.pre));
          for (const body of [prip, presented, later]) {
            yield* call(() => post(receiverUrl, { body, attachments: [], gvrsn: Vrsn_2_0 }));
          }
          assertEquals(receiverRuntime.acdc!.store.head(prip.said!)?.qb64, later.said);
          yield* receiverRuntime.protocol.exc.processEscrows();
          assertExists(
            receiverHby.db.exns.get(grant.said!),
            "the binding at receipt time survives later TEL updates",
          );
          assertEquals(receiverHby.db.exchangeMeta.get(grant.said!)?.receiverTime, receipt);
          const stored = loadNests(receiverHby.db, grant.said!);
          assertEquals(stored.length, 1);
          assertEquals(stored[0].body.said, credential.said);
          assertEquals(new TextDecoder().decode(stored[0].body.raw).includes("hidden-value"), false);
          assertEquals(
            receiverHby.db.exns.get(credential.said!),
            null,
            "parent acceptance does not dispatch its credential",
          );
          yield* receiveGrant(frame);
          assertEquals(
            receiverHby.db.tmsc.get([holder.pre, credential.said!, grant.said!])?.rdt,
            receipt,
            "replay cannot refresh the receipt",
          );
          const admit = ipexExnBody(receiver.pre, "/ipex/admit", [], {
            message: "admit",
            prior: grant,
            stamp: makeNowIso8601(new Date(now)),
          });
          for (const url of urls) yield* call(() => post(url, signed(admit, [receiver])));
          for (const hby of [holderHbys[0], receiverHby]) {
            assertExists(hby.db.exns.get(admit.said!));
            assertEquals(hby.db.erpy.get(grant.said!)?.qb64, admit.said);
          }
          yield* call(() => assertKeriPyWitnessStores(ctx, witnesses, aliases, issuer.pre, issuer.kever!.sn, 3));
          yield* call(() => assertKeriPyWitnessStores(ctx, witnesses, aliases, holder.pre, holder.kever!.sn, 3));
          if (mailboxUrl) {
            yield* call(() => assertKeriPyWitnessStores(ctx, witnesses, aliases, receiver.pre, receiver.kever!.sn, 3));
          }
        } finally {
          for (const { server, handler } of listeners.reverse()) {
            yield* call(() => server.shutdown());
            yield* call(() => handler.close?.());
          }
          for (const db of walletDbs.reverse()) yield* db.close(true);
          for (const runtime of runtimes.reverse()) yield* runtime.close();
          for (const hby of hbys.reverse()) yield* hby.close(true);
        }
      });
    } finally {
      await witnesses.close();
      await Deno.remove(witnesses.home, { recursive: true });
      await Deno.remove(witnesses.configRoot, { recursive: true });
    }
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
}
