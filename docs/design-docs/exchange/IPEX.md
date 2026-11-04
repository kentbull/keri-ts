# IPEX runtime and nested disclosure

Six v2 routes follow the manifest's selected Python candidate `acdc/ipexing.py`; the existing v1 handlers/builders
retain their pathed protocol. Offer may disclose a reachable metadata subgraph.
Grant must satisfy the negotiated single-DAG plan in breadth-first order and
supply node-local issuer evidence, reduced with each node’s own edges under the selected IPEX profile. A declared registry takes
precedence over direct issuer anchors, which take precedence over current issuer
signatures. Parent proofs never authenticate children. The shared ACDC evaluator applies the selected upstream chaining profile
with different caller-supplied node verdicts for protocol authentication and new application use. The
[operator acceptance plan](../../plans/qualification/GRADUATED_DISCLOSURE_INTEROP.md)
keeps source characterization distinct from pairwise evidence.
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
separate generic Compactor limitation and are not qualified by these cases. Disclosure vectors separately pin `550f401489488a5fec6e1b847e74bf8312f647ca`.
Authentication differences below remain outside the matched profile;
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
delegative operator; NOT, unsupported m-ary operators and undereferenceable
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
Current-source state vectors pin Python 91769408 and assert node authentication
separately from route outcomes. A RIP alone and an unmatched future opening cannot
authenticate a node. Only actual missing accepted KEL/TEL evidence is a factor
dependency. Before final reduction, a proofless fresh RIP can authorize pending
issuer-to-issuee issuance only for the exact Grant parties; every other node must
authenticate, even on an optional edge. An eligible candidate remains pending even
when OR could otherwise succeed. Absent or ineligible RIPs are not candidates.

Ordinary shared graph reduction runs first. Only after its refusal does the route
validate every supplied opening against accepted issuer/presentation history,
exact target and historical Issuee bound. Missing current or placeholder-suffix
openings then become node-own retryable unknowns for the same evaluator. Duplicate,
unmatched, malformed or wrong-target/bound supplied openings cannot create this
pending authority. A successful ordinary OR does not need an unused child's authentication; malformed
primitive/BLID encoding is still refused before candidate classification.
No pending path invents state or publishes observations. The independent older
1f0f68a6 fixture remains historical evidence, without runtime outcome overrides.
Disclosure plans select every disclosed node in exactly the graph's BFS order.
The DAG path is `/` for the origin or a rooted literal SAD path ending in `_/`.
Maps and list indexes are traversed as carried; `_` follows that map's `n` to an
already-disclosed node. A path may traverse attributes or another SAD map, and a
hop need not restart at e. Graph reachability still comes from the strict Edge
walk, whose expanded leaves admit only reserved d/u/n/s/o/w labels. Compact Edge
strings name undereferenceable blocks, not far credentials. Section and nested
group s pins remain reserved and inherited.

Empty DAG prefixes have no positional meaning. Every node must be selected once,
including nodes reached through an optional edge; omitted, duplicated and
reordered selections refuse. A shared far node may be selected through either
literal path, once at its BFS position. This does not change `[]` presence,
`[""]` whole-node relative selection, or an empty plan's ditto/no-disclosure meaning.

`[]` permits any valid compaction level. `[""]` requires each present top-level
a/e/r section to be an expanded map and A to be an expanded list. It does not
infer additional hidden maps from a schema. Default/open schemas and whole
expanded aggregates retain ordinary schema validation. Other relative paths
resolve through Pather and must match the canonical Compactor view of each
selected section; a trailing hop cannot traverse a primitive SAID. The removed
private closed-schema proof and positional-shape policy impose no extra gate.
Own-node schema validity, exposed section commitments and independent issuer
authentication remain required. Received bytes are never rewritten or enriched.

`acdc/chaining.ts` reduces the complete graph over caller-provided node verdicts.
IPEX maps issuer authentication to those verdicts without imposing an issued-state
vocabulary. New wallet use, disclosure signing, group approval and current verifier
reporting map authenticated issued state to valid, revoked state to invalid, and
unsupported state to unknown. This applies to the origin as well as far nodes.
Unregistered nodes require issuer authentication but no registry state.

Own schemas and malformed graph shape are global obligations. Strong AND/OR may
reduce an unused false or unknown branch, while missing decisive dependencies
remain retryable. Unsupported NOT and m-ary operators remain unknown under
the selected Python profile. There is no separate private EGF interpreter.
Applications require a valid root before signatures or new consent records;
historical inventory and exact retained disclosure remain unchanged.

DI2I follows merged KERIpy `84301a9ff4bbb644ce134f9649ad56b49aa130f2`
(`acdc.relating` and `IpexHandler`): the near issuer may equal the far issuee or
reach it through approved delegated inceptions at any depth. Each hop checks the
delegator's accepted inception DND and the exact dip approval, independent of later
delegate rotations. Missing KEL/anchor evidence is retryable; a wrong ancestry,
untargeted far node or DND is false. Pending delegation is conjoined with pins and
far-node truth, so it cannot conceal a decided failure.

`acdc/relating.ts` reads accepted storage without repairing aess. Cached first-seen
approvals remain usable after superseding; without a cached approval the search
uses the last accepted KEL events. KEL intake owns cache repair. This retains
upstream's history-dependent lookup distinction, not a superseding convergence
guarantee. Unlike Python's verified-only cache assumption, TypeScript protected
intake may retain an unverified attached source hint; its named event must contain
the exact dip seal. An unrelated hint falls back to the last-accepted KEL search,
so it cannot veto a later genuine approval. Missing first-seen event bodies
remain storage failures. The companion specification PR
[ToIP #213](https://github.com/trustoverip/kswg-acdc-specification/pull/213) is still
open at this source review; implementation parity is not a claim of ratified text.
The legacy TEL verifier is outside this v2 scope.

Wallet disclosure support includes deduplicated delegation ancestry root-first for
selected issuers, issuees, senders and source sealers. It replays their accepted
first-seen histories through Baser, retaining exact stored signatures, receipts
and source seals; incomplete accepted replay fails preparation. An ancestry claim
only selects support: ordinary receiver KEL intake and the graph evaluator still
authenticate each approval. A two-hop unregistered DI2I Grant is qualified through
independent receiver intake and store reopen. Exporting retained superseded
authorizers does not make a fresh receiver accept a delegation its current KEL
policy refuses; superseding convergence remains outside this evidence assembly.

The maintained HTTP disclosure fixture also covers reciprocal two-hop DI2I against
candidate KERIpy `5fdef8d94a917802dfd23c03023f1ae9451420e2`: a signed graph naming
a far issuee outside the approved ancestry is refused without escrow before the
valid status-only graph completes apply/offer/agree/grant/admit. Introductions
replay real root-first approval KELs, and the TypeScript peer advances the existing
finite KEL/reply escrow owner after intake. No approval records are manufactured.
These cases use v2 ACDC, IPEX and attachment genus; Python authors v2 KELs, while
the TypeScript individual Hab API still authors its existing v1 KEL bodies.
This is reciprocal credential qualification, not a new legacy-peer lane or proof
of a v2 individual-inception authoring API. Full v2 individual KEL authoring remains
required R13 follow-up work, including version propagation through rotation and reopen.

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
