# IPEX runtime and nested disclosure

Six v2 routes follow the manifest's selected Python candidate `acdc/ipexing.py`; the existing v1 handlers/builders
retain their pathed protocol. Offer may disclose a reachable metadata subgraph.
Grant must satisfy the negotiated single-DAG plan in breadth-first order and
supply node-local issuer evidence, reduced with each node’s own edges under the selected IPEX profile. A declared registry takes
precedence over direct issuer anchors, which take precedence over current issuer
signatures. Parent proofs never authenticate children. The separate ACDC evaluator supports I2I/NI2I/DI2I, E1E and NOT
under the profiles below. IPEX admission separately implements the selected reference’s AND/OR profile; application operators never silently extend that admission profile. The
[operator acceptance plan](../../plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md)
keeps TS operator qualification distinct from pairwise evidence.
Deeper child-owned nests are
guarded until their processing is defined.

The selected Python `v2-spec` wire at `ae8284995486855809e7f4988fa1579b63e1ff91`
uses exactly one outer DAG entry: `q.dp = [plan]`, where `plan` is the flat list of
`[schema query, graph prefix, relative paths]` triples. The internal graph owner
continues to use that one flat plan; wire construction wraps it once and intake
validates and unwraps it once. Empty/multiple outer DAG lists refuse.
Schema query slots accept strings, including empty or opaque criteria, matching
Python's query-shape contract. A query string does not establish a schema claim:
Grant disclosure matching and actual Schemer validation remain required.
An empty inner plan (`[[]]` on the wire) inherits through an accepted predecessor,
or requests no disclosure at an opener. Agree uses that empty ditto. A vacuous
Grant carries `a.o = []` and no nodes. A bare one-node Grant defaults to
`[[[schema, "/", []]]]`, explicitly selecting the root. Signed bodies and child
proof bytes remain unchanged during intake and replay.

Apply, unsolicited Offer and unsolicited Grant open with `t = xip`; their own
SAID identifies the transaction. Continuations use `t = exn`, `p` identifies the
accepted predecessor, and `x` is the prior XIP's SAID or the prior EXN's `x`.
Builders derive that identity and reciprocal parties from the prior. Callers do
not supply a transaction ID; Tufa's v2 IPEX commands no longer expose `--xid`.
Only existing Offer/Grant handlers own nested XIP credential trees. Other XIP
routes remain subject to the flat-frame boundary.

Historical wire vectors remain pinned to `ae8284995486855809e7f4988fa1579b63e1ff91`.
Their E1E and AND intake refusals now agree with TypeScript. Their original blank
and stale section-claim bytes remain unchanged as historical non-parity evidence:
that Python Serder accepted both while TS refused them, and only Python IPEX
accepted the blank claim. Fresh graph vectors pin `1f0f68a6ad44a8d159cbbb2bab7bb243bc7a0337` and use ordinary current-Python
`acdcmap(attribute={d: "", ...})` construction after its section repair, with no
Compactor preparation or receiver rewriting. Each generator records its exact
source pin and all imported module hashes. Relative to the historical fixture, the
current owner validates every own schema and presentation/ax before reduction,
repairs constructor section claims and imports its inline-pin Schemer. Minimal
inline pins are covered; schemas whose properties include d retain the reference’s
separate generic Compactor limitation and are not qualified by these cases. The separate empty graph-prefix
extension and authentication differences below remain outside the matched profile;
these checks do not establish full IPEX or application-use interoperability.

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
calls generate an XIP nonce and derive the transaction identity from its SAID;
replies preserve parties and the derived prior identity.
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
`Exchanger.verifyAccepted(said, route)` reauthenticates the exact retained body,
outer factors and child view through its registered route. It preserves receiver
time and produces no queries, writes, notices or escrows. Identical recorded replies
remain eligible; other accepted replies refuse. Accepted duplicates cannot replace
the first retained children. Missing or invalid authentication returns false;
storage failures propagate. This is authentication/protocol inspection, not a
relation, current-use or consent verdict.
Consumers read the accepted body from Baser and hydrate its original children
with `loadNests` from `keri-ts/db`; inspection never merges a fuller credential cache.
Historical grant source seals remain valid after later rotations: the referenced
accepted KEL event must commit to that exact grant SAID. Exchanger verifies these
coordinates before route selection; the IPEX handler retains those seals and
prefers them to signatures from the same AID. Supplemental transferable signatures
still require the endorser's current establishment keys. This matches main
`c7e74ad`; rotation does not erase a permanent KEL commitment.
The selected current Python contract validates every carried metadata-offer node
without withheld issuer proofs. Grants check disclosure and Offer fulfillment,
then every own schema, every presentation obligation and ax, then graph admission.
Own/disclosure schema resources use schema EXN escrow; invalid own schemas reject
and infrastructure failures propagate. Graph admission conjoins each node’s own
authentication with its edges, and each leaf’s relation/pins with its far node.
Strong AND and OR absorb outcome-irrelevant invalid or unknown branches, while
all branches are still inspected for malformed structure. Only a valid root is
accepted; a dependent retryable unknown uses existing proof/schema escrow, and
invalid or permanent-unknown roots refuse. I2I/NI2I and E1E compose using the last
delegative operator; DI2I, NOT, unsupported m-ary operators and undereferenceable
compact Edge blocks are permanent unknowns. Every ancestor and leaf pin applies
conjunctively. A satisfied OR can absorb unsupported semantics, never malformed
input. Authenticated issued/revoked/custom registry states are not application-use
verdicts. The handler returns successful registry observations as typed data; Exchanger pins
them atomically with accepted evidence in Baser.exrs, keyed by (Grant SAID, node
SAID). Each five-field record contains regid, head said, numeric sn, state and
stamp. State vocabulary and empty strings are preserved verbatim; nullable fields
remain nullable. Unregistered nodes and optional unauthenticated branches produce
no new observation. Missing optional records are never fabricated or used to erase
a previous authenticated observation. Refusal or escrow does not publish records.

Successful later delivery of the same Grant may refresh these observations while
its first accepted enst and epath remain immutable. A different Grant owns separate
rows. Current/historical verifyAccepted and historical inspection remain read-only;
inspection reports labeled recordedRegistryStates as the last recorded per-node
facts from successful accepted verifications, not first-acceptance facts or current standing. Wallet and
current verifier authority still require fresh proof and application-policy checks.
The source state vectors explicitly retain two authentication differences: Python
1f0f68a6 refuses a future proof at a RIP-only or older BUP head while TS escrows.
Both preserve prior observations. Reconciliation with subsequent Python issuer-opening
and bound-Issuee repairs remains separate; this is not full authentication parity.
Whole-node `[""]` and relative `d/`, and trailing-separator subtree paths, require
schema-proven closure under the selected explicit-acm profile. Static resources
are authenticated by the same private owner as ordinary node validation; no
received value is resolved or expanded. A string-only schema position remains
ordinary scalar data even for SAID-shaped values, while a compact-or-object
position must expose the map. Only closed typed objects or schema-valued additional
properties, unambiguous typed oneOf and static refs without constraint siblings
are supported; open/ambiguous schema forms and whole aggregates refuse. Missing
schema resources use the existing retry path. Node presence `[]` and explicit
leaf requests retain their independent meanings.

IPEX traversal and virtual `_` hops accept expanded leaves with exactly the
reserved d/u/n/s/o/w labels; compact member strings name Edge blocks, not far
credentials. Section and nested group s pins are both reserved and inherited.
The application evaluator’s schema-proven simple-edge classifier and application
leaf properties remain separate and unchanged.

An empty graph prefix uses its tuple's BFS position. A nonorigin positional tuple
requires the full gapless BFS plan and a schema-proven closed, required edge hierarchy
for every disclosed node. Present optional members, ancestor unions and expanded
arrays cannot prove that fixed shape and require explicit prefixes. Explicit
/e/.../_/ selectors may omit unrequested plan entries, but selections remain unique,
origin-first and strictly BFS ordered; intermediate `_` hops restart at e. Relative
empty fields under an empty prefix request nothing; d/ still requests whole closure.
These bounded rules do not claim universal shorthand or whole-node interoperability.

The separate application TypeScript DI2I contract admits identity or an approved delegation chain at any
depth. Every hop needs the delegator's accepted approval of the delegated inception;
local/witness-held `delpre` alone is no authority. Read DND from each delegator's
inception, independently of protected KEL acceptance. Later delegate rotations do
not renew the inception relationship. Missing KEL/approval evidence is a typed
evaluator dependency, not an EXN escrow or permanent invalidity verdict; lookup never repairs storage.
Identity operators I2I/NI2I/DI2I conflict in wire order, with the last operative one
winning. Without one, visible targeted far nodes default to I2I and visible
untargeted nodes to NI2I. A hidden attribute/first-aggregate-member Issuee cannot
prove that default or E1E equality and stays unresolved.
E1E remains the reference entity-comparison extension: on its own it does not
imply I2I; an explicit identity operator adds that separate requirement.
This profile follows the [operator specification](https://trustoverip.github.io/kswg-acdc-specification/#operator-o-field)
and the approval boundary clarified in [KERIpy #1559](https://github.com/WebOfTrust/keripy/issues/1559);
it is not Python IPEX DI2I parity.

The separate application NOT evaluator inverts the authenticated far node's validity, independently of the near
edge's identity and additional schema constraints. Evaluate far nodes before
parents in dependency order; keep breadth-first disclosure order unchanged,
including shared ancestors. All nodes must first authenticate and pass their own
schemas. A disproved far-node edge relationship or authenticated revoked issuance
can supply false; missing/forged evidence, malformed graphs/operators/schemas and
unknown state cannot. Valid edge schemas may disprove a payload constraint;
malformed semantic schema resources remain unresolved, distinct from false.
Every ancestor and local pin is an additional constraint; inline own-schema IDs
still validate the far payload. AND/OR/NAND/NOR never hide an unresolved member
behind a decisive sibling. `evaluateAcdcRelations` returns Boolean, null or an
existing typed issue; applications must require an explicit true result.

The issuance vocabulary is only `issued`/`revoked`, from the receiver's accepted
RegistryObserver evidence at each explicit policy evaluation.
This is local accepted knowledge, not a global freshness guarantee. Obsolete
blinders against a newer accepted head fail authentication before negation.
The origin's own issuance status is not a wallet-acceptance gate for transporting
that disclosed message; referenced far nodes carry the validity requirement.
Current consuming TS CLI/group/credentialing and Tufa verifier flows use legacy
e.acdc/iss/anc artifacts; native nested Grants are refused or skipped there. There
is no native action workflow to retrofit in this cut. Runtime composition, EXN
completion and retained presentation evidence do not substitute for explicit
semantic approval; later native wallet/verifier actions must call the evaluator.

Later updates do not rewrite accepted conversation history. New grants and default
inspection re-evaluate current issuer history. Explicit `{ historical: true }`
inspection selects the highest unique accepted BUP named by retained target BLIDs;
vacuous openings and generic source locators cannot advance that prefix. Invalid
or duplicate openings and bound contradictions refuse before missing evidence.
Historical inspection neither proves current standing nor records a past policy
decision. Presentation keeps its independent completed KRAM receiver-time gate.

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
RegistryStore chain is vetted at the highest accepted BUP sealed by the verified
Issuee source; receiver time does not select history. Explicit child source triples must identify an
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
