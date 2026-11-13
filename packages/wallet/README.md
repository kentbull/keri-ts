# ACDC wallet inventory

This application package retains issued credential bytes and explicit consent to
one accepted Grant/Admit pair. Supply the actual Habery, ACDC v2 RegistryStore,
Exchanger and an opened WalletBaser. Callers own and close those stores.

## Entries

- `@keri-ts/wallet` is browser-safe (it has a `browser` export condition). It exports the
  inventory `Wallet`, `WalletBaser`, `WalletAuthor`, `RegistryCustody`, `WalletDiscloser` and
  `openWalletBaser(opener, identity)`, which opens the inventory through any `StoreOpener`.
  Pass the composition's own opener (for example `hby.opener`, or `indexedDbOpener()` from
  `keri-ts/db/indexeddb`) so the wallet shares its single store queue. Flush with
  `db.store.flushed()` before relying on durability. An `indexedDbOpener()` holds the
  single-writer store lock for its identity, so a second opener on the wallet's own `name` and
  `base` is refused while the wallet is open.
- `@keri-ts/wallet/web` exports everything the root does plus `openWebWallet`, the browser
  composition root, and its wallet-level API.
- `@keri-ts/wallet/lmdb` is the Node-only entry: `createWalletBaser(options)` opens the inventory
  on LMDB. It has no `browser` condition and cannot be bundled for a browser.

## Browser wallet API

`openWebWallet` (from `@keri-ts/wallet/web`) opens an encrypted wallet on IndexedDB with a
running runtime and returns a promise-based API. An app never calls `run(...)` or builds workflow
dependencies.

`delivery` is required: a relay `{ aid, oobi }` sends, queries and polls only through that agent, and
`"direct"` delivers to each party's own endpoints, mailboxes and witnesses, as below. See "Delivering
through an agent" in the wallet library guide for the relay onboarding order.

```ts
const w = await openWebWallet({ name: "alice", bran, delivery: "direct" });

await w.oobis.resolve(witnessOobi); // { outcome: "resolved" | "failed" | "timed-out" }
const icp = await w.identifiers.incept({ alias: "main", witnesses: [witness], toad: 1 });
if (icp.outcome !== "complete") console.warn(icp); // "incomplete" has a reason; w.identifiers.complete retries
await w.oobis.resolve(mailboxOobi);
await w.mailboxes.add(icp.pre, mailbox); // w.mailboxes.remove revokes

// Holder: take a credential offered to you.
const [grant] = w.credentials.pending(); // a pure read
const got = await w.credentials.receive(grant.grant); // consent, wait, admit, record, deliver
if (got.outcome === "admitted" && got.delivery.state === "undelivered") {
  await w.credentials.resendAdmit(grant.grant);
}

// Issuer: one call; `onBegun` hands out the Grant SAID while the exchange runs.
const issued = await w.credentials.issue({
  pre: icp.pre,
  credential: { issuee: holder, attribute: { role: "member" } },
});

// Present, and verify what was presented to you.
await w.credentials.present({ verb: "grant", pre: icp.pre, selection: { said }, options: { message: "", recipient } });
await w.credentials.requestProof(icp.pre, { message: "", recipient: holder, plan: [] }); // the verifier's apply
for (const p of w.credentials.presentations()) await w.credentials.unblind(p.grant);

const health = w.health(); // ok | latched | faulted | stopped | closed
await w.close();
```

Every call that waits takes `timeoutMs` (defaults in `WALLET_TIMEOUTS`) and returns a typed
`outcome` with the status read at return. Remote and clock results are values; only a call that
breaks its contract (an unknown identifier, a Grant not addressed to you, an unresolved mailbox
endpoint) rejects. After `timed-out` the runtime keeps the operation going: calling `receive` or
`unblind` again resumes it, and a finished `issue` is recorded in the inventory by the wallet.
Group identifiers are not covered yet.

### Groups

A group acts through its members' separate consents. The proposer starts something; every other member sees
the same item in `proposals.list()` and consents with `proposals.approve(id)`. The wallet chooses the library call
from the proposal's kind (a key or reply event, a registry event, a group IPEX message, a group issuance Grant), and
the runtime's Counselor and owners finish the work.

```ts
// Proposer: a 2-of-2 group over this wallet's identifier and a co-member whose key state is known.
const g = await w.groups.incept({ alias: "pair", member: icp.pre, smids: [icp.pre, coMember] });
if (g.outcome === "timed-out") await w.groups.wait(g.event); // the other member has not approved yet

// The other member's wallet:
const [proposal] = w.proposals.list(); // { id, family: "event", type: "icp", ... }
await w.proposals.approve(proposal.id, { groupAlias: "pair" }); // joins, then waits for the Counselor

await w.groups.rotate(g.group, { smids }); // also interact, inceptRegistry
await w.groups.proposeMailbox(g.group, mailbox); // members approve it as a proposal ...
await w.groups.completeMailbox(g.group, mailbox); // ... then one member posts it

// Credentials keep their single-signature calls; a group identifier selects the group path.
await w.groups.inceptRegistry(g.group, "members");
await w.credentials.issue({ pre: g.group, registry: "members", credential: { issuee: holder, attribute } }); // custodian
await w.credentials.receive(grant); // a holder group member: consent, Admit, record
await w.credentials.present({ verb: "grant", pre: g.group, selection, options });
await w.credentials.unblind(grant); // as disclosee or as discloser
```

Group calls return the same typed outcomes with the status read at return: `complete`, `superseded`,
`unknown` or `timed-out` for an event; `approved`, `complete`, `ended` or `timed-out` for `proposals.approve`.
`proposals.list({ all: true })` includes proposals already consented to. `proposals.dismiss(id)` removes an
event proposal's local notices (KERI has no reject message). Only the group's elected custodian begins a group
issuance; its other issuer members consent through `proposals.approve`. A group Admit and a group presentation are
delivered by the elected lead member once every contribution is in.

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
Keeper and wallet owners. `createCustody(registry)` reuses that habitat's
Keeper root, or provisions a new Salt128 root for its accepted issuer inception.
It refuses regeneration behind undisclosed blinded history. Ordinary inventory
needs no private capability.

Roots are immutable encrypted `rroots.` values keyed by canonical local AID and
registry SAID. Keeper AEID replacement atomically rewraps them; encryption cannot
be disabled while roots remain. Root possession confers no presentation authority.
DHKE, `RegistryRoot` member replication and network Unblind remain separate owners.

`derive` returns an event-opening candidate. `retainDerivedUpdate(event, opening)`
records only exact event SAID, target, state and optional bound KEL coordinates in
the wallet before processing/anchoring. `derivedOpening(event)` authenticates the
exact accepted event and reconstructed commitment after reopen. Losing the wallet
does not lose the Keeper root, but missing coordinates still refuse derivation;
no coordinate guessing or legacy wallet-secret reader exists.
