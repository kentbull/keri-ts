# V1/V2 registry foundation plan

Owner: roadmap **3e registry**, before dependent IPEX presentations. This expands
the existing credential work; it does not restart the delivered v1 VDR stack or
v2 observer verifier (#168). See the [current contract][contract] and
[IPEX plan][ipex]. The [KRAM replacement sequence][kram] supersedes the requirement
to wait for the original large #172 to merge.

Frozen upstream: `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
Reference owners: `acdc/regbasing.py`, `registering.py`, `regeventing.py`,
`registraring.py`, `ipexing.py`, and corresponding legacy VDR modules/callers.
Source inspection shows the local `_RegEventer` requires a controlling Hab;
public observer verification must remain independent of issuer private state.

## Current boundary and target ownership

`RegBaser` owns public registry layout and joined LMDB lifecycle. `RegistryStore`
provides storage access, local aliases, earliest-anchor retention and ordered
escrows without authenticating evidence. `RegistryEvidenceStore` extends the
same owner for complete-chain observer reads and atomic verified import.
These are storage facilities, not a full v2 Regery. Pure `regcept`/`blindate`
construction and JSON/native vectors already exist in `acdc/messaging.ts`; reuse
them. Runtime acquisition retains explicit scopes and joined failure cleanup.

| Responsibility               | Owner or planned boundary                          |
| ---------------------------- | -------------------------------------------------- |
| Layout/lifecycle             | RegBaser (`acdc/regbasing.ts`)                     |
| Storage/local aliases        | RegistryStore/openRegistry (`acdc/registering.ts`) |
| Pure vetting/event decisions | vet/vetBinds/engine (`acdc/regeventing.ts`)        |
| Instances/orchestration      | Regery/Registry/Registrar (`acdc/registraring.ts`) |
| Complete-chain assembly      | IPEX through RegistryStore                         |
| Runtime acquisition          | Explicit `acdc.rgy` ownership                      |

Pure verifier names match `vet`/`vetBinds`; the local engine accepts anchored
inceptions/updates with protected slots and heads, deterministic sibling retry,
queued progression and earliest-anchor resealing. Named v2 Regery/Registry services
support creation and reopen; a borrowed Registrar stages credential, presentation
and vacuous updates from one unambiguous staged frontier. Presentation validates
target digest syntax only; IPEX still owns grant authentication. Trailing vacuous
updates require their disclosures when resolving the effective binding.
Runtime integration remains unfinished. Ordinals above the safe-integer storage
range are explicitly unsupported pending the storage phase.
The [import preservation record][import-record] retains the exact original code.

Use `evts/ancs/tels/heads/maes/ooes`; accepted heads use physical `heds.` and
local aliases `regs.`. Event-body presence is not acceptance: escrowed bodies
also live in `evts.`. Accepted sequence, rebuildable head, anchors and escrows
retain distinct roles. Storage operations `event/head/headEvent/seqSaider/seqEvent`
do not authenticate protocol evidence.

## Small publication units

Use the roadmap's 300–500-line target, counting verification artifacts. Split a
unit further if necessary; never publish a broken intermediate or nominal Regery
that implies unfinished capabilities work. Each unit includes its smallest
meaningful verification and relevant contract update.

| Unit | Responsibility                                                     |
| ---- | ------------------------------------------------------------------ |
| R1   | Preserve reconstructable import design; align pure verifier names  |
| R2   | Extract RegBaser layout/lifecycle; read existing #168 stores       |
| R3   | RegistryStore access, aliases and earliest verified anchor storage |
| R4   | Reuse rip/bup constructors; shared typed validation/anchor policy  |
| R5   | Safe inception acceptance, duplicate protection, anchor escrow     |
| R6   | Safe update ordering, accepted-slot/head protection, order escrow  |
| R7a  | Missing-anchor retry and deterministic sibling arbitration         |
| R7b  | Queued-chain progression, stale cleanup and re-anchoring           |
| R8   | Named Regery/Registry creation, lookup and reopen                  |
| R9a  | Staged frontier, blind updates and pipelined commitments           |
| R9b  | Registrar present/vacate operations and facade                     |
| R10  | Actual public evidence intake and custom import disposition        |
| R11a | IPEX-owned bounded accepted-chain assembly through RegistryStore   |
| R11b | Receiver cutoff and presentation dependency retry/replay           |
| R12  | Runtime acdc/vdr grouping and scoped service ownership             |

Stack dependency-coupled units on their predecessors; merge in dependency order.
Independent reference/compatibility analysis can proceed in parallel. Keep existing
consumers operational until their replacements work; obsolete TypeScript-only
APIs may then be removed. If storage extraction requires coordinated caller
changes, include those changes in that cohesive unit and split unrelated work.

R5/R6 must protect duplicates, accepted slots and heads in their first acceptance
paths; R7a/R7b add candidate arbitration/retry, not delayed safety fixes. Local engine
anchors require the reference's full seal tuple and witnessed KEL policy, distinct
from observer digest-only vetting. Preserve earliest verified anchors, sibling
winner ordering and the effective staged frontier used to construct updates.

Resolve R10 correspondence early, in parallel with R1/R2, before any removal.
R7a/R7b each budget roughly 250–400 changed lines including evidence; measure
rather than assume. R9a must retain pipelining of an unambiguous staged frontier
and refusal of competing successors. Count extraction moves as both additions
and removals when assessing review burden. Registry analysis/storage can proceed
alongside KRAM; prioritizing the full registry rollout afterward is scheduling,
not a technical dependency. Presentations require both completed foundations.

## Custom import disposition

Before deletion, preserve exact revision/path, implementation, API, tested
assertions, finite limits, ownership and transaction boundary in a linked
reference/design note. Retain the algorithm: read accepted chain, merge updates
by SAID, enforce the event limit, vet the whole chain, then atomically publish
bodies/accepted sequence/head. Explain no partial publication or head downgrade.

Trace whether upstream has **and uses** equivalent bulk observer import; storage
`accept`, `vet` or ordinary processing alone is insufficient correspondence.
If used, port the real feature under its proper owner/name. Otherwise replace
production/test use with actual reference-aligned intake before removing it;
retain the design as a deferred TypeScript-specific proposal without an active
implementation or parity claim. Do not substitute direct accepted-row writes
for the workflow's validation assertions. Current main also lacks that receiving
path. The approved R10 implementation is public observer intake through the
ported engine, explicitly a TypeScript integration; see the [upstream gap review][gaps].

## Compatibility and completion gates

Every unit preserves legacy Reger/Regery/Registry/Registrar/Credentialer and
Tever/Tevery workflows alongside separate v2 components. Alias shared names when
both are in scope. Keep `runtime.acdc.rgy` distinct from `runtime.vdr.rgy` without
duplicate environment handles or competing owners. Injected services remain
borrowed; readonly Habery creates no implicit writable service. Default services
retain scoped acquisition, construction/cancellation cleanup, joined close,
temporary removal and harmless scope exit after explicit shutdown.

Prove #168 readback and corresponding v1/v2 paths, table encodings, ordinal
widths, duplicate/insertion ordering, markers, aliases, anchors and escrows.
Opening/reading must not rewrite, migrate or discard existing records. Any
needed migration requires separate design/review. Preserve `LMDB_DATA_V1=true`;
LMDB format and ACDC protocol version are independent. Likewise body protocol
and attachment genus are independent, including v1 bodies with v2 framing.

Use existing scenarios plus narrow regressions for valid/missing/out-of-order,
duplicate/competing/re-anchored events, earliest verified anchors, escrow removal,
head advancement/protection, named reopen, blind/present/vacate, and independent
IPEX bindings. Apply finite chain credit before collecting accepted ordinals
through the head; distinguish missing dependencies from corrupt durable rows.
Parent EXN, child issuer and registry-binding proofs remain separate.

Qualify supported stores and wire in both Python→TS and TS→Python directions,
existing TS stores, and coexistence without path/table/lifecycle collision.
Use disposable copies; no two live LMDB V1 handles per path/process. Identify
historical v1, unmodified frozen upstream and mailbox-fork evidence separately,
including actual imported modules. Reuse maintained happy paths; exploratory
integration probes need not become permanent suites. Unsupported combinations
remain explicit. Readability alone is not processing or wire compatibility.

This foundation does not close TEL queries, IPEX presentation cutoffs, shared
runtime admission, native row allocation, transport or final qualification.
Long hosted qualification remains maintainer-only with the 15-minute cap.

[contract]: ../../design-docs/credentials/ACDC_TEL_VERIFIER.md
[ipex]: ../exchange/IPEX_PLAN.md
[kram]: ../exchange/KRAM_PLAN.md
[import-record]: ../../reference/credentials/VERIFIED_IMPORT_SNAPSHOT.md
[gaps]: ../../reference/credentials/UPSTREAM_REGISTRY_GAPS.md
