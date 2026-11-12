# Browser wallet end to end, November 2026

Question: does a keri-ts wallet opened with `openWebWallet` in a real browser, on IndexedDB, work against real witnesses and a real counterparty over the network? This is the evidence behind `deno task test:browser:wallet`. Observed and inferred statements are marked; nothing is inferred unless the sentence says so.

## What ran

- **Page**: `packages/keri/test/browser-wallet/steps.ts`, bundled with the shared `browser_lane.ts` machinery and served at `http://localhost:<port>`. Every server is on `http://127.0.0.1:<port>`, so every request is cross origin.
- **Wallet**: `openWebWallet({ name, bran })` with no `runtime` option. The page calls library workflows only (`makeHab`, `beginOobi`/`waitForOobi`, `completeEvent`/`eventStatus`, `addMailbox`/`mailboxStatus`/`waitForMailboxState`, `WalletAuthor`, `runtime.operations.issuance`, `beginIssuance`, `approveIssuanceExchange`, `waitForIssuance`, `admitIssuance`, `deliverIssuanceAdmit`, `Wallet.recordAdmission`/`recordIssued`/`inventory`).
- **Witness**: KERIpy `main` profile (`c7e74adc`), the transport lane's fixture, **served at KERI v2** (`--protocol-version 2`, new `WITNESS_PROTOCOL_VERSION` in `browser-transport-witness.sh`, default unchanged). One witness, so inception uses `toad 1` and expects 1 receipt.
- **Mailbox**: `tufa mailbox start` from this working tree. **Counterparty**: `tufa` CLI commands run by `scripts/ci/browser-wallet-peer.ts` in the same Docker network namespace, driven by the runner over HTTP (`POST /tufa`). Its store is its own LMDB directory in the named volume `keri-ts-browser-pr15b`.
- **Network**: one anchor container owns the namespace and publishes the ports on 127.0.0.1; witness, mailbox and counterparty join it. Their location replies therefore advertise `127.0.0.1:<port>`, which is also right inside the Firefox container, which joins the same namespace. Nothing is bind-mounted and no LMDB store is opened on the macOS host.
- **Engines**: Chromium 141.0.7390.37 and WebKit 26.0 on the macOS host, Firefox 142.0.1 in the Linux container (`scripts/ci/browser-wallet-firefox.sh`).

## Results

Final runs on this branch with the one-line `posterDelivery` patch below applied locally (without it steps 4a and 4b fail, see defect 1). Wall-clock per step, seconds.

| Step                                                                       | Chromium | WebKit   | Firefox                                                  |
| -------------------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------- |
| 1 open wallet, request persistent storage                                  | pass 0.3 | pass 0.3 | pass 12.2 (waits 10 s for a pending persistence request) |
| 2 incept with witness, collect receipt (`eventStatus` complete, 1 receipt) | pass 0.3 | pass 0.4 | pass 2.3                                                 |
| 3a counterparty provisioned on the shared mailbox                          | pass 3.0 | pass 3.1 | pass 3.0                                                 |
| 3b mailbox authorized, OOBIs resolved both ways                            | pass 0.8 | pass 0.9 | pass 0.9                                                 |
| 4a holder: v2 DH credential from the counterparty, admitted                | pass 4.6 | pass 4.4 | pass 5.8                                                 |
| 4b issuer: v2 DH credential to the counterparty, counterparty admits       | pass 4.7 | pass 4.6 | pass 7.4                                                 |
| 5 close, reopen, durable state present, mailbox polling resumes            | pass 0.8 | pass 0.9 | pass 1.9                                                 |
| 6 rotate, collect receipt, counterparty sees new key state                 | pass 2.1 | pass 2.1 | pass 2.9                                                 |
| 7 close, store lock released                                               | pass 0.0 | pass 0.0 | pass 0.0                                                 |

Without the patch (this branch as committed, Chromium and WebKit): steps 1, 2, 3a, 3b, 5, 6, 7 pass; 4a fails after 62 s and 4b after 141 s in Chromium (both in WebKit for 4a; 4b in WebKit was not run unpatched in the final configuration), and step 5 then asserts an empty inventory.

What each step asserts: 1 the open returns and `health()` is `ok`; 2 `eventStatus` is `complete` and the stored `wigs` hold 1 receipt; 3b `oobiStatus` resolved on both sides, `mailboxStatus` `authorized`, the counterparty read the KEL from the browser's mailbox OOBI; 4 `issuanceStatus` reaches `done`/`admitted` (holder) and `done`/`issued` (issuer) and `Wallet.inventory()` lists the credential, and the Admit pointer `erpy` exists on the issuer; 5 identifier, key state at its current sequence number, every event `complete`, 1 receipt, mailbox `authorized`, both credentials, and no mailbox cursor index lower than before the close, then the counterparty sends a new message and the `/challenge` cursor is created past -1; 6 `eventStatus` complete for the rotation with 1 receipt, and the counterparty, after resolving the witness OOBI, holds the same `s` and `d` in `baser.states`; 7 `navigator.locks.query()` shows no lock for `storeLockKey`.

## Defects and rough edges

Classification: **fixed here**, **keri-ts**, **wallet API**, **harness**.

1. **v2 issuance delivery fails for a multi-message wire. keri-ts, other agent's file.** `posterDelivery` (`packages/keri/src/app/ipex/issuance.ts`) calls `Poster.send` (one message) with the proof support plus Grant (several frames), which the mailbox forwarding path rejects. Observed on the counterparty (`tufa ipex grant --issue --resume`, exit 1): `Error: Forwarding requires one complete CESR message.` Observed in the browser: the same `ValidationError` as the cause of the runtime failure in defect 2. Cause read in `forwarding.ts` (`buildForwardedDelivery`, `frames.length !== 1`); `Poster.sendStream` splits frames. Smallest fix, verified to make 4a and 4b pass in all three engines:
   ```diff
   -export function posterDelivery(postman: Pick<Poster, "send" | "wait">): IssuanceDelivery {
   +export function posterDelivery(postman: Pick<Poster, "sendStream" | "wait">): IssuanceDelivery {
   -      const outcome = yield* postman.wait(postman.send({ src, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msg }, {
   +      const outcome = yield* postman.wait(postman.sendStream({ src, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msgs: [msg] }, {
   ```
   Not applied in this PR (file owned by another agent), so the lane is red at 4a and 4b on this base.
2. **A failed delivery in the operation owners crashes the whole runtime, silently. keri-ts and wallet API.** Observed (Chromium, unpatched 4b): the issuance stayed `active`/`exchangingKeys`; the wallet's stores were closed (`DatabaseNotOpenError: Store ... is not open` on the next read) and `health()` still said `ok`; `close()` then rejected with `AggregateError: Web wallet failed <- ValidationError: Forwarding requires one complete CESR message.` An app can learn of the crash only from `close()`. Needs a keri-ts change (an operation owner records a delivery failure on its operation, as `IssuanceEndState` `failed` allows, instead of throwing out of the runtime) and a wallet change (`WebWallet.health()` or a `closed` promise reporting a crashed composition, so the UI can say the wallet stopped).
3. **A v1 identifier cannot take part in v2 issuance. Harness (and documentation).** Observed on the counterparty with the transport lane's default v1 witness and a v1 browser identifier: `Error: Refusing a v2 message for <aid>, whose latest accepted event is v1.` The lane therefore serves the witness at v2 and the browser identifier is v2 (`makeHab` default). An app using KERIpy v1 witnesses cannot use v2 IPEX with them.
4. **`recordIssued` could not read derivation coordinates. Fixed here (wallet).** Observed: `ValidationError: Exact derived update coordinates are unavailable`. The runtime's operation owners kept them in a memory store while `RegistryCustody` reads the wallet table. `openWebWallet` now passes `operationStores.derived` backed by the inventory (`WalletDerivedUpdates`, exported) and accepts `runtime.operationStores`. Patch changeset for `@keri-ts/wallet`.
5. **Custody on a registry conflicts with DH issuance. keri-ts, message only.** Observed on the counterparty (`vc registry incept --with-custody`) and in the browser (`createCustody` before `beginIssuance`): `ValidationError: Registry root conflicts with this live DH operation`. A DH-issued registry must not have a custody root; the message does not say so. The lane does not create custody for it.
6. **KRAM without windows. keri-ts, merged elsewhere; wallet default fixed here.** Observed before the windows were set: the first Grant to the browser made the runtime crash silently (same symptom as defect 2; the text "No KRAM cache type for message" was not read by this lane, it was reported by the coordinator). The lane then passed 60 s lag windows (`[1000, 60000, 60000, 300000, 60000, 60000, 300000]`) and passed. The final runs use the new wallet default `WALLET_KRAM_CACHES` (5 min drift, 24 h for every lag and pruning window). Not tried: any windows tighter than 60 s, so what a short window drops was not observed here.
7. **Unauthorized mailbox polling in a tight loop. keri-ts or wallet.** Observed: `HTTP 403 POST http://127.0.0.1:55801/ ... Query requester is not authorized` 78 times in one Chromium run and 158 in one WebKit run (earlier configuration), starting when the identifier exists and ending when `addMailbox` is accepted. Inferred, not measured, that nothing backs off. A poller should skip a mailbox the identifier is not authorized on, or back off.
8. **Firefox leaves the persistence request pending.** Observed: `wallet.storage` did not settle in 10 s in headless Firefox, while the open itself returned at once; the documented behavior. Not a defect; the lane records `"pending after 10 s"` (this is why Firefox step 1 takes 12 s).
9. **Step 4b stranded for 120 to 150 s in some runs. Fixed here (keri-ts and harness).** Observed in about one fresh-server Chromium or WebKit run in four (7 of 25 on one day), usually the first engine after the servers started, never in 4a. The counterparty's `ipex poll` ends at the first IPEX message newer than its start, and step 4a's Admit is still in its mailbox when 4b begins, so the poll ends at a point that depends on timing, before or after the browser's Grant and DH query have arrived. Two outcomes, both read from the counterparty's output. (a) The poll ended before the Grant (4 of the 7): `ipex setup` exited in under a second with `Select the exact unanchored pending issuance Grant for this local party`, nothing was left to answer the DH query, and the browser sat in `exchangingKeys` until its 120 s limit. The step now polls and retries setup until the Grant is stored. (b) The poll took the Grant and the DH query (3 of the 7; its output showed 11 messages where passing runs show 8, and its stderr showed the query accepted): a DH owner holds a query that arrives before consent in memory only, the poll process exited and dropped it, and `ipex setup` then rejected every identical resend as a KRAM replay (`decision: drop, reason: replay`, once a second for 150 s). The issuer's re-dating rule used its own 24 h window as the estimate of the peer's 60 s one, so it never re-dated. The issuance owner now sends a freshly signed query on every resend. A real wallet runs its poller continuously and consents in the same process, so (a) cannot occur; (b) can: any restart or retained query older than the peer's window loses the query, which is why the library changed.
10. **Grant arrival has no notification for the app.** Rough edge. The holder page polls `issuanceStatus` until `needs: "exchange"` (it throws until the Grant is stored, so the poll must tolerate `ValidationError: No issuance was begun for this Grant`). A change feed or a "pending grants" read would remove the poll.
11. **Harness facts.** `tufa query` fails for the counterparty (`No endpoint URL found for query destination <witness>`) until it resolves the witness; the scenario resolves the witness OOBI instead. The counterparty needs KRAM windows in its config file, which the CLI has no flag for (`POST /config` on the control server). The mailbox host holds the browser's KEL only as of `addMailbox`; whether the mailbox serves the rotation was not tested (inferred: it does not, which is why the scenario reads the rotation from the witness).
12. **Not exercised.** Close and reopen in the middle of an issuance (holder adoption, issuer `interrupted` then a new Grant) is not in the scenario; `IssuanceOperationStore` entries are process-local, so the lane makes no claim about issuance status after a reopen. Group identifiers, HTTPS, and the hosted-witness backend are untouched.

## What an app developer has to write today

```ts
// open
const w = await openWebWallet({ name, bran });            // lock, IndexedDB, runtime with mailbox polling
await Promise.race([w.storage, timeout]);                 // Firefox may never settle
// OOBIs
beginOobi({ oobiery: w.runtime.oobiery }, url);
await run(() => waitForOobi({ db: w.hby.db }, url, { timeoutMs }));   // then check status.state === "resolved"
// identifier
const hab = w.hby.makeHab("name", undefined, { wits, toad, ...});
await run(() => completeEvent({ hby, protocol: runtime.protocol, http: runtime.http, clock: runtime.clock,
                                withDelegation() { throw ... } }, hab, 0));
eventStatus(w.hby, hab.pre, 0);                           // "complete"
// mailbox
await run(() => addMailbox({ hby, http: runtime.http, reactor: runtime.reactor, protocol: runtime.protocol }, hab, mailboxPre));
await run(() => waitForMailboxState(() => mailboxStatus(hby, hab.pre, mailboxPre), { want: "authorized", deadline, clock }));
// receive a credential (holder)
const ops = w.runtime.operations!.issuance;
poll issuanceStatus(ops, grant) until needs === "exchange";
approveIssuanceExchange(ops, { hab, grant });
await run(() => waitForIssuance(ops, grant, { timeoutMs, until: s => s.state !== "active" || s.needs === "admit" }));
const a = await run(() => admitIssuance(ops.deps, { hab, grant }));
await w.wallet.recordAdmission(grant, a.admit.said!, { consent: true });     // before delivery
await run(() => deliverIssuanceAdmit(ops.deps, hab, a));
// issue a credential
const custody = new RegistryCustody({ hby, hab, registry: runtime.acdc!.store, db: w.inventory });
const author = new WalletAuthor(w.wallet, runtime.acdc!, new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock), custody);
const rip = await run(() => author.incept("registry", hab.pre));            // no custody root for DH issuance
const credential = author.create(author.registry("registry", hab.pre), { issuee, attribute });
await run(() => beginIssuance(ops, { hab, credential, options: { recipient, message: "", artifacts: [] } }));
await run(() => waitForIssuance(ops, grant, { timeoutMs }));
w.wallet.recordIssued(credential, head.said!, { blinder: custody.derivedOpening(head) });
// rotate
hab.rotate({}); await run(() => completeEvent(deps, hab, hab.kever!.sn));
// close
await w.close();
```

Every `run(...)` is an Effection root; the library workflows are generators, and the page bridges them to promises by hand. The calls an app should not have to write: the completion-deps record (`hby`, `protocol`, `http`, `clock`, `withDelegation`) built from the runtime three times; the three-way hand-off of an Admit (admit, record admission, deliver); the Grant poll; the `RegistryCustody`/`WalletAuthor` construction; the OOBI begin-and-wait pair with its status check; and `recordIssued` with `derivedOpening(head)` after an issuance. A wallet-level `w.identifiers.incept`, `w.oobis.resolve`, `w.mailboxes.add`, `w.credentials.{receive,issue}` over these, with typed results instead of `status.state` checks, is the shape these calls point to.

## Reproducing

```sh
deno task test:browser:wallet chromium webkit      # starts and removes the Docker servers itself
bash scripts/ci/browser-wallet-firefox.sh          # Firefox in the Linux container
KERI_WALLET_SERVERS="$(bash scripts/ci/browser-wallet-servers.sh up)" deno task test:browser:wallet webkit   # keep servers up between runs
bash scripts/ci/browser-wallet-servers.sh down
```

## CI

Local only, like the transport lane: its servers are Docker containers over the interop harness' cached KERIpy volumes and a LMDB rebuild, which CI does not provision cheaply, and the lane adds a counterparty and about a minute of Docker setup. The PR's `keri-ci` block selects nothing by owner's instruction.
