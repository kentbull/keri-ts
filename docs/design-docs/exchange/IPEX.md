# IPEX runtime and nested disclosure

Six v2 routes follow the manifest's selected Python candidate `acdc/ipexing.py`; the existing v1 handlers/builders
retain their pathed protocol. Offer may disclose a reachable metadata subgraph.
Grant must satisfy the negotiated single-DAG plan in breadth-first order and
supply an independent issuer proof for every child. A declared registry takes
precedence over direct issuer anchors, which take precedence over current issuer
signatures. Parent proofs never authenticate children. TS supports DI2I and NOT
under the profiles below. Selected-candidate operator interoperability remains
separately qualified in the later graph work. The
[operator acceptance plan](../../plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md)
keeps TS operator qualification distinct from pairwise evidence.
Deeper child-owned nests are
guarded until their processing is defined.

The selected `q.dp` is the flat list of `[schema SAID, graph prefix, relative paths]`
triples from the [pinned disclosure-path text](https://github.com/trustoverip/kswg-acdc-specification/blob/2362e48a1e8668278575b4f5b239069b2c1a82ad/spec/spec-body.md#disclosure-paths).
Apply, unsolicited Offer and bare Grant require a non-empty plan. A solicited Offer
defaults to `[]` after checking its Apply's plan; Agree must use `[]`, and a linked
Grant defaults to `[]`. Empty lists inherit only through accepted predecessors;
they never authorize a vacuous opener. A bare one-node Grant still defaults to
`[[schema, "/", []]]`, explicitly selecting that node without requesting additional
fields. No historical nested-plan translation or signed-byte rewriting is supported.

An Offer's carried nodes contain bodies without proof attachments; empty counted
feet carry no evidence. A Grant cannot use field-map metadata (explicit empty
`u` on implicit/acm/ace nodes) as a credential. Public fixed-field act/acg nodes
may retain their empty UUID slot. Before issuer authentication, the Grant must
fulfill its accepted Offer. An identical root SAID suffices; a different root
requires the offered metadata body, its own schema validation, the same issuer,
any nonempty promised registry, and matching commitments for every nonempty
promised s/a/A/e/r section. Existing Serder verification authenticates exposed
section claims, so compact and expanded representations compare without rewriting
received bytes. Missing named metadata uses existing proof escrow; a known
contradiction rejects. Offers without an origin impose no credential promise.

`ipexExnBody` synchronously accepts parsed credential bodies and explicit route
options. It reads no payload or storage and authenticates no signatures. Opening
callers supply an exchange id; replies preserve parties and the prior id.
`nestedPayload`/`framePayload` serialize ordinary hydrated child values.
`prepareIpexExn` is the byte convenience operation: decode finite input, construct
the body and collect nested wire. Serialization observes cancellation; parsed
frames need no disposal or application size policy. Parent signatures and child
evidence must share the outer attachment enclosure. No lazy owner escapes this
operation.

Exchanger verifies before durable acceptance, retains missing issuer/KEL/TEL
proofs in its existing escrow, retries from persisted children, and notifies only
after acceptance. Replay preserves child proof enclosures. An accepted grant
is conversation evidence; nested nodes are not independent credential or wallet
acceptances. Schema resolution uses already cached schemas, without fetching.
Historical grant source seals remain valid after later rotations: the referenced
accepted KEL event must commit to that exact grant SAID. Exchanger verifies these
coordinates before route selection; the IPEX handler retains those seals and
prefers them to signatures from the same AID. Supplemental transferable signatures
still require the endorser's current establishment keys. This matches main
`c7e74ad`; rotation does not erase a permanent KEL commitment.
The selected candidate validates every carried metadata-offer node without
withheld issuer proofs. Grants verify disclosure and Offer fulfillment, then
every issuer, own-node schemas, edge semantics/schema pins, and presentation
obligations in that order. Explicit/inherited edge schemas validate decoded far
credentials; equal schema IDs never waive constraints. Missing local resources
use schema EXN escrow; invalid schemas reject, infrastructure/resource failures
propagate. Operator-specific interoperability remains separately qualified; hidden aggregate
and deeper-nest guards remain. Schema fetching and full IPEX/resource qualification
are separate work. The existing wire generator now records the selected candidate
pin and its flat-plan decisions; independent historical primitive references stay frozen.
Its whole-disclosure positive uses a closed typed schema, as required by the
candidate's bounded closure check. TS still accepts some open or ambiguous whole-node
schemas without proving recursive closure. It also rejects extra labeled leaf
properties permitted by the [pinned Edge property-field rule](https://github.com/trustoverip/kswg-acdc-specification/blob/2362e48a1e8668278575b4f5b239069b2c1a82ad/spec/spec-body.md#labeled-property-fields);
that strict handling is a remaining row 14 compatibility gap, not a malformed-edge
requirement. These gaps and remaining prefix/BFS semantics belong to the later
disclosure-closure work. The selected cases do not qualify universal whole-node
interoperability.

The TypeScript DI2I contract admits identity or an approved delegation chain at any
depth. Every hop needs the delegator's accepted approval of the delegated inception;
local/witness-held `delpre` alone is no authority. Read DND from each delegator's
inception, independently of protected KEL acceptance. Later delegate rotations do
not renew the inception relationship. Missing KEL/approval evidence is a typed
proof dependency, not a permanent invalidity verdict; lookup never repairs storage.
Identity operators I2I/NI2I/DI2I conflict in wire order, with the last operative one
winning. Without one, targeted far nodes default to I2I and untargeted nodes to NI2I.
E1E remains the reference entity-comparison extension: on its own it does not
imply I2I; an explicit identity operator adds that separate requirement.
This profile follows the [operator specification](https://trustoverip.github.io/kswg-acdc-specification/#operator-o-field)
and the approval boundary clarified in [KERIpy #1559](https://github.com/WebOfTrust/keripy/issues/1559);
it is not Python IPEX DI2I parity.

NOT inverts the authenticated far node's validity, independently of the near
edge's identity and additional schema constraints. Evaluate far nodes before
parents in dependency order; keep breadth-first disclosure order unchanged,
including shared ancestors. All nodes must first authenticate and pass their own
schemas. A disproved far-node edge relationship or authenticated revoked issuance
can supply false; missing/forged evidence, malformed graphs/operators/schemas and
unknown state cannot. Valid edge schemas may disprove a payload constraint;
invalid schema resources remain refusal, distinguished by typed validation facts.
AND/OR reductions never hide malformed input or dependencies behind a sibling.

The issuance vocabulary is only `issued`/`revoked`, from the receiver's accepted
RegistryObserver evidence at each fresh validation, including escrow retries.
This is local accepted knowledge, not a global freshness guarantee. Obsolete
blinders against a newer accepted head fail authentication before negation.
The origin's own issuance status is not a wallet-acceptance gate for transporting
that disclosed message; referenced far nodes carry the validity requirement.
Later updates do not rewrite accepted conversation history. New grants and
explicit validation re-evaluate current evidence; no background invalidation,
policy scheduler or new persistence is implied. Presentation checks retain their
separate frozen KRAM receiver cutoff.

Explicit `RegistryObserver` intake delegates parsed public rip/bup events to the
normal engine with full witnessed tuple anchors and per-event atomic acceptance.
Missing evidence remains in registry escrow; accepted-prefix replay cannot lower
the head. Staged bodies never satisfy IPEX's registry dependency. IPEX borrows `RegistryStore`, not an issuer's Hab or alias
manager, and assembles its own complete accepted chain through `seqEvent` and
`headEvent`, without an application event-count quota. Ordinals must fit the
exact numeric storage representation. A missing head is a retryable dependency;
a declared accepted head with missing rows or inconsistent markers is corruption.
I/O failures propagate. AgentRuntime owns its default `acdc.rgy` manager and joins close;
injected managers remain caller-owned. IPEX borrows that manager's store. There is no automatic `rip/bup` parser intake
route; local registry services are separate.

Disclosed presentation registries require retained, trusted KRAM receiver time.
After every node's issuer verifies, each unique Issuee/registry declaration must
independently bind the exact grant SAID through node-local BLIDs. The accepted
RegistryStore chain is vetted at the inclusive microsecond cutoff; later updates
cannot replace that history. Explicit child source triples must identify an
accepted fully witnessed Issuee KEL event containing the full selected TEL seal.
Absent sources fail; unavailable attached sources/TEL are typed proof dependencies.
Verified Issuees may satisfy the negotiated grant anchor requirement. Parent
signatures, source seals and neighboring children cannot authenticate this node.
Hidden issuer/attribute/aggregate requirements and deeper unfinished graphs remain
guarded. Sender time is never a substitute. The independent
wire oracle covers JSON outer exchanges with native ACDC nodes, verifies actual
unmodified-upstream imports, and exercises real Exchanger decisions. Native-CESR
outer EXNs with empty prior do not round-trip in the frozen low-level factory
probe; they are unqualified here. Full format/production qualification remains
in the [qualification plan](../../plans/qualification/QUALIFICATION_PLAN.md),
separately from the mailbox-fork evidence.

## CLI progress and observations

Group approval and pending-proposal waits belong to CLI orchestration. Each wait
starts the ordinary host workers when progress is needed and joins them before
returning. Direct group approval, publication and stored-proposal lookup carry
no polling options.

`ipex poll --timeout <seconds>` observes new IPEX or saved-credential state under
an elapsed deadline (default 40 seconds). The command consumes the existing
continuous mailbox batch flow; the other host workers run with mailbox polling
disabled. Its batch/message counts describe fully settled batches. State can
become visible partway through a batch, so normal completion waits for delivered
batches to finish. Deadline cancellation still joins real I/O before output and
store teardown. With no new state, deadline expiry returns empty results.

`ipex join --approval-timeout <seconds>` waits for a stored pending group proposal
(default 60 seconds). Zero selects an immediate stored-state attempt. Group grant
approval retains its separate elapsed approval deadline. These commands expose
elapsed waits rather than polling-turn counts or per-turn budgets; protocol
acceptance and saved-credential state remain distinct completion facts.

## Dependencies

See [registry verification](../credentials/ACDC_TEL_VERIFIER.md#v2-registry-evidence),
[exchange proofs](EXCHANGE_PROOFS.md), [disclosure semantics](../credentials/GRADUATED_DISCLOSURE.md),
and the [IPEX plan](../../plans/exchange/IPEX_PLAN.md). Parent exchange acceptance
does not independently accept enclosed credentials.
