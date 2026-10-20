# KERIpy 1.x and 2.x compatibility porting backlog

Status: **proposed work, not implemented or authorized for upstream publication**.
Initial inventory reviewed 2026-10-19 against keri-ts `eb1a430e`. The
[compatibility inventory](../../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
owns feature IDs, exact donor source/tests, supported directions and explicit
limits. This file owns target-branch assessment, port tasks and acceptance gates.
It is a worklist for future backward and forward ports, not a second behavior
specification or an assumption that TypeScript is canonical.

No current WebOfTrust 1.x/2.x target-head gap audit has been performed for this
document. W1, G1 and W2 below mean the pinned references in the inventory. An
unchecked task means **assess and implement only if missing**, not "known absent
from every upstream release." Some behavior already exists in one or both lanes.

## Target assessment record

Before beginning a port, record the exact target branch/commit below and replace
"unassessed" for its work-package cell with one disposition: **already present**, **needs port**, **needs
design decision**, **out of scope**, or **landed and qualified**. Record the
reason, PR/commit and executed evidence. A renamed Python helper is not proof
that its behavior differs. Recheck both branches after a forward/backport lands.

| Target                                            | Initial disposition                                                  | Evidence required                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| WebOfTrust/keripy selected 1.x maintenance branch | Unassessed at current head; W1 is historical, G1 is a distinct fork. | Exact branch/commit, loaded Python/HIO/Falcon paths, supported peer/deployment profile.           |
| WebOfTrust/keripy selected 2.x branch             | Unassessed at current head; W2 is a frozen development reference.    | Same provenance; distinguish old-message readers from new-message producers and feature adoption. |
| GLEIF-IT donor                                    | G1 reviewed for HTTP and outgoing lifecycle behavior.                | Compare relevant fixes with each WebOfTrust target; do not port unrelated fork policy wholesale.  |

Track the two target dispositions independently. Split a package row by feature
ID when its features have different outcomes. Evidence includes the assessed
commit even when no patch is needed; landed work also records PR and merge commit.

| Package / feature IDs              | 1.x disposition | 2.x disposition | Target commits, decisions and evidence |
| ---------------------------------- | --------------- | --------------- | -------------------------------------- |
| A: COMP-01, COMP-02                | Unassessed      | Unassessed      | Pending target selection.              |
| B: COMP-03 through COMP-06, GAP-04 | Unassessed      | Unassessed      | Pending target selection.              |
| C: COMP-07, COMP-08, GAP-02        | Unassessed      | Unassessed      | Pending target selection.              |
| D: COMP-09 through COMP-11, GAP-05 | Unassessed      | Unassessed      | Pending target selection.              |
| E: COMP-12, GAP-03, GAP-06         | Unassessed      | Unassessed      | Pending target selection.              |

GAP-01 (general capability negotiation/downgrade) remains a design boundary;
none of these packages authorizes an automatic conversion system.

## Ordered work packages

### Port A — Dual HTTP conventions (COMP-01, COMP-02)

This is the first concrete interoperability package. G1 and W2 use different
single accepted media types. It can be addressed without enabling protocol-v2
messages on a 1.x branch.

- [ ] **Both branches: receiver acceptance.** Inspect `app/httping.py`
      `parseCesrHttpRequest` and actual indirect/witness/mailbox/receipt endpoints.
      Accept the two intended CESR media types under an explicit normalization rule;
      retain detached attachment/body validation and reject unrelated media types.
- [ ] **1.x sender to newer peer, 2.x sender to older peer.** Locate actual
      `createCESRRequest`, HTTPMessenger and HTTPStreamMessenger owners. Preserve the
      branch's chosen default; add the alternate type only where the peer rejects
      the attempted type before processing. keri-ts is a donor for modern-first
      fallback; reverse ordering is a separate port decision, not shipped TS behavior.
- [ ] Keep the prepared signed body/attachments, destination and authorization
      identical across attempts. Join the refused response/request before opening
      the alternative. No network-error, authentication-refusal or application-error
      retry; do not add generic retry machinery.
- [ ] Decide whether to preserve the narrow 406/body-text predicate or introduce
      a documented peer error contract. Do not silently broaden to all 406/415 errors
      or use diagnostic logging to drive protocol behavior.
- [ ] Inventory query/mailbox polling and witness receipt paths separately.
      Preserve receipt `202` semantics, actual SSE lifetimes and finite completion.
      Full-body framing support needs its own endpoint decision; changing Content-Type
      does not teach a detached-only parser to accept full CESR wire.

Acceptance: old-type-only and new-type-only native HTTP peers, dual-accepting
receiver, unrelated type rejection, no second attempt after non-media refusal or
transport failure, body-mode refusal, identical signed bytes and Authorization,
one-message request boundaries, query/SSE and receipt regressions. Existing TS
tests are linked at COMP-01/02; retain equivalent Python owner tests and actual
opposite-branch HTTP peers. No current fresh G1 live run is claimed by this file.

### Port B — Historical readers and version contexts (COMP-03 through COMP-06)

- [ ] **2.x backward readers:** compare `core/counting.py`, `parsing.py` and
      serialization helpers with actual archived v1 receipt/path-signature wire.
      Preserve or add the explicitly agreed v1 extensions outside canonical current
      codices. Do not restore obsolete v2 receipts into nonce-code slots.
- [ ] **1.x preservation:** establish what the selected branch already reads and
      writes before backporting newer table/parser changes. Preserve that behavior;
      adding all of the v2 decoder is not implied by accepting both HTTP media types.
- [ ] **Both branches:** keep explicit genus/enclosure scope distinct from body
      protocol metadata. Preserve signature material and original signed bodies;
      convert only semantically understood attachment groups whose target encoding
      exists. Reject opaque or ambiguous conversions and unsupported widths.
- [ ] Inventory real archive large counters, implicit-v1 streams and removed
      codes (GAP-04). Decide whether to support an explicit historical profile or
      report an unsupported archive form; never use parse failure to choose a genus.

Acceptance: independently generated v1/v2 qb64/qb2 vectors, historical `-D/-J/-K`,
item versus payload-unit counts, nested selector scope and following siblings,
truncated/malformed input, unchanged signed bodies/SAIDs/signatures, exact consumed
extent, opaque-conversion rejection and receipt-to-nonce collision rejection.
Test readers and application acceptance independently. Existing table definitions
alone do not prove archived evidence can be consumed.

### Port C — Forwarding and multisig carried evidence (COMP-07, COMP-08, GAP-02)

- [ ] Compare both target Poster/StreamPoster and ForwardHandler/Multiplexor paths
      with donor construction, receipt, approval, storage/reopen and replay behavior.
      W2 already has separate legacy/nested forwarding paths; establish missing
      cases rather than replacing them with a TypeScript-shaped transport framework.
- [ ] Preserve explicit child genus through legacy embeds and signed `a.cgvrsn`
      when needed, or document an interoperable alternative before changing the
      wire. Establish whether each target already emits/reads that field. A child's
      own declaration wins; invalid hints reject; hints never authenticate children.
- [ ] **1.x:** retain legacy forwarding/multisig behavior without silently
      emitting v2 envelopes to old mailboxes. **2.x:** retain legacy approvals while
      verifying signed nested-child commitments and independent child proofs.
- [ ] Audit legacy `tels` replay and mailbox/query paths against the recipient's
      supported genera. keri-ts currently emits v2 TEL proof counters with a selector;
      this is evidence of a compatibility limit, not an automatic 1.x backport.

Acceptance: both arrival orders for local approval/remote proofs, reopen/retry,
legacy and v2 `/fwd`, mismatched body/attachment genus, KEL/reply/TEL/credential
children, tampered hints/commitments, missing child signatures and unsupported
peer failure. Preserve participant topology and independently accepted state.

### Port D — Credential and application adoption (COMP-09 through COMP-11)

- [ ] **2.x:** prove legacy VDR credential issuance, verification, replay and IPEX
      continue through their own owners. Keep v2 registries/disclosures and their
      IPEX predecessor/proof rules separate. Inspect what already exists upstream.
- [ ] **1.x:** preserve the supported v1 lane. Any new-registry, native-body or
      graduated-disclosure backport requires a separate scope/schema/handler decision;
      no field-renaming adapter or mutation of signed credentials is implied.
- [ ] Define KRAM adoption, exemptions and receiver-observed replay/time behavior
      for the chosen deployment. A failed authentication must not retry via a less
      protected legacy path. Retain sender policy and downstream proof verification.
- [ ] Track TS-specific RegistryObserver, DI2I and NOT integration gaps against
      their existing [registry](../credentials/REGISTRY_PLAN.md) and
      [disclosure](../qualification/GRADUATED_DISCLOSURE_INTEROP.md) owners. They are
      separate forward-port candidates, not evidence of present Python support.

Acceptance: legacy credential verification/revocation/replay, version-specific
IPEX conversations and refusal graphs, missing issuer/registry/schema evidence,
independent child proofs, restart, optional KRAM behavior and replay/timing
refusals. Define whether a case is Python-to-TS, TS-to-Python or TS-only; a Python
witness participating in a TS-to-TS presentation is not Python presentation parity.

### Port E — Storage and deployment transition (COMP-12, GAP-03, GAP-06)

- [ ] Verify Broker TSN proof identity on each selected target. Both G1 and W2
      already use the same zero-padded numeric ordinal key (COMP-12); do not invent
      a version-specific key migration. Preserve aggregation of partial signatures
      for the same signer/establishment tuple across equivalent ordinal encodings.
      Verify retry idempotence and acceptance independently of body/attachment
      version selection. Different wrapper projections are not different protocol
      versions, and a database index need not preserve original attachment bytes.
- [ ] Inventory actual populated Baser/Reger/new-registry/keystore stores and
      pending escrows. Classify each as copy, rewrite, rebuild, newly empty or retired.
      The existing [DB plan](../db/DB_PARITY_PLAN.md) and
      [storage/recovery plan](../db/STORAGE_RECOVERY_PLAN.md) remain the owners.
- [ ] Test real migration copies and rollback after new writes. Do not infer
      compatibility from a successful DB open or an advanced version marker.
      Preserve signed artifacts, key custody, current endpoint authorization and
      pending work. Old keri-ts pre-1.0 API/storage compatibility remains excluded.
- [ ] Audit 1.x-only GLEIF/HIO completion, connection and failure-retention fixes
      before claiming 2.x operational parity. Adapt actual Python/HIO owners; do not
      port TypeScript's Effection classes literally. Wire compatibility and local
      transmission completion remain different claims.
- [ ] Qualify dependent KERIA, Signify, witnesses, mailboxes, DID resolver and
      Sally profiles at their selected versions, including changed HTTP/CLI/API
      contracts. Choose upgrade cohorts and document what new v2 activity makes
      rollback asymmetric.

Acceptance: production-shaped state copies, stable AIDs and signatures, required
credential/history validation, resumed pending workflows, current routing proofs,
no silent row loss, native transport failures/cancellation and documented rollback
limits. This package is not already solved by the wire bridges above.

## Port completion and ongoing maintenance

Finish one cohesive port before starting its successor. Each target patch records:
feature/gap IDs, exact donor and target commits, existing behavior versus actual
delta, negative boundaries, counterpart branch disposition, executed regression
and cross-peer evidence, and merge/PR identity. If the behavior is already present,
record that proof instead of creating an empty port. Reuse existing Python and TS
test owners; do not add a generic compatibility registry or runtime fallback stack.

Reassess this backlog after either branch changes. Remove a task only after its
target disposition is recorded, or after an explicit supported-peer decision
retires it. Future forward-compatibility proposals receive their own concrete
capability and acceptance boundary before being added to the implemented inventory.
