# ACDC wallet inventory

This application package retains issued credential bytes and explicit consent to
one accepted Grant/Admit pair. Supply the actual Habery, native RegistryStore,
Exchanger and an opened WalletBaser. Callers own and close those stores.

`recordIssued` verifies accepted local issuance and accepts an explicit blinded
opening. `recordAdmission(..., {consent: true})` requires current authenticated
root truth, the intended local holder and the actual accepted response.
Neither protocol intake nor reading a Grant creates consent automatically.

`prepareAdmit(grant, holder, {consent: true})` checks the exact accepted Grant,
intended local holder and current authenticated root `true` before signing a
native response. It returns `{admit, wire}` without recording inventory. The
caller admits that wire through ordinary ingress, then calls `recordAdmission`
with the actual accepted pair. False/unknown graphs and missing consent never
produce a signature. This operation supports ordinary single-signature holders;
negotiated source anchoring and group admission are deferred and refuse before
signing. Native attachment genus defaults to 2.0.

`inventory`, `admissions`, `issuedCredential` and asynchronous `heldCredential`
read retained history. Held proofs come from that Grant's original nested rows;
a later fuller disclosure, registry update or policy decision does not replace
those bytes. History retrieval authenticates the retained outer exchanges through
Exchanger replay without asserting current issuer standing or graph validity.

Custody, derivation, issuance operations, negotiation and CLI composition are
outside this first owner cut.
