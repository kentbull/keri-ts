# IPEX runtime and nested disclosure

Six v2 routes follow frozen `acdc/ipexing.py`; the existing v1 handlers/builders
retain their pathed protocol. Offer may disclose a reachable metadata subgraph.
Grant must satisfy the negotiated single-DAG plan in breadth-first order and
supply an independent issuer proof for every child. A declared registry takes
precedence over direct issuer anchors, which take precedence over current issuer
signatures. Parent proofs never authenticate children. `NOT`/`DI2I` remain
recognized but unsatisfied, matching the reference. Deeper child-owned nests are
guarded until their processing is defined.

`ipexExnBody` synchronously accepts parsed credential bodies and explicit route
options. It reads no payload or storage and authenticates no signatures. Opening
callers supply an exchange id; replies preserve parties and the prior id.
`nestedPayload`/`framePayload` borrow parsed frames and owners through consumption.
`prepareIpexExn` is the byte convenience operation: parse once, construct the
body, collect nested wire under the existing 8 MiB ceiling, then join disposal of
all parsed owners. Parent signatures and child evidence must share the outer
attachment enclosure. Cancellation aborts reads and joins cleanup; no lazy owner
escapes this operation.

Exchanger verifies before durable acceptance, retains missing issuer/KEL/TEL
proofs in its existing escrow, retries from persisted children, and notifies only
after acceptance. Replay preserves child proof enclosures. An accepted grant
is conversation evidence; nested nodes are not independent credential or wallet
acceptances. Schema resolution uses already cached schemas, without fetching.

`RegistryEvidenceStore.importEvidence` verifies the merged observer chain before
an atomic write to frozen RegBaser-compatible `evts.`, `tels.`, and `heds.` tables.
Importing an older prefix cannot downgrade the head. Missing or invalid evidence
makes no partial write. Reads require a complete accepted chain; corrupt rows and
I/O failures propagate. AgentRuntime owns its default store and joins close;
injected stores remain caller-owned. There is no automatic `rip/bup` parser intake
or issuer registry engine. The 16,384-event ceiling bounds one read/import, not
runtime memory; native whole-row allocation and shared admission remain phases 4–5.

Presentation-registry grants remain guarded until consolidated v2 intake supplies
receiver-owned KRAM timestamps. Sender time is never a substitute. The independent
wire oracle covers JSON outer exchanges with native ACDC nodes, verifies actual
unmodified-upstream imports, and exercises real Exchanger decisions. Native-CESR
outer EXNs with empty prior do not round-trip in the frozen low-level factory
probe; they are unqualified here. Full format/production qualification remains
in the [qualification plan](../../plans/qualification/QUALIFICATION_PLAN.md),
separately from the mailbox-fork evidence.

## Dependencies

See [registry verification](../credentials/ACDC_TEL_VERIFIER.md#v2-registry-evidence),
[exchange proofs](EXCHANGE_PROOFS.md), [disclosure semantics](../credentials/GRADUATED_DISCLOSURE.md),
and the [IPEX plan](../../plans/exchange/IPEX_PLAN.md). Parent exchange acceptance
does not independently accept enclosed credentials.
