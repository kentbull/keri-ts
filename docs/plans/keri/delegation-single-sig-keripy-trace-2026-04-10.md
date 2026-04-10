# Single-Sig Delegation Trace In KERIpy - 2026-04-10

## Purpose

This document rebuilds the authoritative KERIpy mental model for the
single-signature delegation flow, with special attention to the proxy-mediated
publication path that a delegated inception uses to request approval from its
delegator.

It exists to answer one debugging question:

> What exact model does KERIpy implement for delegated publication, approval,
> anchor discovery, and delegate-commit confirmation, and where does current
> `keri-ts` still diverge?

This is the source of truth for the current reverse-interop goal:

- delegator: KLI / KERIpy
- delegate: Tufa / `keri-ts`
- target outcome: a Tufa delegate is approved by a KLI delegator and KLI
  `delegate confirm` completes successfully

## Authoritative KERIpy Code Seams

- `keripy/src/keri/app/delegating.py`
  - `Anchorer`
  - `DelegateRequestHandler`
  - `delegateRequestExn(...)`
- `keripy/src/keri/app/forwarding.py`
  - `Poster`
  - `Poster.sendEventToDelegator(...)`
  - `introduce(...)`
- `keripy/src/keri/app/habbing.py`
  - `BaseHab.query(...)`
  - `BaseHab.replyEndRole(...)`
- `keripy/src/keri/app/agenting.py`
  - `WitnessInquisitor`
- `keripy/src/keri/app/cli/commands/incept.py`
  - delegated inception entrypoint
- `keripy/src/keri/app/cli/commands/rotate.py`
  - delegated rotation entrypoint
- `keripy/src/keri/app/cli/commands/delegate/confirm.py`
  - delegator approval and confirmation loop
- `keripy/src/keri/app/storing.py`
  - replay/reply cue delivery back onto mailbox topics
- `keripy/src/keri/core/eventing.py`
  - `delegables.` escrow ownership
  - delegated-event unescrow semantics

## Actors And Roles

- Delegated AID:
  - the AID whose `dip` or `drt` requires approval
- Delegator AID:
  - the upstream authority identified in `di`
- Proxy / communication habitat:
  - the local transferable AID that signs mailbox-forwarded publication traffic
  - required for single-sig delegated inception in KERIpy
- Delegate witnesses:
  - witnesses for the delegated AID
  - these receipt the delegated event before the approval request is published
- Delegator witnesses or mailboxes:
  - the endpoints used to deliver `/delegate` mailbox traffic to the delegator
- Delegator controller:
  - the human/local controller that runs `kli delegate confirm`

## High-Level KERIpy Model

KERIpy does not treat delegation approval as one message.

It is a workflow with four distinct protocol phases:

1. The delegate creates a delegated event locally and gets its own witness
   receipts.
2. The delegate publishes two artifacts to the delegator on mailbox topic
   `/delegate`:
   the `/delegate/request` EXN and the raw delegated KEL event stream.
3. The delegate immediately asks a delegator witness for anchor evidence, then
   waits in unanchored escrow until the delegator seals the delegated event.
4. The delegator anchors approval in its own KEL, then confirms the delegate
   becomes locally committed by querying the delegate's witness path and waiting
   for replay-driven acceptance.

The important truth is this:

- the EXN is only the approval notice
- the raw delegated event is what the delegator must eventually accept/process
- the later witness query and replay path is what allows the delegator confirm
  loop to observe that the delegate is now committed

## End-To-End KERIpy Trace

### 1. Delegate creates the delegated event locally

Command entry:

- `keripy/src/keri/app/cli/commands/incept.py`
- `keripy/src/keri/app/cli/commands/rotate.py`

When the newly created or rotated habitat is delegated:

- the CLI builds the local delegated event first
- then calls `delegating.Anchorer.delegation(pre=..., sn=...)`
- this places the event into delegated partial-witness escrow `dpwe.`

What `Anchorer.delegation(...)` does:

- requires the delegated AID to be local
- requires the delegator to already be known locally
- records the event in `dpwe.`
- schedules witness receipt collection through `Receiptor`

Mental model:

- `dpwe.` means:
  "the delegated event exists locally, but do not publish the approval request
  yet because delegate-side witness receipting is not converged"

### 2. Delegate waits for its own witness receipts

Owner:

- `Anchorer.processPartialWitnessEscrow()`

KERIpy gate:

- it checks `db.getWigs(dgkey)`
- publication happens only when witness receipts match the delegated kever's
  witness count

If not complete:

- the workflow stays in `dpwe.`

If complete:

- KERIpy resolves the communication habitat:
  - `GroupHab` uses `mhab`
  - single-sig delegated inception uses the explicit proxy
  - no proxy means failure for single-sig delegated inception

This is already one important protocol truth:

- the publication signer is not the delegated inception AID
- it is the proxy / communication habitat

### 3. KERIpy publishes the approval request through the proxy path

Owner:

- `keripy/src/keri/app/delegating.py::Anchorer.processPartialWitnessEscrow()`

Once witness receipts are complete, KERIpy does exactly three outbound things in
this order.

#### 3.1. Build the raw delegated event stream

KERIpy calls:

- `evt = hab.db.cloneEvtMsg(pre=serder.pre, fn=0, dig=serder.said)`

Then it splits the cloned CESR stream into:

- `srdr`: the delegated event serder
- `evt` attachment bytes: signatures, receipts, and other attached CESR matter

Important:

- this is not a synthetic EXN payload
- it is the real delegated event stream cloned from local event storage

#### 3.2. Build the `/delegate/request` EXN

KERIpy calls:

- `delegateRequestExn(phab, delpre=delpre, evt=bytes(evt), aids=smids)`

The EXN:

- route: `/delegate/request`
- sender: the proxy / communication habitat
- payload `a.delpre`: delegator AID
- embed `e.evt`: the delegated event SAD
- optional `a.aids`: only for multisig flows

Important:

- this EXN is for notification and UX signaling
- it is not itself the delegated event approval object

#### 3.3. Publish two separate `/delegate` mailbox messages

KERIpy sends both through `Poster.send(...)` with:

- destination: delegator AID
- topic: `delegate`
- signer / sender habitat: proxy / communication habitat

The two publications are:

1. `/delegate/request` EXN plus its endorsement attachments
2. Raw delegated KEL event plus its attached CESR material

This is the critical publication model.

KERIpy does not choose between them.
It sends both.

### 4. What the proxy path actually does on the wire

Owner:

- `keripy/src/keri/app/forwarding.py::Poster`

The proxy publication is normally not a direct POST to the delegator.

It is a mailbox-forward flow:

1. Resolve the delegator's endpoint roles.
2. If the delegator has mailbox endpoints, forward to mailbox.
3. Otherwise send directly to controller/agent.
4. Otherwise fall back to one witness.

For mailbox or witness forwarding, `Poster` does this:

1. Call `introduce(hab, mbx)` where `hab` is the proxy habitat and `mbx` is the
   selected mailbox/witness AID.
2. Build a `/fwd` EXN whose modifiers carry:
   - `pre=<delegator AID>`
   - `topic=delegate`
3. Embed the original outbound message bytes at `e.evt`.
4. Endorse the `/fwd` EXN with the proxy habitat.
5. POST the introduction stream plus the `/fwd` EXN stream to the selected
   mailbox/witness endpoint.

### 5. What KERIpy `introduce(...)` sends before the forwarded message

Owner:

- `keripy/src/keri/app/forwarding.py::introduce(...)`

If the remote endpoint has not already receipted the sender's latest event,
KERIpy prepends this bootstrap material:

1. the sender habitat's full KEL replay from `clonePreIter(hab.pre)`
2. the sender habitat's delegation chain from `cloneDelegation(hab.kever)`
3. `hab.replyEndRole(cid=hab.pre)`

That `replyEndRole(...)` stream can include:

- controller KEL replay for `cid`
- witness location replies
- endpoint-role auth replies
- location replies for stored endpoints

Important mental model:

- the proxy path is not just "send `/fwd`"
- it is "introduce sender state and endpoint material, then send `/fwd`"

If reverse interop fails after publication, this bootstrap stream is a prime
suspect because KLI may rely on it to validate or later communicate with the
relevant actors.

### 6. Delegate immediately starts anchor discovery

Still inside `Anchorer.processPartialWitnessEscrow()`, KERIpy immediately calls:

- `self.witq.query(hab=phab, pre=dkever.prefixer.qb64, anchor=seal)`

Where:

- `hab=phab` is still the proxy / communication habitat
- `pre=<delegator AID>`
- route defaults to `logs`
- query anchor is the delegated event seal:
  `{ i: delegated pre, s: delegated sn, d: delegated said }`

This matters because KERIpy does not wait for a later retry pass to begin
approval discovery.

Publication and first anchor query are part of the same phase.

### 7. Delegate moves from `dpwe.` to `dune.`

After sending both `/delegate` publications and issuing the first witness query,
KERIpy:

- removes the event from `dpwe.`
- pins it into `dune.`

Mental model:

- `dune.` means:
  "the delegator has been told, and now we are waiting to learn the delegator's
  sealing event"

### 8. Delegator receives `/delegate` mailbox traffic

Delegator host:

- `keripy/src/keri/app/cli/commands/delegate/confirm.py`

Its `MailboxDirector` polls these topics:

- `/receipt`
- `/multisig`
- `/replay`
- `/delegate`

The `/delegate` topic carries two different things:

1. `/delegate/request` EXN
2. raw delegated KEL event stream

They are processed differently.

#### 8.1. `/delegate/request` EXN path

Owner:

- `DelegateRequestHandler`

Behavior:

- validate payload contains local `delpre`
- extract embedded event SAD
- emit notifier data only

Important:

- this handler does not approve anything
- it only turns the EXN into a controller-facing notification

#### 8.2. Raw delegated event path

Owner:

- normal parser / `Kevery`

Behavior:

- parse the delegated event bytes
- store the event and signatures
- escrow it in `delegables.`

This is the delegator's durable "pending approval" state.

This is the event that `kli delegate confirm` later operates on.

### 9. Delegator approves with `kli delegate confirm`

Owner:

- `keripy/src/keri/app/cli/commands/delegate/confirm.py`

Loop shape:

1. scan `db.delegables`
2. load each escrowed event body from `Evt`
3. detect whether it is a delegated inception `dip` or delegated rotation `drt`
4. confirm the delegator AID is locally controlled
5. prompt or auto-approve
6. anchor the delegated event in the delegator's KEL

Approval anchor behavior for single-sig:

- `--interact` uses an interaction event
- default path uses a rotation event
- the anchor payload is:
  `{ i: delegate pre, s: delegate snh, d: delegate said }`

After anchoring:

- if the delegator has witnesses, KERIpy waits for witness receipts on the
  delegator's own approving event

This is separate from the delegate witnesses.

### 10. After approval, KLI confirms the delegate becomes locally committed

This is where many mental models go wrong.

The delegator does not stop after creating the approval anchor.

It then waits for the delegate event to become locally committed, and it uses
the delegate's witness path to do it.

There are two branches.

#### 10.1. Delegate already exists in local `kevers`

KERIpy sends:

- `witq.query(src=hab.pre, pre=delegate pre, sn=delegate sn)`

Then waits for local key state to advance.

#### 10.2. Delegate is not yet in local `kevers`

This is the delegated inception case that matters for reverse interop.

KERIpy extracts witnesses directly from the delegated event:

- `wits = [werfer.qb64 for werfer in eserder.berfers]`

Then it sends:

- `witq.query(src=hab.pre, pre=delegate pre, sn=delegate sn, wits=wits)`

Then waits until:

- `delegate pre in hby.kevers`

That is the exact single-sig delegated-inception confirmation model.

### 11. What KERIpy witness-targeted queries actually look like

Owner:

- `keripy/src/keri/app/agenting.py::WitnessInquisitor`
- `keripy/src/keri/app/habbing.py::BaseHab.query`

For explicit `wits=...` queries:

- KERIpy chooses one witness AID
- transport is signed by the local habitat
- `qry.q.src` is set to the chosen witness AID
- not to the local habitat prefix

That means the correct witness-targeted query model is:

- signer: local habitat
- queried identifier: remote delegate pre
- query source field: chosen witness AID
- witness list: constrains which remote attester to hit

This is KERIpy-shaped and should not be "simplified" away.

### 12. How the witness answers the query

Query processing owner:

- `keripy/src/keri/core/eventing.py`

Cue delivery owner:

- `keripy/src/keri/app/storing.py`

For successful `logs` query handling:

- witness-side KEL replay is emitted as a `replay` cue
- `Respondant` / storing logic sends those replay messages back to the
  requester on mailbox topic `replay`

The replay sender habitat is the local witness/controller that owns the cue.

Important:

- `delegate confirm` is not waiting for an inline HTTP body reply
- it is waiting for replay traffic that lands on `/replay` and gets processed by
  its mailbox polling loop

### 13. Delegate learns approval too

Separately from the delegator confirm path, the delegate's own `Anchorer`
stays in `dune.` until the delegator sealing event is learned.

When the delegate finds the authorizing seal:

- it pins the approval into `aess.`
- moves from `dune.` to `dpub.`
- republishes the resolved delegation chain to the delegate's own witnesses if
  witness republication is required
- finally marks completion in `cdel.`

That is the delegate-side "approval learned" path.

It is distinct from the delegator-side `delegate confirm` path even though both
depend on witness-mediated replay.

## Proxy-Path Communication Map

For a single-sig delegated inception with explicit proxy, the relevant
communication looks like this:

1. Delegate AID creates `dip` locally.
2. Delegate witnesses receipt the `dip`.
3. Proxy habitat publishes `/delegate/request` EXN to delegator mailbox topic
   `/delegate`.
4. Proxy habitat publishes raw delegated `dip` CESR stream to delegator mailbox
   topic `/delegate`.
5. Each forwarded publication may be wrapped by `/fwd` and preceded by
   `introduce(proxy, mailbox-or-witness)`.
6. Delegator mailbox poller reads `/delegate`.
7. `/delegate/request` becomes a notifier entry.
8. Raw delegated `dip` is parsed and escrowed in `delegables.`
9. Delegator controller anchors approval in its own KEL.
10. Delegator waits for receipts on its approving event.
11. Delegator queries one delegate witness for the delegate's KEL using `logs`.
12. Delegate witness publishes `/replay` back to the delegator mailbox path.
13. Delegator mailbox poller reads `/replay`.
14. Delegator locally accepts the delegate event and `delegate confirm`
    completes.

## Step-By-Step Tufa Parity Audit

This section only audits the parts that matter for the current reverse-interop
failure.

### 1. Delegate-side witness receipt gate before publication

- KERIpy:
  `Anchorer.processPartialWitnessEscrow()` waits for full witness receipts.
- Tufa:
  `packages/keri/src/app/delegating.ts::witnessReceiptsComplete(...)`
  gates publication the same way.
- Status:
  aligned.

### 2. Single-sig delegated inception requires a proxy communication habitat

- KERIpy:
  no proxy means failure for single-sig delegated inception publication.
- Tufa:
  `Anchorer.communicationHab(...)` requires explicit proxy for delegated
  inception.
- Status:
  aligned.

### 3. Publish `/delegate/request` EXN to mailbox topic `/delegate`

- KERIpy:
  yes, via `postman.send(... topic="delegate" ...)`.
- Tufa:
  yes, via `poster.sendExchange(... route="/delegate/request",
  topic="/delegate" ...)`.
- Status:
  aligned after the recent publication-path fix.

### 4. Publish raw delegated event bytes to mailbox topic `/delegate`

- KERIpy:
  yes, separately from the EXN.
- Tufa:
  yes, via `poster.sendBytes(... topic="/delegate" ...)`.
- Status:
  aligned in structure.

### 5. Issue the first delegator-witness anchor query immediately in the same
publication phase

- KERIpy:
  yes, inside the same `processPartialWitnessEscrow()` pass.
- Tufa:
  yes, via `queueDelegatorWitnessQueryNow(...)`.
- Status:
  aligned after the recent fix.

### 6. Use KERIpy-style witness-targeted query shape

- KERIpy:
  signer is local hab, but `qry.q.src` is the chosen witness AID.
- Tufa:
  current query path preserves that shape for explicit witness-targeted queries.
- Status:
  aligned.

### 7. Witness-side `logs` query acceptance for reopened durable remote state

- KERIpy:
  query answers are based on durable accepted state, not only hot cache.
- Tufa:
  `Kevery.decideQuery()` now uses `db.getKever(pre)` for `logs`, `ksn`, and
  `mbx`.
- Status:
  aligned after the recent fix.

### 8. Proxy introduction stream before `/fwd`

- KERIpy:
  always `introduce(proxy, mailbox-or-witness)` when needed, which includes:
  - sender KEL replay
  - sender delegation chain
  - `replyEndRole(cid=proxy pre)`
- Tufa:
  `introduce(...)` also prepends:
  - sender KEL replay
  - sender delegation chain
  - `replyEndRole(hab.pre)`
- Status:
  structurally aligned, but this remains a high-value verification seam because
  reverse interop may depend on exact bootstrap material.

### 9. Delegator mailbox polling of `/delegate` and `/replay`

- KERIpy:
  `delegate confirm` polls both `/delegate` and `/replay`.
- Tufa:
  local runtime does the analogous thing, but the current failing reverse-interop
  case uses KLI as the delegator.
- Status:
  not the current suspect on the Tufa side.

### 10. Delegator locally accepts the forwarded delegated event into the pending
approval path

- KERIpy->KERIpy expectation:
  the raw delegated event forwarded on `/delegate` becomes local delegator
  parser state and lands in `delegables.`
- Current Tufa->KLI reality:
  the raw delegated `dip` does land in KLI `delegables.` during the failing
  reverse-interop run.
- Status:
  publication existence is aligned well enough to reach pending approval.
  The remaining break is later than this seam.

## Current Best Explanation Of The Failure

The failure no longer looks like:

- "Tufa never sent the approval request"
- "Tufa never sent the delegated event"
- "Tufa witness `logs` queries are fundamentally wrong"
- "the first live replay forwarding failure was the only transport bug"

The evidence now looks more like this:

1. Tufa publishes both the `/delegate/request` EXN and the raw delegated `dip`
   to the delegator mailbox topic `/delegate`.
2. KLI stores the delegated `dip` in `delegables.`.
3. Tufa witnesses accept the exact KLI witness-targeted `logs` query shape and
   produce a `replay` cue offline.
4. The first concrete live `/replay` transport break in `splitCesrStream()` is
   fixed, but the full reverse-interop row still hangs.

That points to a narrower conclusion:

- the remaining failure is most likely in the live post-approval replay return
  path or in exact publication/bootstrap equivalence that still matters after
  the event reaches `delegables.`

## Most Likely Remaining Break Seams

Ordered by current probability.

### 1. The live post-approval `/replay` return path is still not KERIpy-equivalent enough

Candidates:

- a second `/fwd`-or-mailbox transport mismatch still exists after the splitter
  fix
- replay reaches a mailbox provider but not the exact topic KLI is polling
- replay is delivered but not processed the same way KERIpy expects in
  `delegate confirm`

### 2. The `/delegate/request` EXN is still not field-for-field KERIpy-shaped

Candidates:

- before the latest review pass, Tufa had no single authoritative
  `exchange(...)` helper and its EXN builders had drifted from KERIpy
  version-1 semantics
- recipient-bearing EXNs in Tufa did not project recipient into payload `a.i`,
  which changes SAIDs relative to KERIpy
- notification-style EXNs like `/delegate/request` and `/oobis` were being sent
  with explicit recipients that KERIpy omits

Current state:

- Tufa now has a central `exchange(...)` helper mirroring KERIpy version-1
  recipient projection rules
- `/delegate/request` and `/oobis` now omit EXN recipient to match KERIpy more
  closely
- this removes one confirmed SAID-shape drift, but does not yet prove the full
  reverse-interop timeout is solved

This is not the leading explanation for the current timeout, because
`delegate confirm` operates from `delegables.`. But it is still a real parity
review target.

### 3. The proxy bootstrap stream may still differ subtly from KERIpy `introduce(...)`

Candidates:

- sender KEL replay ordering
- delegation-chain ordering
- `replyEndRole(proxy)` material shape
- exact introduction-vs-`/fwd` concatenation

## What To Verify Next

The next debugging pass should answer these questions in order.

1. In a fresh failing Tufa->KLI run, where does the post-approval replay die:
   cue creation, `/fwd` wrapping, mailbox topic storage, or KLI mailbox
   consumption?
2. Does Tufa's `/delegate/request` EXN exactly match KERIpy's
   `delegateRequestExn()` contract, especially around `rp` and payload shape?
3. Does the proxy-forwarded introduction stream from Tufa match what KERIpy
   would send closely enough for KLI validation and later witness discovery?
4. Is there any remaining live transport boundary that still splits or reshapes
   replay traffic after the fixed `splitCesrStream()` seam?

## Verdict

The real problem is no longer "does Tufa send the approval request and raw
delegated event?"

It does, and KLI reaches `delegables.`.

The real problem is now more specific:

- KLI still does not complete the same post-approval commitment path it
  completes when a KERIpy delegate uses the same proxy/mailbox workflow

So the debugging target is now sharply defined:

- review the remaining replay-return path and exact EXN/bootstrap parity, not
  the existence of the initial `/delegate` publications
