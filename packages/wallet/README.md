# ACDC wallet inventory

This application package retains issued credential bytes and explicit consent to
one accepted Grant/Admit pair. Supply the actual Habery, ACDC v2 RegistryStore,
Exchanger and an opened WalletBaser. Callers own and close those stores.

`recordIssued` verifies accepted local issuance and accepts an explicit blinded
opening. `recordAdmission(..., {consent: true})` requires current authenticated
root truth, the intended local holder and the actual accepted response.
Neither protocol intake nor reading a Grant creates consent automatically.

`prepareAdmit(grant, holder, {consent: true})` checks the exact accepted Grant,
intended local holder and current authenticated root `true` before signing a
ACDC v2 response. This Effection operation returns `{admit, wire, support}` without
recording inventory. For a negotiated anchored response, supply the actual
`receiptor`; it gathers the exact source anchor's witness receipts before returning.
The caller admits that wire through ordinary ingress, then calls `recordAdmission`
with the actual accepted pair. False/unknown graphs and missing consent never
produce a signature. This operation supports individual holders; group admission requires its separate
member-approval workflow. ACDC v2 attachment genus defaults to 2.0.

`inventory`, `admissions`, `issuedCredential` and asynchronous `heldCredential`
read retained history. Held proofs come from that Grant's original nested rows;
a later fuller disclosure, registry update or policy decision does not replace
those bytes. History retrieval authenticates the retained outer exchanges through
Exchanger replay without asserting current issuer standing or graph validity.

## ACDC v2 disclosure

`WalletDiscloser(wallet, receiptor, custody?)` borrows those actual owners. Its
Effection operations `prepareApply`, `prepareOffer`, `prepareReply` and
`prepareGrant` return `{exn, wire, support}`; callers own ordinary ingress and
delivery. Negotiated source anchoring freezes the exchange body before gathering
witness receipts. Grant creation requires current authenticated complete-root
truth before signing and again after receipt collection.

Select `{said}` from issued inventory or `{fromGrant}` from an exact admitted
Grant. `disclose` can reduce that view; `refresh` can replace proof evidence
without expanding credential material. Event-specific `openings` are explicit;
`derive: true` additionally requires provisioned custody. `registryProof` returns
verified accepted event evidence. `unblind` recovers a candidate from an explicitly
possessed UUID and candidate states; it grants neither standing nor consent.

For a separately authorized presenter, select `{transferred: exactWire, presenterAuthorized: true}`, or authorize an already accepted transferred
`fromGrant` explicitly. These paths preserve transferred credential/proof bytes
and create no issued/admitted inventory row. Presenter authorization remains
separate from holder admission consent and possession of a derivation salt.
A local `presentation` registry must match the selected Issuee declaration; its
accepted BUP commits the frozen Grant body.

Configure `Receiptor(hby, protocol, http, clock, {gvrsn})` for the actual witness attachment genus,
independently of ACDC v2 IPEX genus. Its default remains 1.0; the known v2
witness profile explicitly selects 2.0. Group disclosure uses its separate
member-approval workflow.

## ACDC v2 authoring

`WalletAuthor(wallet, acdcV2Regery, receiptor, custody?)` borrows the same public
registry environment and actual receipt collector. `incept` returns an exact
accepted RIP; `create` uses the existing ACDC builder; `issue`, `update` and
`revoke` stage BUPs and return only after the exact KEL seal has authenticated
historical witness quorum. `update` is a state advance, never historical `upd`.
Groups require their separate member-approval workflow.

Public authoring explicitly retains and publishes its event opening. Derived
authoring requires provisioned custody and retains exact nonsecret coordinates
before processing, including a matching pending retry. A supplied `boundEvent`
must be an accepted witnessed Issuee event; a new bound BUP requires the known
current event. Retries reuse stored BUP bytes and an already signed current-branch
KEL seal, even when receipts were missing. They do not author another anchor just
to poll. Issuance inventory follows accepted TEL evidence and preserves the
original issuance reference after later state advances or revocation.

## Optional protected custody

`RegistryCustody({hby, registry, db})` is an explicit capability over the existing
wallet environment. Ordinary inventory never creates it or reads its encrypted
rows. `createCustody(registry, discloser)` requires an accepted locally controlled
inception and the designated discloser's known KEL. Secrets use the authenticated
encrypted Keeper AEID; plaintext fallback and salt regeneration after undisclosed
blinded history are refused.

`derive` returns an event-opening candidate, not accepted standing or permission
to present a credential. `retainDerivedUpdate(event, opening)` records only the
exact event SAID, target, state and optional bound KEL coordinates before new
processing/anchoring. `derivedOpening(event)` requires that exact accepted event
and verifies the reconstructed commitment after reopen; a later public successor
never selects another credential's inputs or publishes private openings.

`exportCustody` and `importCustody` implement the Python-compatible protected
operator handoff on POSIX only. Export exclusively creates a mode0600 file;
import refuses symlinks, non-regular/multiply-linked files, another owner, loose
permissions and mismatched bindings/profile. Transfer is an explicit authenticated
private operator step: file mode does not authenticate the sender or secure the
channel, and the file contains plaintext secret material. Keeper AEID replacement
leaves custody unusable until explicit import with `rewrap: true` under the current
authenticated Keeper; there is no automatic migration or key distribution.
