# Multisig and IPEX Workflow Architecture and Port Plan

## Why this document exists

This document captures the end-to-end KERIpy behavior for:

- multisig coordination (`/multisig/*` and `/multisig/exn`)
- IPEX protocol messages (`/ipex/*`) with emphasis on `grant` and `admit`
- single-sig and multisig paths, including multisig-to-multisig scenarios

The goal is to make implementation in `keri-ts` concrete and sequenced rather
than inferred from test code.

## Scope

In scope:

- KERIpy architecture that drives multisig and IPEX workflows
- exact message movement for:
  - single-sig grant/admit
  - multisig grant/admit
  - multisig-to-multisig (2-of-2 to 2-of-2) mental model
- what to build in `keri-ts`, in what order

Out of scope:

- full ACDC schema design
- UX for GUI wallets
- transport-specific API shape (HTTP endpoints can be decided later)

---

## 1) KERIpy Architecture Reference (source of truth)

### 1.1 Core components and responsibilities

### IPEX protocol logic

- `keripy/src/keri/vc/protocoling.py`
  - `ipexApplyExn`, `ipexOfferExn`, `ipexAgreeExn`, `ipexGrantExn`,
    `ipexAdmitExn`, `ipexSpurnExn`
  - `IpexHandler.verify()` enforces chain validity via `PreviousRoutes`
  - `IpexHandler.handle()` emits notifications for `/exn/ipex/*` actions

Important invariant from `PreviousRoutes`:

- `offer <- apply`
- `agree <- offer`
- `grant <- agree`
- `admit <- grant`
- `spurn <- apply|offer|agree|grant`

### Exchange router and signature gate

- `keripy/src/keri/peer/exchanging.py`
  - `Exchanger.processEvent()` validates signatures and route handler
    verification
  - persists exn messages and attachments to db
  - escrows partially-signed messages (`epse`, `esigs`, `epsd`, `epath`)
  - `Exchanger.complete(said)` checks if exn is saved
  - `Exchanger.lead(hab, said)` elects single sender for group-originated final
    sends

### Multisig coordination layer

- `keripy/src/keri/app/grouping.py`
  - `multisigExn(ghab, exn)` wraps an embedded EXN in route `/multisig/exn`
  - `MultisigNotificationHandler` handles `/multisig/*` routing
  - `Multiplexor.add()` tracks and notifies on embedded event/exn SAIDs
  - `Counselor` manages multisig event escrows and completion for KEL/TEL
    activities

### IPEX CLI orchestration

- `keripy/src/keri/app/cli/commands/ipex/grant.py`
- `keripy/src/keri/app/cli/commands/ipex/admit.py`
- `keripy/src/keri/app/cli/commands/ipex/join.py`

These files show practical sequencing used in the field.

---

## 2) Conceptual model to keep straight

There are two separate protocol layers that interleave:

1. business/protocol message (IPEX): `/ipex/grant`, `/ipex/admit`, etc.
2. coordination message (multisig): `/multisig/exn` containing an embedded
   `/ipex/*` EXN

`/multisig/exn` is not the business protocol. It is a proposal/signaling
envelope among group participants.

Once enough member signatures exist on the embedded EXN, exactly one elected
member sends the embedded `/ipex/*` message to the external recipient.

---

## 3) End-to-end KERIpy flows

## 3.1 Single-sig IPEX grant -> admit

### Grant side

1. Issuer loads credential and issuance artifacts:
   - ACDC (`acdc`)
   - TEL issuance (`iss`)
   - KEL anchor event (`anc`)
2. Issuer creates `/ipex/grant` with:
   - payload `a.m` (human message), `a.i` (recipient AID)
   - embeds `e.acdc`, `e.iss`, `e.anc`
3. Issuer endorses/signs and locally parses the message.
4. Issuer sends on `topic="credential"` to recipient.

### Admit side

1. Recipient receives and verifies `/ipex/grant`.
2. Recipient parses embedded `anc`, `iss`, `acdc` and waits until credential is
   stored.
3. Recipient creates `/ipex/admit` referencing grant SAID (`p = grant.said`).
4. Recipient signs and sends `/ipex/admit` back to grant sender
   (`grant.ked["i"]`).

## 3.2 Multisig issuer (group) -> single recipient grant

1. One group member creates embedded `/ipex/grant` EXN as group sender
   (`hab=GroupHab`).
2. That member wraps it with `/multisig/exn` and sends to peer members on
   `topic="multisig"`.
3. Other members approve and co-sign embedded EXN (often through `ipex join`
   flow).
4. Members forward coordination messages to each other until
   `Exchanger.complete(embedded_said)`.
5. Elected lead (`Exchanger.lead`) sends final embedded `/ipex/grant` once to
   recipient on `topic="credential"`.

## 3.3 Multisig recipient (group) admit response

Same pattern in reverse:

1. A member creates `/ipex/admit` from group habitat.
2. Wrap with `/multisig/exn` and circulate to group members.
3. Collect signatures and completion.
4. Elected lead sends final `/ipex/admit` to issuer.

## 3.4 Multisig 2-of-2 -> multisig 2-of-2 mental sequence

This is the case from the Charles conversation.

Assume:

- Granting group `G1` has members `G1A`, `G1B`
- Admitting group `G2` has members `G2A`, `G2B`

### Canonical behavior

1. `G1A` composes embedded `/ipex/grant` (sender is group AID `G1`).
2. `G1A` sends `/multisig/exn { e.exn = /ipex/grant }` to `G1B`.
3. `G1B` approves/signs embedded grant and multicasts coordination back as
   needed.
4. When embedded grant completion is reached, one G1 lead sends `/ipex/grant` to
   recipient side.
5. On recipient side, group `G2` members process received grant and prepare
   admit.
6. One member (say `G2A`) creates embedded `/ipex/admit` and wraps in
   `/multisig/exn` to `G2B`.
7. After both signatures, elected G2 lead sends final `/ipex/admit` back to G1.

### Why the observed "both members sent grant" can still make sense

Because coordination and delivery are separate concerns:

- each member may participate in signing/forwarding during `/multisig/exn`
  exchange
- only lead should send final external `/ipex/*` to counterpart
- if implementation around lead election/send guard is imperfect, duplicates are
  possible but typically harmless at protocol level if idempotent checks exist

### "Can we sign `/multisig/exn {/ipex/admit}` instead?"

Yes for internal coordination, but the counterpart ultimately needs the actual
`/ipex/admit` protocol message with proper `p` reference chain. `/multisig/exn`
is not a substitute for final protocol delivery; it is the signer-coordination
envelope.

---

## 4) Protocol details that matter during port

## 4.1 Route and chain validation

`IpexHandler.verify()` enforces prior-link constraints via `p` and
`PreviousRoutes`. `keri-ts` must preserve this exactly to avoid invalid branch
acceptance.

## 4.2 Embedded artifacts in grant

Practical grant portability requires carrying:

- credential SAD (`acdc`)
- issuance TEL event (`iss`)
- anchoring KEL event (`anc`)

Recipient admit flow expects to parse all three.

## 4.3 Exchanger behavior is central

Need parity features:

- signature-threshold verification for trans signatures
- partial-signature escrow
- persistence of exn, attachments, and reply linkage
- route handler registration and execution

## 4.4 Multisig completion and lead election

Group-originated `/ipex/*` should not be broadcast externally by all members.
Use deterministic lead election based on signing index in collected signatures.

---

## 5) Current `keri-ts` state (as of this document)

## 5.1 What exists

- basic single-sig habitat creation and key management
  - `packages/keri/src/app/habbing.ts`
  - `packages/keri/src/app/keeping.ts`
- local keystore and event storage foundations
  - `packages/keri/src/db/keeping.ts`
  - `packages/keri/src/db/basing.ts`
- core CLI commands: `init`, `incept`, `export`, `agent`, `annotate`, `db.dump`
  - `packages/keri/src/app/cli/command-definitions.ts`
- single-sig interop smoke test with `kli`
  - `packages/keri/test/integration/app/interop-kli-tufa.test.ts`

## 5.2 What is missing for this effort

- `Exchanger` equivalent and exn db plumbing
- `/multisig/*` handler + `Multiplexor` equivalent
- group habitat model (`GroupHab`) and member management flows
- IPEX handlers and creators for `/ipex/*`
- credential registry/verifier integration needed by grant/admit
- multisig and IPEX CLI commands

---

## 6) Port plan for `keri-ts`

Implementation order is dependency-first, not command-first.

## Phase 0: Architectural prep and boundaries

Deliverables:

- create modules:
  - `packages/keri/src/peer/exchanging.ts`
  - `packages/keri/src/app/grouping.ts`
  - `packages/keri/src/vc/protocoling.ts`
- define minimal interfaces for:
  - `ExnHandler` (`resource`, `verify`, `handle`)
  - `Notifier` abstraction
  - parser bridge for local parse/replay operations

Exit criteria:

- internal API contracts agreed and documented

## Phase 1: Exn persistence and router foundation

Deliverables:

- db schema additions for exchange messages and escrows (analogous to `exns`,
  `erpy`, `epse`, `esigs`, `epsd`, `epath`, `essrs`)
- `Exchanger` class with:
  - route registration
  - signature verification pipeline
  - log/persist event behavior
  - partial-signed escrow processing
  - `complete(said)` and `lead(hab, said)`

Exit criteria:

- unit tests: route dispatch, signature threshold acceptance/rejection, escrow
  timeout paths

## Phase 2: Group model and multisig coordination

Deliverables:

- `GroupHab` representation and member fields (`smids`, `rmids`, `mhab`)
- `multisigExn()` for `/multisig/exn` wrapper construction
- `Multiplexor` and `/multisig/*` handler loading
- storage for message/member associations (analogous to `meids`, `maids`)

Exit criteria:

- integration tests proving:
  - member proposal/approval circulation
  - completion detection
  - single lead final send behavior

## Phase 3: IPEX protocol core

Deliverables:

- `IpexHandler` with route-chain validation equivalent to `PreviousRoutes`
- creators:
  - `ipexApplyExn`
  - `ipexOfferExn`
  - `ipexAgreeExn`
  - `ipexGrantExn`
  - `ipexAdmitExn`
  - `ipexSpurnExn`

Exit criteria:

- unit tests for all valid/invalid route-chain combinations
- duplicate-response prevention tests

## Phase 4: Grant/Admit first vertical slice

Prioritize `grant` and `admit` before full IPEX breadth.

Deliverables:

- single-sig `grant` command + handler path
- single-sig `admit` command + handler path
- multisig wrapping behavior for both:
  - generate embedded `/ipex/*`
  - wrap in `/multisig/exn`
  - circulate to peers
  - lead-only final send

Exit criteria:

- end-to-end tests:
  - 1x1 grant/admit
  - 2x2 grant/admit
  - duplicate delivery resistance

## Phase 5: Remaining IPEX and hardening

Deliverables:

- complete `apply/offer/agree/spurn` commands and handlers
- notification + join UX parity
- telemetry/logging for stuck escrows and unmet signature thresholds

Exit criteria:

- interop tests against KERIpy/Signify scenarios
- documented troubleshooting flows

---

## 7) Command and UX plan in `keri-ts`

Add CLI groups (names can be adjusted, behavior should not):

- `tufa ipex grant`
- `tufa ipex admit`
- `tufa ipex join` (for multisig approval queue)
- later: `apply`, `offer`, `agree`, `spurn`, `list`

- `tufa multisig ...` group for core KEL coordination primitives

Initial practical strategy:

1. deliver `ipex grant`, `ipex admit`, `ipex join` first
2. expose multisig coordination hooks only as required by those commands
3. generalize into full `multisig` command suite afterward

---

## 8) Test plan and parity matrix

Minimum matrix:

1. single-sig issuer -> single-sig recipient (`grant` then `admit`)
2. multisig issuer (2-of-2) -> single recipient
3. single issuer -> multisig recipient (2-of-2 admit)
4. multisig issuer (2-of-2) -> multisig recipient (2-of-2)
5. negative:
   - wrong `p` chain
   - stale escrow
   - insufficient signatures
   - non-member multisig submission

Interop target:

- keep a small deterministic set of cross-language integration tests mirroring
  `kli` and KERIpy behavior, similar in spirit to existing
  `interop-kli-tufa.test.ts`.

---

## 9) Key risks and design decisions to lock early

1. **Lead election determinism**
   - Must be deterministic from collected signatures; define tie and retry
     semantics.

2. **Escrow timeout policy**
   - KERIpy default for partial signed exchange escrow is short
     (`TimeoutPSE = 10s`).
   - Confirm if `keri-ts` should match or make configurable.

3. **Idempotency**
   - Duplicate external sends may happen in distributed timing races.
   - Ensure processing is idempotent by SAID and chain linkage.

4. **Credential artifact availability**
   - `grant` assumes availability of `acdc/iss/anc`; missing artifacts should
     fail early with explicit operator feedback.

5. **Role/end-role semantics**
   - conversation highlighted confusion around "who sends what."
   - document final authoritative behavior in command help and examples to
     prevent operator mismatch.

---

## 10) Practical answer to the original "which flow is right?"

For multisig grant/admit, the most stable mental model is:

1. internal group coordination uses `/multisig/exn` carrying embedded `/ipex/*`
2. each required signer approves/signs inside that coordination
3. one lead sends final embedded `/ipex/grant` or `/ipex/admit` externally
4. recipient side repeats the same pattern for its own group if recipient is
   multisig

So in a 2-of-2 to 2-of-2 exchange, both members sign, but final external send
should be lead-only for each side.

---

## 11) Suggested implementation kickoff checklist

- [ ] create `Exchanger` skeleton + db tables
- [ ] create `grouping.multisigExn` + `/multisig/exn` handler
- [ ] implement `IpexHandler` route-chain verify
- [ ] implement `ipexGrantExn` and `ipexAdmitExn`
- [ ] wire `ipex grant` and `ipex admit` commands (single-sig first)
- [ ] add `ipex join` for multisig approval
- [ ] add 2x2 integration test fixture
- [ ] write troubleshooting notes for stuck escrows and duplicate sends

This sequence keeps the team out of circular dependencies while delivering real
workflow value early.
