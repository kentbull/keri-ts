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
produce a signature. For a group holder, `prepareAdmitBody` applies the same
consent, prior and root checks without signing. Pass that frozen body through
`prepareAcdcV2GroupIpex` and explicit member approval, then record only the
accepted pair. ACDC v2 attachment genus defaults to 2.0.

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

For group sender-threshold collection, `prepareGrantFileBody` freezes that same selected
view while permitting retryable missing current openings only when the supplied
historical graph verifies as issued. Ordinary `prepareGrantBody` stays strict.
`inspectGrantFile` checks every supplied authentication factor and reports
complete and partial signers without dropping invalid signatures. Group members
combine only their current establishment's signatures. A non-issuer discloser
still needs the registry issuer's authorization on the exact Grant under the core
presentation rule; no wallet API produces it. File preparation, signature contributions and roots create
no Admit; callers retain the original Grant deadline and require complete
presentation scope before delivery or Unblind.

Configure `Receiptor(hby, protocol, http, clock, {gvrsn})` for the actual witness attachment genus,
independently of ACDC v2 IPEX genus. Its default remains 1.0; the known v2
witness profile explicitly selects 2.0. For a group, `prepareGrantBody` freezes
the same selected disclosure without signing. Complete any presentation BUP
against that body before the first member approval; `attachPresentationProof`
extends its proof without changing signed bodies. `prepareAcdcV2GroupIpex`
checks the exact selected graph before each new member signature. Recheck
current graph use after threshold completion and before delivery or consent;
protocol completion alone grants no use authority. Approved wrapper retries
preserve their original nests.

## ACDC v2 authoring

`WalletAuthor(wallet, acdcV2Regery, receiptor, custody?)` borrows the same public
registry environment and actual receipt collector. `incept` returns an exact
accepted RIP; `create` uses the existing ACDC builder; `issue`, `update` and
`revoke` stage BUPs and return only after the exact KEL seal has authenticated
historical witness quorum. `update` is a state advance, never historical `upd`.
For a group, `registry`, `create` and `stage` prepare the same events without
signing. Use `approveAcdcV2Registry` and `publishAcdcV2Registry` for exact member
approval; wait for ordinary accepted KEL/TEL and witness evidence before
recording issuance. Individual signing methods continue to refuse groups.

Public authoring explicitly retains and publishes its event opening. Derived
authoring requires provisioned custody and retains exact nonsecret coordinates
before processing, including a matching pending retry. A supplied `boundEvent`
must be an accepted witnessed Issuee event; a new bound BUP requires the known
current event. Retries reuse stored BUP bytes and an already signed current-branch
KEL seal, even when receipts were missing. They do not author another anchor just
to poll. Issuance inventory follows accepted TEL evidence and preserves the
original issuance reference after later state advances or revocation.

`WalletDiscloser.prepareIssuanceGrantBody(sender, credential, options)` prepares a
different operation: one exact new credential at its issuer's accepted anchored
RIP, before DH and before an issued inventory row exists. `recipient` is explicit
and must equal its issuee. The method returns the same unsigned `PreparedGrantBody`
shape without creating custody, signing, approving DH or admitting a credential.
Ordinary `prepareGrantBody` retains its issued/held disclosure authorization.

Supply every referenced far node through `artifacts`, including its exact issuer
proof; no prior exchange or credential cache fills missing nodes. Far nodes must
already authenticate, so this finite issuer publishes only one fresh origin.
A multinode standalone Grant needs an explicit `plan`; `priorSaid` may select an
accepted unanchored Apply or Agree. Normal IPEX intake still verifies graph,
disclosure and DI2I policy before DH can approve the pending Grant. Python's
selected issuance CLI carries only one origin, while its underlying IPEX supports
explicit graph artifacts; the one-fresh-origin caller scope is not a protocol limit.

After DH provisions the encrypted root, use `RegistryCustody` without calling
`createCustody`, then `WalletAuthor.issue`. Publish accepted BUP/KEL evidence and
finish the original Grant through DH. Recipient Admit remains separate explicit
consent, and only verified Admit may enter held inventory.

## Optional local encrypted custody

`RegistryCustody({hby, hab, registry, db})` binds the actual local habitat,
Keeper and wallet owners. `createCustody(registry)` reuses that habitat's native
Keeper root, or provisions a new Salt128 root for its accepted issuer inception.
It refuses regeneration behind undisclosed blinded history. Ordinary inventory
needs no private capability.

Roots are immutable encrypted `rroots.` values keyed by canonical local AID and
registry SAID. Keeper AEID replacement atomically rewraps them; encryption cannot
be disabled while roots remain. Root possession confers no presentation authority.
DHKE, explicit RegistrySalt transfer and network Unblind remain separate work.

`derive` returns an event-opening candidate. `retainDerivedUpdate(event, opening)`
records only exact event SAID, target, state and optional bound KEL coordinates in
the wallet before processing/anchoring. `derivedOpening(event)` authenticates the
exact accepted event and reconstructed commitment after reopen. Losing the wallet
does not lose the Keeper root, but missing coordinates still refuse derivation;
no coordinate guessing or legacy wallet-secret reader exists.
