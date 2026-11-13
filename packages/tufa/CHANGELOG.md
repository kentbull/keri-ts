# @keri-ts/tufa

## 2.2.2

### Patch Changes

- b82217f: The IPEX disclosure API names the prior exchange by its SAID in `priorSaid` everywhere. `DisclosureBodyOptions` (and `GrantPreparationOptions`) close the option types of `prepareOffer`, `prepareGrantBody`, `prepareGrantFileBody`, `prepareGrant`, `PresentationOptions` and so `proposeGroupPresentation`: the builder's `prior` is no longer an option, so passing it is a type error and untyped input carrying it is refused with a `ValidationError` instead of being ignored (which sent an opening exchange). The `agree`/`spurn` presentation input renames `prior` to `priorSaid`. `storedExchangeWire` is exported from `keri-ts/runtime` as the exact presented bytes of a retained exchange.

## 2.2.1

### Patch Changes

- 9c8977a: A wait on an issuance, presentation or Unblind (`waitForIssuance`, `waitForPresentation`, `waitForUnblinding`) no longer settles while the live operation still holds a message in its delivery outbox: `IssuanceOperations.owes`, `PresentationOperations.owes` and `UnblindingOperations.owes` report it. A group issuer member's `tufa ipex grant --issue --resume` therefore stays until its DH contribution has been handed to the transport, instead of exiting at the `awaitingAnchor` phase with the contribution still queued (the KERIpy custodian then never reached DH quorum and its operation expired). `tufa multisig join --kind <kind>` approves only a pending proposal of that kind (and refuses a `--said` of another kind), so a join never signs an unrelated pending proposal; without `--kind` it still approves the first pending one.
- 02912da: `tufa ipex` group commands with `--acdc-v2` publish the group proposal before the approval wait, so `--approval-timeout 0` still proposes and the pending result lists the published member wrappers (`messages`); `groupIpexMessages` reads them from a live or ended group IPEX operation. Two stale `tufa` CLI test expectations are updated (`--timeout` on `delegate confirm`; the admit command's refusal of a Grant that intake never accepted).

## 2.2.0

### Minor Changes

- f83f935: `tufa delegate confirm` waits for the one thing it needs instead of a fixed 15 s window. `waitForPendingDelegation` observes the delegator's own `delegables.` escrow and `waitForDelegationAnchor` observes a group delegator's anchor until it is receipted; both live in `keri-ts/runtime`, take a caller-supplied `timeoutMs` and return a typed `settled` or `timed-out` outcome. The command gains `--timeout <seconds>` (default 30) for both waits, and its timeout errors now say which request or anchor never arrived. A test drives a group delegator's confirm path through these calls with a second member approving the proposal through `approveGroupProposal`.
- aaa2ff2: The runtime's operation owners keep an in-memory table of live operations only; their status is derived from the protocol stores. `IssuanceOperationStore`, `PresentationOperationStore`, `UnblindingOperationStore`, their `Memory...` implementations, the `IssuanceRecord`, `PresentationRecord` and `UnblindingRecord` types, the `store` dependency of every owner and the `operationStores.issuance`, `.presentation` and `.unblinding` options are removed with no replacement; backward compatibility with 2.1.0 is not kept. `issuanceStatus`, `presentationStatus` and `unblindingStatus` read the pending Grant and its deadline, the held registry root, the registry head, the accepted exchange, the accepted Admit and the peer's stored answer, so a reopened store reads what it read before, except for what lives only in memory: the transient phases, the `abandoned` and `failed` reasons, consent times and the destinations of a delivery. An issuer that ended between staging and anchoring reads `interrupted`; an explicit recovery action is planned for a later release. `resendPresentation(ops, said)` delivers a signed presentation again after a restart by rebuilding its wire from the stored signatures, without signing. The one remaining embedder port is `operationStores.derived`; it now defaults to `BaserDerivedUpdateStore`, which keeps the blind-derivation coordinates durably in the registry database (`dvus.`, a keri-ts-only sub-database). Wire formats are unchanged.
- 6705181: Group DH issuance runs in the runtime. A local group issues or receives a v2 DH credential through `runtime.operations.issuance`, the same live table, `issuanceStatus` and `waitForIssuance` as an individual, so a browser wallet with no CLI can act as the custodian or as a non-custodian member. New explicit calls (each may sign, none waits on a remote): `prepareGroupIssuance` (the custodian's first partial Grant and the proposal), `beginGroupIssuance` (an issuer member's Grant contribution and consent to its DH query contribution; the custodian may pass a credential instead of a proposal), `approveGroupIssuanceExchange` (a holder group member's consent) and `followGroupIssuanceProof` (verifies the custodian's final proof without signing). `groupIssuanceProposals(ops, group)` lists the stored Grant proposals a member may consent to and `groupIssuanceProof` exports the custodian's public proof. The owner's `processOnce` now performs the group steps: it sends each member's own proposal, authenticates the Grant, approves DH, sends the custodian's evidence, query and reply traffic, takes wrappers in, finishes the Grant, proposes the registry update through `proposeRegistryEvent` and broadcasts the proof to the other members. Root copies are sent once per member by the runtime's `RootReplicator`. A member that reloads reads `awaitingExchangeConsent` for a pending Grant and consents again with the same call; a custodian that reloaded after retaining its root reads `interrupted`, since the frozen coordinator and custodian are not stored. `IssuanceDeps` gains an optional `group` (the multiplexor and the registry proposal collaborators; the runtime composes it), `IssuanceDelivery.deliver` takes an optional `topic`, and `IssuancePhase` gains `awaitingGrantSignatures`.

  `@keri-ts/tufa`: `tufa ipex --issue` and `tufa ipex setup` for a group are callers of these calls and keep their flags and output. The orchestration in `ipex-group-issuance.ts` is removed with no replacement: `acceptGroupIssuanceProof` and `awaitGroupIssuanceProof` become `acceptGroupDerivedProof`, `prepareGroupDerivedIssuance` no longer takes a wallet, and `--witness-gvrsn` no longer reaches the group path.

- 9bc1f81: Closes the last CLI-only group behaviour and the gaps left by the group issuance work.

  - A group custodian is told from a member that was sent a root copy by what the stores hold: `deriveGroupCustody(deps, hab, grant)` now takes the Grant and returns null when a `/registry/root` copy was sent to the local member for a disclosed registry, so a member holding a copy of a still-pending Grant is never adopted as the custodian.
  - The issuance owner scans for resumable Grants every `ISSUANCE_SWEEP_MS` (5 s) instead of once, so a custodian that reloaded while its registry update awaited the other members resumes when the update is accepted.
  - Delivery goes through one outbox with retry for every owner (`DeliveryOutbox`). Presentation and Unblind deliveries, single and group, keep the signed bytes on a failure and retry them with a doubling delay until the Grant's deadline, like issuance. `PresentOptions`, the `maxAttempts` option of `present`, `PRESENTATION_RETRY_MS` and `PRESENTATION_MAX_ATTEMPTS` are removed; an exchange with no deadline ends `failed` after `PRESENTATION_RETRY_BOUND_MS` (10 minutes) of failures. The wallet's `present` and `requestProof` lose `maxAttempts` too.
  - A group presents with a presentation registry through the library: `proposeGroupPresentation` accepts `presentationRegistry`, proposes the registry update, and the group IPEX owner signs the member's contribution to the Grant once the group has accepted the update (`proposeGroupIpexAfter`, `GroupIpexPrerequisite`, phase `awaitingRegistryUpdate`). The other members approve the update with `approveGroupProposal` and the Grant with `approveGroupIpex`.
  - The exact-file group presentation moves into the runtime: `preparePresentationFile`, `resumePresentationFile` and `deliverPreparedGrant` hold every check of what a file may change, and the elected lead's delivery is a presentation operation with the same retry. `tufa ipex` for these files only reads and writes them; `preparePresentationGrant` and `resumePresentationGrant` are removed with no replacement.

- 812940d: A group holder admits through the library. `runtime.operations.groupIpex` (`GroupIpexOperations`) owns a local group's v2 IPEX messages: `proposeGroupAdmit` (or `proposeGroupIpex` for any group-authored message, with its nested evidence) and `approveGroupIpex` are the explicit member consents; `groupIpexProposals` lists the stored proposals a member may approve; `groupIpexStatus` is a pure read derived from the stores and `waitForGroupIpex` only observes. The owner loop publishes each member's wrapper, retries a member that is briefly offline with a doubling delay (`RetryBackoff`), collects the other members' stored contributions, authorizes graph use and lets the elected lead send the completed message. `approveMultisigIpexLocally` splits a member's local approval from publication and delivery, and `findStoredMultisigIpex` and `groupIpexApproved` read the stored proposal. `tufa ipex admit --acdc-v2`, group `ipex grant` and `tufa ipex join` for ACDC v2 group messages are callers of these calls and keep their flags and output.
- 1f09ff2: Group DH issuance takes plain signatures and derives what it can. The group is derived from the Grant, the proposal or the credential's registry instead of being passed as a selection: `prepareGroupIssuance(ops, draft, coordinator?)`, the new `proposeGroupIssuance(ops, draft, options?)` (prepare, then the custodian's own approval in one consent), `approveGroupIssuance(ops, grant, options?)` (an issuer member's consent, replacing `beginGroupIssuance`), `approveGroupIssuanceExchange(ops, grant, coordinator?)`, `followGroupIssuanceProof(ops, grant, options?)` and `groupIssuanceProof(ops, grant)`. `groupIssuanceElection(ops, group, coordinator?)` is a pure read of the custodian a coordinator elects and whether the local member is it. The coordinator is an optional pin that defaults to the group's latest establishment event, and the custodian is always the election's: `--custodian` on `tufa ipex` is optional and only asserts it, and `--coordinator` is optional. `approveGroupIssuance` also refuses a proposal the elected custodian did not sign, so an election disagreement fails at consent instead of stalling DH. `GroupIssuanceSelection`, `BeginGroupIssuanceInput`, `beginGroupIssuance` and `GroupBegin` are removed with no replacement; `GroupIssuance` is built from a `GroupParty`, and `deriveGroupCustody` returns a `GroupElection`. The wallet's group `issue`, `proposals.approve`, `receive` and `unblind` call the new functions. keri-ts `AGENTS.md` gains the plain-signature and composition rules.
- 5608eec: A group presents and proves through the library. `runtime.operations.unblinding` now serves a local group on both sides of an Unblind: `requestUnblind` takes a `proposer` for a group disclosee (the proposer authors the threshold query, the other members contribute to it) and the new `answerUnblind` is a group discloser member's consent to contribute to the one threshold reply. The owner's `processOnce` runs the group steps (taking in the members' wrappers, the contribution, publication to the other members, finish); status and wait are unchanged. `UnblindingDeps` gains an optional `group` (the multiplexor and protocol collaborators; the runtime composes it) and `UnblindingRequest.states` is optional. `proposeGroupPresentation` freezes a group's Grant body from a credential view and proposes it through `runtime.operations.groupIpex`, so the other members approve it with `approveGroupIpex` and the elected lead delivers it; a group presentation registry is still a separate group proposal. `tufa ipex unblind` is one caller for individuals and groups: `runGroupUnblind` and `runIndividualUnblind` are replaced by `runUnblind`, and the CLI-owned member loop is removed with no replacement. `tufa ipex grant` for a group without a presentation registry proposes through the library.
- e9ca542: `tufa witness start` and `tufa mailbox start` accept `--version 1.0|2.0`, spelled and valued like `tufa incept --version`, for the host AID they create (default 2.0; an existing alias keeps its KEL version). A host created as KERI 1.0 now signs v1 `/loc/scheme` and `/end/role/add` replies, and the witness HTTP `/ksn` reply follows the witness AID's KEL version instead of always answering KERI 2.0, so a KERIpy v1 deployment accepts what the host publishes. `parseKeriVersionOption` is exported from `keri-ts/cli`.
- f8fb25a: Add library OOBI resolution and query workflows to `keri-ts/runtime`: `resolveOobi`, `beginOobi` and `oobiStatus` report a resolution as resolved, failed (with the Oobiery's recorded reason) or timed out, and `queryKeyState`, `queryAnchor`, `beginKeyStateQuery`, `beginAnchorQuery` and `anchorQueryStatus` run the key-state and anchor queries. `tufa oobi resolve` and `tufa query` now call these functions with unchanged flags, output and errors.
- b544564: `tufa oobi resolve`, `tufa dkr resolve` and the hosted DID resolver wait on the OOBI they were asked for (`waitForOobi` / `oobiStatus`) instead of on every pending runtime job. Unrelated pending group proposals, delegation escrows or queries no longer make an OOBI resolution time out. A timeout now reads `OOBI <url> did not resolve within <ms>ms.`
- 1fc0dcf: The remaining owner functions take plain signatures and derive the identifier from the Grant. Single-signature issuance: `prepareIssuanceGrant(ops, draft)` (the issuer is the credential registry's identifier), `beginIssuance(ops, grant, auths?)`, the new `proposeIssuance(ops, draft, auths?)` (prepare, then begin) and `approveIssuanceExchange(ops, grant)`; `BeginIssuanceInput` is removed, and `GrantDraft` and `PreparedGrant` name the draft and the prepared Grant. `admitIssuance(deps, grant, options?)` derives the holder from the Grant (`AdmitOptions`), `IssuanceAdmit` carries the sending holder, and `deliverIssuanceAdmit(delivery, admitted)` no longer takes a habitat. `receiveIssuance` and `admitAndDeliver` lose their `hab` input. Unblind: `requestUnblind(ops, grant, options?)` and `answerUnblind(ops, grant, options)` derive the party (the Grant's recipient, or its sender for an answer) and take `UnblindingOptions` (`states`, `proposer`); `UnblindingRequest` is removed. Group IPEX: `approveGroupIpex(ops, said, options?)`, and `GroupIpexProposalInput`, `GroupAdmitInput`, `GroupAdmitBegun` and `GroupIpexApproveOptions` name what the functions take. The status and wait functions of the issuance, group IPEX, presentation and Unblind owners take the owner itself instead of a `Pick` of it, `PresentationOptions` is an interface, and the multisig builders and the Multiplexor take named option types. `grantTransactionId` is the one definition of a Grant's DH transaction id.
- f8e8a20: Report registry root copies as typed results instead of CLI output lines. `RootCopyResult` (kin `sent`, `deferred`, `refused` or `failed`, with the group, registry, sender, recipient, exchange SAID and the error object itself) is produced by `RootReplicator.processOnce`, `replicateRootCopy`, and the new `replicateRootCopies` and `resealRootCopies`; `RootExamination` reports a rotation whose recipients could not be selected. `RootCopyReport`, `RootResealFailure` and `RootCopyRecovery` are deprecated, with identical shape and values: they are the CLI's `root_copy` JSON line (a `phase` discriminator, a hard-coded `tufa` command, the error flattened to text), which an embedded wallet should not receive from a library. `replicateRegistryRoots` and `resealRegistryRoots` are deprecated and still return them, now as a thin mapping over the typed path. The `tufa` commands that send and re-seal roots now run through `RootReplicator` with a `MemoryRootLedger` and map results to the same lines in `keri-ts/cli` (`rootCopyLine`, `rootResealLine`), so their output is unchanged.
- 403dc98: Every runtime of a writable Habery now composes the per-identifier DH and Unblind owners (`runtime.ipex`), the operation owners (`runtime.operations`) and, unless `registryRoots: "refuse"`, the root replicator, with no option; a read-only Habery has `ipex === null`. `ipexOwners`, `ipexAuxiliary`, `AgentRuntime.ipexAuxiliary`, `IpexAuxiliarySelection`, `IpexAuxiliary` and the "actual local habitat" check are deleted outright, with no deprecated alias; backward compatibility with 2.1.0 is not kept. Obtain an owner with `runtime.ipex.dhke(hab)` or `runtime.ipex.unblind(hab)`. KRAM is still off when `kram` is omitted, as in KERIpy: the owners still compose, and `approve` of a DH or Unblind owner throws a "requires KRAM" error. `Dhke` and `Unblind` take an optional `kram` flag for this. The deprecated root-copy exports `RootCopyReport`, `RootResealFailure`, `RootCopyRecovery`, `replicateRegistryRoots` and `resealRegistryRoots` are removed; use `replicateRootCopies` and `resealRootCopies`, whose typed results the CLI maps to its unchanged `root_copy` lines. `openWebWallet` drops the `ipexOwners` and `ipexAuxiliary` entries of its `runtime` option, which narrows to `kram` and `operationStores`. Tufa's DH and Unblind commands take the identifier and use the runtime's owners; the individual Unblind command and the group issuance command no longer build a second replicator or operations table, so a group issuance sends exactly one root copy per member. `runPresentationUnblind` is replaced by `runIndividualUnblind` and `runGroupUnblind`. Wire formats are unchanged.
- 24339db: Align the library OOBI, query and event-completion workflows to one contract. Functions take small declared collaborator interfaces instead of an `AgentRuntime`. Waits (`waitForOobi`, `resolveOobi`, `queryKeyState`, `queryAnchor`, `waitForDelegation`) only observe and never start runtime workers; an expired wait is returned as `{ status: "timed-out", timeoutMs }` rather than thrown. Adds `eventStatus`, `waitForOobi`, `observeUntil`, and the `ChangeSink` interface with `MemoryChangeSink` and `signalerChangeSink`. Query status now says whether it is process-local or durable. The CLI commands keep their output and errors.

### Patch Changes

- 6696de3: Add the holder side of runtime-owned issuance to `keri-ts/runtime`: `approveIssuanceExchange` is the holder's consent to the DH exchange, after which `IssuanceOperations.processOnce` answers the issuer's query, waits for its registry update and finishes the Grant, leaving the status at `awaitingAdmitConsent`. `admitIssuance` is the separate Admit consent: it signs and accepts the Admit locally and returns before delivery, so an embedder can record its own inventory first, and `deliverIssuanceAdmit` delivers it. `IssuanceDelivery.deliver` now returns the destinations reached. `waitForIssuance` accepts an `until` predicate. `tufa ipex --issue` for a recipient and `tufa ipex admit --acdc-v2` call the library with unchanged flags, output and wire behaviour.
- 1c68623: Add runtime-owned single-signature DH issuance to `keri-ts/runtime`: `IssuanceOperations` (an operations table driven by `processOnce`), `beginIssuance`, `prepareIssuanceGrant`, `issuanceStatus`, `waitForIssuance`, `abandonIssuance`, the `IssuanceOperationStore` port with `MemoryIssuanceOperationStore`, `posterDelivery`, `MemoryDerivedUpdateStore`, and an `"issuance"` workflow change kind. The user's one `beginIssuance` call authorises the whole issuer workflow, including the later KEL signature that anchors the registry update, only while it lives in memory; after a restart the operation reads `interrupted` and nothing is signed. The Grant's exchange deadline bounds everything and reads `expired`. `tufa ipex --issue` now calls the library and keeps its flags, output, errors and wire behaviour; it records wallet inventory itself after completion.
- adeb33f: Add runtime-owned single-signature IPEX presentation to `keri-ts/runtime`. `present` is the user's one consent: it signs an Offer, Grant, Apply, Agree or Spurn (a Grant may anchor its presentation proof under the same consent), takes it into local intake and returns after local commit. `PresentationOperations.processOnce` delivers the signed bytes, retries a failed delivery and ends the operation at the Grant's original deadline; it never signs, and a restarted process reads `interrupted`. `presentationStatus` is a pure read that includes the peer's stored answer, `waitForPresentation` only observes, and `preparePresentation` returns the signed bytes for a host that files them. `tufa ipex offer|grant|apply|agree|spurn --acdc-v2` call the library with unchanged flags, output, wire order and error text; group identifiers keep their existing CLI branches.
- 2406e6a: keri-ts adds the holder's receive workflows to `keri-ts/runtime`. `admitAndDeliver(deps, input)` signs and accepts the Admit, runs the host's `onAdmitted` step once before delivery (a wallet records its consent in its inventory there), and delivers within a budget; a failed or expired delivery is a value (`delivery: { state: "undelivered", reason }`), and `deliver: false` leaves the bytes to the caller. `receiveIssuance(ops, input)` is the whole individual path for a pending Grant: approve the DH exchange, wait for the issuer, then `admitAndDeliver`, with the typed outcome `admitted | ended | timed-out`; calling it again after `timed-out` resumes. `@keri-ts/wallet`'s `credentials.receive` and `tufa ipex admit --acdc-v2` are thin callers of them with unchanged behavior, flags and output. `RegistryRoot` takes an optional `ChangeSink` and publishes `{ kind: "root", id: registry }` when it retains a root copy (new workflow kind `"root"`), so a host that waited for the root can act; the wallet's sink retries its tracked group-issuance recorders on it, so a member's inventory records a group issuance once the copy arrives.
- 7a3b14e: With `ipexOwners: "per-identifier"`, `createAgentRuntime` now composes the operations owners and `runAgentRuntime` drives them. `runtime.operations` exposes `IssuanceOperations`, `PresentationOperations` and `UnblindingOperations` over in-memory stores, or the stores passed in the additive `operationStores` option, and `runtime.rootReplicator` replicates registry root copies owed by Dhke completions and accepted group rotations. Each owner's `processOnce` runs in its own fiber, so one stuck delivery does not stall the others. A DH owner now exists for every local identifier before traffic, including identifiers created or joined later, so a first DH query is no longer dropped as unowned. `operationStores.rootReplication: "off"` leaves root copies to the commands that send them.
- 18692b5: Add runtime-owned single-signature IPEX Unblind to `keri-ts/runtime`. `requestUnblind` (the disclosee's consent) and `approveUnblind` (the discloser's consent to release proofs) are the only steps that sign. `UnblindingOperations.processOnce` then resends the unchanged query each second, delivers the reply, finishes the pending or live Grant and ends the operation at the Grant's original deadline; a restarted process reads `interrupted` and sends nothing. `unblindingStatus` is a pure read, `waitForUnblinding` only observes, and completion creates no Admit. `tufa ipex unblind --grant` for an individual identifier calls the library with unchanged flags, output and error text; group identifiers keep the existing CLI loop.
- e6c518b: The `@keri-ts/wallet` root is browser-safe: it carries a `browser` export condition and exports the inventory, authoring, custody and disclosure surface with `openWalletBaser(opener, identity)`. `createWalletBaser`, the LMDB-backed factory, moves to the new Node-only `@keri-ts/wallet/lmdb` entry; import it from there. `@keri-ts/wallet/web` exports everything the root does plus `openWebWallet`. The wallet boundary check and the browser bundle gate now cover the root and `./web`, and the gate rejects `./lmdb`.

## 2.1.0

### Minor Changes

- Release 2.1.0 for every published package. It adds the SEDI `I1I` and `DI1I` issuer-identity Edge operators with KERIpy's open Grant walk as the default, a pluggable store contract (ADR-0015) that lets `keri-ts/db` and `keri-ts/runtime` be bundled for a browser over `MemStore` or IndexedDB-backed `WebDBer`, automatic registry root replication to group members at issuance and after rotation, and KERIpy's handling of v2 ACDC sections without a top-level `d`.

  This release contains breaking changes. Upgrade every `@keri-ts/*` package and `cesr-ts` together and follow the [upgrade guide](../../docs/reference/compatibility/MIGRATING_FROM_2_0.md).

  **Breaking changes**

  - The native LMDB surface moves from `keri-ts/db` to `keri-ts/db/lmdb`: `LMDBer`, `PathManager`, `openLMDB`, the `create*` store factories and, from `keri-ts/runtime`, `createHabery`. `openRegistry` requires an `opener` and loses `web`; `openLmdbRegistry` is the LMDB default.
  - Host-only transport moves from `keri-ts/runtime` to `keri-ts/runtime/node`: `Configer` and `createConfiger`, `NodeHttpClient`, `TCPMessenger`, `TCPStreamMessenger`, the TCP send helpers, `socketBytes` and `fileBytes`. `FetchHttpClient` can no longer reach `tcp:` endpoints; use `NodeHttpClient`.
  - The new `openHabery` needs a `StoreOpener` or borrowed stores, and one of `cf`, `createConfig` or `skipConfig`. `createHabery` keeps its arguments.
  - `Baser`, `Keeper`, `Reger`, `Noter`, `Mailboxer`, `RegBaser`, `WalletBaser` and `VerifierCueBaser` compose over an injected `DBer`; their constructors take a store and their LMDB path statics become `Family`. `Suber`, `Komer` and `LMDBer` table methods take an opaque `Table`.
  - `LMDBer` behavior: empty dupsort values and empty or over-long keys throw `DatabaseKeyError`, `addVal` no longer accepts `null`, duplicate reads of an empty key report absent, and failures raise `DatabaseKeyError`, `DatabaseNotOpenError` or `DatabaseOperationError` instead of a bare `Error`.
  - Config files move from `keri/cf/{base}/{name}/{name}.json` to `keri/cf/{base}/{name}.json`, the default `Configer` base is `main`, and the `--compat` home fallback is `~/.keri/cf`. Absolute `--base` and names are refused, the store directory is set to owner-only mode on every open, and an unusable store directory falls back to the home directory.
  - Delivery to a recipient, witness or mailbox whose latest accepted event is KERI v1 fails with `PeerVersionError` instead of sending v2.
  - Grants walk open by default, as in KERIpy. `walkIpexGraph` takes a `"open" | "closed"` policy instead of a boolean and `AcdcGraph` carries it as `walk`; pass `grantWalk: "closed"` for the 2.0 refusal of every Grant that omits a far node.
  - Edge chain evaluation follows KERIpy more strictly: unrecognized unary operators and `NOT` are non-retryable unknowns, every schema pin is checked, and a list, falsy or `n`/`w`-bearing Edge Section is malformed.
  - A v2 ACDC attribute, edge or rule section without a top-level `d` is no longer given one. The bytes and SAID built for such a body change to KERIpy's; credentials authored by 2.0.x keep their inserted `d` and still verify.

- c0b4f45: Breaking: delivery now fails with a typed `PeerVersionError` instead of sending KERI v2 to a recipient, endpoint or mailbox provider whose own latest accepted event is v1. A deliberate `--version 2.0` rotation can now upgrade a v1 identifier.
- d80ccc5: Move to `cesr-ts` and `keri-ts` 2.1.0 so this package and its dependents no longer install libsodium.

### Patch Changes

- Breaking: with `--compat`, the config file's home fallback is `~/.keri/cf/{name}.json` instead of `~/.tufa/cf`, matching where compat stores already fall back, so KERIpy and Tufa find the same config. `Configer` takes `compat`, and the Habery, `tufa agent` and `tufa witness` pass it.
- a3afb18: `RegistryRoot.prepare` now derives each `/registry/root` copy's verification hint for its own registry, from the head BUP's held opening or else an ACDC of that registry nested in any locally stored exchange, including a Grant inside a `/multisig/exn` proposal. Before sealing, the sender checks that its root reproduces the BUP with that hint and refuses otherwise. `--acdc` on `tufa vc registry root send|newcomers` is now an override, an empty hint still sends an unhinted copy, and the new `hinted` option refuses instead of sending a copy that cannot verify. `newcomers` no longer applies one hint to every registry.
- 13d36a2: The DH custodian of a group issuance now sends its retained registry root to every other current signing member once issuance completes: the issuer custodian after `tufa ipex grant --issue`, and the holder custodian at the end of its group `tufa ipex setup`. Copies are fire and forget through the new `replicateRegistryRoots` in `keri-ts/runtime`: each is prepared with a per-registry hint, run under the remaining `--timeout`, and reported as a `root_copy` JSON line after the issuance result. Nothing is retried or recorded, duplicates are harmless, a failed copy never fails the issuance, and `tufa vc registry root send` is the recovery path.
- cbf76c0: After `tufa multisig rotate` or `tufa multisig join` sees a group rotation accepted, every signer of it that held a key in the prior establishment re-seals each registry root it holds for the group to every current signing member that is new in the rotation or whose contributing key changed, with no elected sender. `RegistryRoot.newcomers` gains a `rekeyed` option, `RegistryRoot.resealed` applies the sender rule, and `resealRegistryRoots` in `keri-ts/runtime` sends the copies fire and forget under a 30 second budget, printed as `root_copy` lines that never fail the rotation. The IPEX design doc and ACDC learnings now describe both automatic triggers and their limits.
- 815676b: Breaking: `Configer`, `ConfigerOptions` and `createConfiger` move from `keri-ts/runtime` to `keri-ts/runtime/node`. `openHabery` now needs `cf`, `createConfig` or `skipConfig`; `createHabery` still creates the config file by default.
- c22f1c6: Breaking: `keri-ts/db` and `keri-ts/runtime` are backend-neutral and the native LMDB surface moves to `keri-ts/db/lmdb`. Import `LMDBer` and its options and defaults, `PathManager`, `openLMDB`, `createLMDBer`, `readStoredLmdbMapSize`, `resolveLmdbMapSize`, `clearDatabaserDir`, `BinKey`, `BinVal`, the `create*` store factories and `createHabery` from `keri-ts/db/lmdb`. `openRegistry` now requires an `opener` and loses its `web` option; `openLmdbRegistry` replaces its LMDB default.
- c9d7528: Breaking: `keri-ts/runtime` no longer exports host-only transport. Import `TCPMessenger`, `TCPStreamMessenger`, the `tcp-egress` helpers (`openTcpConnection`, `sendCesrTcp*`, `streamCesrTcp`, `writeCesrTcpSocket` and their types), `socketBytes`, `NodeHttpClient`, `nodeTcpDialer` and `fileBytes` from the new `keri-ts/runtime/node` entrypoint, so `keri-ts/runtime` reaches neither `node:` modules nor the `Deno` global through its transport code. `requireTcpDialer` and `TcpDialer` stay on `keri-ts/runtime`.
- a127ef9: Breaking: TCP egress goes through an optional `HttpClient.tcp` dialer. `FetchHttpClient` has none, so reaching a `tcp:` witness, mailbox or recipient through it now fails with `ValidationError: TCP endpoints are unavailable on this host.`; pass `NodeHttpClient` from `keri-ts/runtime/node`, which supplies the existing TCP behavior.
- e5beae9: Add the guide for upgrading from 2.0.x. Tufa operators using `--config-file` must move config files from `keri/cf/<name>/<name>.json` to `keri/cf/<name>.json`, as the guide describes.

## 2.0.1

### Patch Changes

- 1f23273: Depend on keri-ts 2.0.1, which rejects credentials whose body does not match their SAID. These packages pin keri-ts to an exact version, so they must be republished for the fix to reach their installs.

## 2.0.0

### Breaking changes

- Upgrade the coordinated keri-ts/cesr-ts dependencies to 2.0.0. KERI command
  helpers return typed results; Tufa owns final JSON/presentation after cleanup.
  Output distinguishes approval, acceptance, publication, saved credential evidence
  and completed transport destinations. Pending credential/group work does not
  write completed exports. See the [migration guide](../../docs/reference/compatibility/MIGRATING_TO_2_0.md).
- Reject malformed option/configuration types before opening stores instead of
  coercing/filtering them. Preserve omitted file values and explicit false/zero/
  empty-list overrides. Ports require decimal integers in 1–65535; documented
  zero/fractional waits remain supported. Init validates encryption intent and
  no longer silently falls back to temporary storage.
- Ordinary event and other uncoordinated commands reject group aliases; use the
  supported multisig workflows. Raw group signing identifies a partial contribution.
- Query waits for actual accepted recovery under one deadline; it no longer
  implicitly bootstraps missing OOBIs or reports stale state as completion.
- Remove `--cesr-body-mode` and backed-registry application authoring. Observer
  verification/replay of externally backed legacy TELs remains in KERI.
- Remove plaintext registry-custody import/export and operator rewrap APIs and commands. Keep local encrypted derivation with registry/controller/discloser bindings and require exact retained event coordinates for disclosure, including after reopen. Remove the IPEX disclosure-only bound-event option used by coordinate guessing; authoring bound-event selection remains supported.

### Features and fixes

- Complete group legacy registry/issuance/revocation and IPEX approval/fanout with
  explicit outer-EXN selection, exact-event resume, business-evidence validation
  and honest pending results. Keep issuer approval, TEL publication, witness
  receipts and transport completion distinct.
- Add `tufa oobi clean` for exact pending keys with preview/apply and partial-failure
  reporting through normal Baser loading. Preview accepts ordinary startup effects;
  missing databases fail. Shutdown failure never prints final command success.
- Own the verifier webhook application and cue store at `@keri-ts/tufa/runtime`,
  with the existing `verifier run` CLI and once-mode cleanup contract. Count actual
  business-policy refusals without invalidating protocol evidence.
- Share finite init/incept OOBI/authentication bootstrap, retain failed mailbox
  batches for retry and use explicit transport ownership with joined cancellation.
- Organize CLI adapters/registrations by subject while preserving all four existing
  npm embedding entrypoints. Installed runtime/declaration checks cover the package
  boundaries; native ACDC/registry CLI completion and publication remain deferred.
- Compose ACDC v2 group registry authoring and exact IPEX member approvals with the existing threshold, registry, graph and wallet owners. Keep protocol acceptance distinct from current-use authorization and explicit holder consent, and preserve approved disclosure bytes across retries and reopen.

  Preserve same-state BUP advances, explicit HTTP attachment genus, and raw CESR opening files at the CLI boundary.

- Compose ACDC v2 wallet IPEX negotiation, explicit unblinding and exact-view presentation through the existing CLI family. Gather required source-anchor receipts before returning Grant/Admit wire, preserve separate presenter authorization and holder consent, and select witness attachment genus independently of message body version.

  Forward explicit operator KRAM configuration through finite and hosted operations, and preserve registry aliases across installed Node command invocations.

- Add `tufa boot backend`, which runs the TypeScript KF boot service. Every flag overrides the `KF_BOOT_*` variable upstream kf-boot reads, so a launcher can switch implementations by changing only the executable. An end-to-end test runs every provider role as a `tufa` subprocess and proves `tufa infra kf onboard --session` recovery after rotation with a lost or partial credentials file.
- Complete the TypeScript KF boot service's routes: `/onboarding/account/create`, idempotent `/onboarding/complete` (also on a completed session, which recovery relies on), and the account surface: `/account/services` with registrar/observer enrollment of the accepted public KEL and an exact acknowledgement check, `/account/witnesses`, `/account/watchers`, `/account/watchers/status` (backend status plus derived resource status), and the witness, watcher and account deletes. Expiry is checked on access.
- Add the core of a TypeScript KF boot service, a port of upstream kf-boot: `KF_BOOT_*` configuration, `GET /health`, `GET /bootstrap/config`, the CESR-over-HTTP onboarding and account surfaces with kf-boot's transport status table and signed v2 replies, the `/onboarding/session/start|status`, `/onboarding/cancel` and `/operations/status` routes, and the provisioning worker that allocates witnesses across distinct backends and one watcher through the service-admin clients.
- Make the Tufa hosted witness backend follow upstream witness-hk for the whole TOTP workflow. `POST /aids` accepts the controller's full KEL (as KERIpy `kli witness authenticate` and Locksmith send it), so controllers can register or re-register after rotation; the parser alone authenticates events, and a supplied `secret` is used as given. On `POST /receipts` an invalid or missing code no longer returns 403: the event is processed as remote input (202 while escrowed, 200 with the receipt once accepted). A multi-event `/receipts` body is 400, and an unknown destination on `/aids` or `/receipts` is 400. Core `witnessReceiptPost` and hosting `handleWitnessReceiptPost` gain an optional `{ local }` option (default `true`), and hosting exports `handleWitnessReceiptPost`.
- Use XIP openers and prior-derived EXN transaction identities for v2 IPEX. Encode exactly one disclosure DAG, including explicit empty-plan/vacuous flows, and admit nested XIP nodes only on Offer/Grant routes. Remove the caller-supplied Tufa transaction ID option.
- Add a hosted-watcher backend with public observation service, configurable key-state polling and a separate loopback-only provisioning listener for KERI Foundation allocation.

  Route account witness OOBIs to their explicit serving witness so watcher introductions can resolve the account's witnessed KEL.

- Add a hosted-witness backend with public receipt service and a separate loopback-only provisioning listener for KERI Foundation allocation.

  Emit receipt bodies and attachments in the receipted event's version, and return v2 signed witness key-state notices.

- Add explicit KERI Foundation provider discovery and signed onboarding allocation, status and cancellation commands using an existing local signer. Allocation remains separate from account activation.
- Run Registrar and Observer through normal TLS service commands with persistent private account enrollment. Keep configured Observer source access separate from revocable wallet publication/read permissions, and preserve both service state and permissions across restart.
- Enroll existing local accounts through KF boot and reuse its stored witness credentials for authoring.
- Accept received `/registry/root` copies automatically, matching KERIpy kentbull/keripy#168. `RegistryRoot.handle` retains a copy that verifies on arrival and escrows the rest in `Baser.rrpe` until they are retained or refused; `RegistryRoot.processEscrows` retries them and `Exchanger.processEscrows` now calls `processEscrows()` on any route handler that defines it. Refused copies leave the escrow, a different retained root is never replaced, and a newly retained root adds one informational `/exn/registry/root` note. `dismiss` is removed, `pending()` lists escrow entries without decrypting, and `receive(said, { event, opening })` is only a manual retry. `tufa vc registry root receive` is now a drain (`--message`, or `--listen` with `--registry`), and `--sender` is removed.
- Keep deferred `/registry/root` copies escrowed until they are retained or refused, matching the KERIpy v2 TEL dependency-escrow idiom: `RegistryRoot.TimeoutRRE` and `timeoutRRE` are removed, `Baser.rrpe` records when a copy entered escrow, and `PendingRootCopy.deadline` is replaced by `escrowed`. An identical resend of a stored copy that is neither escrowed nor retained is escrowed again instead of being ignored. `Habery` load now commits the members of a local group's latest accepted establishment event when an interrupted live commit left `smids`/`rmids` stale (`Habery.recoverAcceptedGroupMembers`, `acceptedGroupMembers`).
- Replicate existing ACDC v2 registry roots to group members as KERIpy's local-profile `/registry/root` ESSR `exn`, replacing the `RegistrySalt` `/registry/salt` reply profile. `RegistryRoot` authorizes copies from the accepted KEL/TEL, stores copies that only lack local state as pending instead of dropping them, ignores duplicate SAIDs and retains a root only once it verifies against local state. KRAM exempts `exn` `/registry/root` by default. Tufa's `vc registry root send|receive|newcomers` match `kli`: mailbox delivery on the `credential` topic, `--out`/`--message` file fallback and `receive --listen`; the `prepare` and `contribute` file commands are removed.
- Add `Hab.decrypt` (KERIpy `BaseHab.decrypt`, defaulting to current keys) and core `registerWithWitness`, which registers a controller with a witness the way Locksmith does: the full KEL and any delegation chain as multipart text fields, the returned TOTP secret decrypted with the current keys and returned without persistence. `tufa infra kf onboard` now registers through it, so an account that rotated and lost a credentials row re-registers instead of failing. The hosted witness decrypts its stored code with `Hab.decrypt`.
- Verify retained ACDC v2 Grant views against current authenticated observer evidence and shared graph policy, with read-only historical inspection and exact Grant-keyed reporting through existing cue stores.
- Retain the first authenticated, scoped DH or Unblind query in its actual owner until explicit consent, bounded by the original query and Grant lifetimes. Restore ordinary KRAM replay rejection and acknowledge unhandled custom-query transport without consuming its cache.
- `tufa boot backend` sends registry services the account's public KEL evidence without its own transferable validator receipts, so Python kf-registrar and kf-observer accept the enrollment instead of refusing the stream at the boot's unknown receipt.
- `/multisig/qry` and `/multisig/ipex-proof` are core multisig routes, as in KERIpy (kentbull/keripy#149). The Multiplexor checks that a query child is authored by the group and that a proof child is a Grant for the group, requires a current signing-member sender, and indexes and notifies both without replaying their children. New builders `multisigQueryExn` and `multisigIpexProofExn`, plus `Multiplexor.addChildHandler`, let several owners share one route by nested child route; the agent runtime exposes its `mux`. Tufa group DH, Unblind and issuance proof coordination use these instead of replacing exchanger routes. The KERIpy reference pin moves to `v2-spec` `f05d200c`.
- Resolve rotation witness authorization before changing keys, and allow Tufa to reuse stored KF witness credentials.
- Add body-only credential preparation and finite individual derived issuance through a fresh pending Grant, explicit recipient DH setup, actual anchored issued BUP, and verification of the original Grant. Preserve separate wallet Admit consent, exact far-node disclosure authorization, and the original deadline when retrying a fully signed auxiliary query after delayed receiver approval.
- Remove the issuer-endorsement file workflow (`tufa ipex endorse` and `WalletDiscloser.endorseGrant`), matching KERIpy and Locksmith. Exact-file `--prepare`, `--proposal` and `--resume` remain for collecting group sender signatures, and core issuer-designation verification is unchanged.
- Approve v2 group Admit proposals through the existing exact-body graph gate instead of legacy credential settlement. Record wallet admission only after explicit peer approval reaches the accepted group threshold.
- Allow finite group issuance and live Unblind commands to borrow their runtime for optional direct HTTP intake.
- Add finite group derived issuance with exact member Grant and DH contributions, frozen coordinator custody, separate BUP approval, and explicit final proof verification for rootless members. Preserve the original Grant deadline through pending-proof serialization and keep wallet Admit separate.
- Send group DH public evidence aggregates through the finite CESR stream delivery path so witness-hosted mailboxes preserve all supporting frames and nested Grant proofs.
- Forward transient hosted-witness authorization through ACDC v2 registry authoring and finite issuer DH issuance, including exact group anchor receipt collection and anchored IPEX Grant, Agree, Admit and presentation operations.
- Extract the existing HTTP host/kernel, Hono app policy and connected protocol routes into `@keri-ts/hosting`, with unchanged listener, routing and cleanup behavior. Tufa retains CLI and role composition and imports the hosting package directly; hosting imports move from Tufa runtime subpaths to the new public package.
- The elected issuer-group custodian now sends the final `/multisig/ipex-proof`, with its public evidence, to the other issuer members by mailbox on topic `multisig`, as KERIpy does for its group proof. An issuer member's `tufa ipex setup --said GRANT` for its own group's Grant polls its mailbox and verifies the proof. `--proof-output` and `--proof FILE` are optional file fallbacks, and the custodian no longer requires `--proof-output`.
- Author group KEL (`/multisig/icp`, `/multisig/rot`, `/multisig/ixn`) and endpoint-role reply (`/multisig/rpy`) proposals in KERIpy's form for both v1 and v2 groups. That form is a v1 exchange wrapper whose named `e` embed carries the group-version child with its own attachment genus. Mixed KERIpy and Tufa groups now complete with v2 KELs, because `kli multisig join` reads only `e` embeds. An explicit v2 wrapper version still selects the nested form, and receiving accepts both forms.

  A v2 member now forwards every message, including a v1 proposal, in a v2 nested `/fwd`. A v1 `/fwd`'s pathed couples cannot follow the member's v2 introduction, so a v2 witness could not store such a proposal. KERIpy's v2 Poster makes the same change (kentbull/keripy#157), and the default and candidate KERIpy peers are pinned to `v2-spec` `e16ae719`, which includes it.

- `tufa infra kf onboard` no longer requires an encrypted (AEID) Keeper: witness TOTP seeds are kept as plaintext in the 0600 credentials file, as Locksmith does, so the gate protected nothing. Credentials rows are validated as plaintext only, and the `--witness-credentials` help text describes the plaintext file.
- Store KF witness TOTP seeds as plaintext at rest on the controller and encrypt them only in transit. `tufa infra kf onboard` writes the seed to the 0600 `--credentials` file instead of ciphertext bound to the account's inception key, so credentialed rotations no longer need to re-encrypt the file.
- Accept signed witness registration KELs as multipart text fields from Python clients.
- Reclaim expired, failed and cancelled KF boot onboarding sessions. A periodic sweep (`KF_BOOT_CLEANUP_INTERVAL_SECONDS`, default 60; `KF_BOOT_CLEANUP_RUNNER_ENABLED`) expires lapsed sessions, deletes their witnesses and watcher through the backend admin APIs and then sets `resources_cleaned_at`, so the account AID can start onboarding again instead of receiving a permanent 409 "Session cleanup pending". A failed teardown stays pending and is retried on the next sweep. `/health` reports the cleanup runner as kf-boot does.
- `tufa infra kf onboard` introduces the account to its watcher with `PUT /`, the route Python watcher-hk uses for raw CESR streams, so onboarding against a Python watcher no longer fails with HTTP 400.
- Read live Grant deadlines from the original accepted KRAM transaction record instead of partial-escrow cleanup state. Keep group proposals without auxiliary authority until sender authentication completes, preserve microsecond expiry, and require KRAM-backed Grants for live DH and Unblind.
- Add finite individual and group live Unblind commands for exact retained presentations, preserving original deadlines, nested public evidence, minimum ordinary/bound openings and admitted history. Keep offline candidate recovery and explicit wallet Admit separate, and schedule group replies only after an authenticated peer query.
- Select the intended hosted mailbox during mailbox add and remove requests to shared provider origins.
- Allow configured Observer service readers with explicit public KEL bootstrap, preserving their access independently of dynamic account enrollment and revocation.
- Retain registry custody roots in the encrypted Keeper and preserve them across AEID rotation.
- `createAgentRuntime` now registers `RegistryRoot` whenever a v2 registry is available and exposes it as `runtime.registryRoot`, so any runtime that polls the `credential` mailbox retains `/registry/root` copies on arrival or escrows them until local state arrives, with no `receive` command. `RegistryRoot.reconcile()`, run on construction, escrows and attempts stored copies that an Exchanger without the handler left unescrowed. The new `registryRoots: "refuse"` option registers the new `RouteRefuser` instead, which rejects the route so nothing is persisted. `tufa vc registry root receive` uses the runtime's handler.
- Hosted witness, watcher, boot, registrar and observer services and the witness/mailbox startup runtimes compose with `registryRoots: "refuse"`, so a `/registry/root` copy addressed to a service identity is rejected and nothing is persisted. `tufa vc registry root receive` now adopts stored copies that no handler escrowed (`RegistryRoot.reconcile()`) before draining, and its help text marks it as an optional drain: any runtime that polls the credential mailbox, such as `tufa agent`, already retains copies.
- Add the KF service-admin client (`WitnessAdmin`, `WatcherAdmin`, `RegistryAdmin`), a port of kf-boot's private boot API client, and the cross-implementation service-admin contract suite (`deno task test:contract`) that runs it against the TypeScript witness, watcher, registrar and observer roles and, when their entrypoints are configured, the Python witness-hk, watcher-hk, kf-registrar and kf-observer services.
- The kf boot service selects witness backends with `cesr-ts`'s `blake2bDigest` instead of importing `@noble/hashes` directly, so the Tufa npm package passes its forbidden-dependency guard again.
- Stop mapping and depending on `@keri-ts/multisync` in the Tufa npm build. Tufa selects group newcomers through the core registry-root API since the ESSR root replication change, so the stale mapping made the npm build fail.
- Add KLI-style `--version` (1.0 or 2.0, default 2.0) to Tufa inception, rotation, interaction and multisig commands so identifiers can author v1 KELs for v1-only peers. Rotation and interaction keep the accepted KEL version and refuse a conflicting selection.
- `Unblind.openings(xid)` returns the verified openings an authenticated Unblind reply selected (KERIpy kentbull/keripy#156). `Unblind.requery(xid)` and `Dhke.requery(xid)` re-sign a started individual query at send time without extending the Grant deadline (KERIpy #159). `tufa ipex unblind` now runs live `--grant` qry/rpy Unblind by default, as KERIpy does. Offline `--opening` candidate recovery is the explicit fallback.
- Compose v2 registry inception, issuance, BUP state advances and revocation through exact witnessed acceptance, with explicit public openings or protected derived custody and thin CLI operations.
- Prepare v2 wallet Admit signatures only after explicit consent and current authenticated root truth, with thin CLI admission and exact Grant-keyed inventory/read commands.
- Extract the existing credential verifier application, cue store, business policy and webhook workflow into `@keri-ts/verifier`. Tufa retains CLI registration and host composition and consumes the package directly; verifier imports move from `@keri-ts/tufa/runtime` to the new public package without a forwarding facade.
- Use the runtime HTTP client and ordinary HTTPS certificate validation for ACDC v2 observer requests. Move observer selection, observation age and request timeout into the verifier application configuration, removing the dedicated observer and TLS command-line options.

## 1.0.0

### Breaking CLI and host changes

- Use the same concrete host workers for finite commands and long-lived agents;
  replace polling-turn controls with elapsed timeout options and joined shutdown.
- Return endpoint-role proposals as recipient/SAID records instead of a misleading
  single message identifier. Select actual member signers and hosted identities
  explicitly; do not expose internal signatory/keeper identities by default.
- Remove budgeting flags, duplicate runtime drivers and unsupported delivery
  acknowledgements. Preserve signed endpoint authorization, mailbox routing,
  protocol caches and actual request/response ownership.

### Correctness and packaging

- Preserve explicit host/runtime/protocol-handler package boundaries, generated
  export/bin targets and strict installed declarations.
- Keep DID artifact generation/resolution, witnessed/group workflows and mailbox
  IPEX on the supported KERI runtime operations. Final dependencies advance to
  cesr-ts 1.0.0 and keri-ts 1.0.0.

## 0.11.0

### Minor Changes

- 2f238e9: Replace collected KEL replay cues with reopenable message sources and stream
  HTTP replies with bounded runtime-owned readers. Bound query requests and
  continuations, retaining failed deliveries for retry.
- aef51c0: Require Node 20.3 or later for generated npm packages. Node 18 is no longer supported; transport cancellation uses native AbortSignal.any.
- 96b197e: Initialize pinned sodium npm bindings with Node 18's native secure randomness when the global is absent.
  Declare Node 18.17 as the KERI/Tufa minimum required by their abort-signal composition.
- f515cf8: Use progressive parsing for asynchronous annotation, streaming CLI validation,
  and replay benchmarks. Bound finite annotation and benchmark input explicitly,
  preserve nested CESR/ESSR wire in annotation round trips, and own Tufa input and
  output through Effection scopes. Remove unused annotation hints and speculative
  parser-mode/partial-error benchmark flags.
- 4740ffe: Parse HTTP and file sources progressively within Effection scopes, serialize dispatch and cue consumption with bounded admission, and reserve direct query replies by query SAID. Cancel and join request readers and release staged frame payloads when their owning scope ends.
- c0e9445: Remove the synchronous CESR stream engine, feed/flush/reset API, parser event
  wrappers, unused KERI CESR re-export stubs, and atomic ESSR conversion adapter. Expose async finite parseBytes
  alongside progressive parse; use the same engine for complete KERI records and
  streamed grant-file inspection. Shorten benchmark API names to benchmarkParser,
  BenchmarkOptions, and BenchmarkResult; countFrames returns the single-run count
  directly. Preserve KERI/CESR/ACDC protocol versions.
- 17bff5b: Reject malformed attachment wrapper tails consistently. Replace the dispatch entrypoints with parseAttachmentGroup, remove parser recovery options and parser-related --compat flags, and migrate runtime callers. Opaque wire families and KERIpy filesystem compatibility remain supported.
- 8abb84a: Run dispatch and mailbox settlement as Effection operations before advancing ingress, pass the receiving mailbox identity explicitly, and cancel and join owned webhook I/O when its operation stops.

### Patch Changes

- d85fa42: Retain canonical Compactor descendants through compaction and expansion, and support path-directed disclosure closures. Add bounded Pather resolution for the IPEX disclosure prerequisite while keeping wire path construction independent of the traversal limit.
- 1692418: Resume bounded command-local mailbox polling across endpoints and habitats so an empty earlier long poll cannot starve queued proxy replay. Keep one absolute turn budget, sequential transport, durable cursor acceptance and joined cleanup.
- e97df52: Expose hosted DID JSON artifact construction independently and avoid generating discarded CESR replay for dynamic did.json requests.
- a1930f7: Atomically retain direct query replies through HTTP and queued target cleanup.
- 60fbf59: Separate ESSR admission refusal from verification rejection with typed recipient outcomes and explicit plaintext ownership transfer. Propagate unexpected I/O and key-store failures, classify raw sealed-box authentication narrowly, and dispose finished plaintext when handoff cleanup fails.
- 6019f5a: Preserve and independently verify exchange source seals and route-selected supplemental proofs through escrow, durable storage, and replay. Keep legacy v1 signature intake and nested IPEX guards while exposing typed route dependency escrow.
- 192ecff: Match frozen exchange proof admission and retry policy: require explicit evidence delivery, restrict new missing-state escrows, deduplicate queries, and preserve previously accepted authentication on incomplete redelivery. Clarify valid-factor results and selected supplemental ownership.
- c85823b: Preserve unexpected fetch/cleanup failures and close published replies on late request cancellation.
- e67d273: Transfer generic HTTP cues to the existing bounded delivery, mailbox correlation and pending-query owners before removing the source. Run network delivery outside Reactor and preserve each earlier query's exact authorization and request-local admission failure provenance.
- ab1821e: Serve OOBI replies through admitted lazy Hab message sources with bounded metadata and per-message preparation.
- e4e8b35: Raise the finite shared default stream ceiling to eight so KLI mailbox and witness long polls leave room for ingress and delivery. The 256 MiB byte ceiling, one decryption ceiling, configured-policy refusal and joined cleanup remain unchanged.
- a190518: Separate synchronous nested multisig body construction from byte parsing and wire preparation. Reuse parsed child frames without payload reads; retain bounded cancellable preparation and existing v1/v2 wire behavior.
- 9b1972f: Verify nested v2 IPEX disclosures and independent issuer evidence before durable exchange acceptance. Preserve dependency escrow and replay, add a verified observer registry store, and separate pure body construction from cancellable byte preparation. Presentation registries remain guarded pending receiver-owned KRAM intake.
- ef4491d: Support nested v2 multisig event and reply proposals with independent child commitments, durable local approval replay, and cursor-safe exchange escrow retry.
- 9a4c726: Use Node 18-compatible promises for transport drain and joined shutdown.
- 33b1921: Enable explicit optional KRAM runtime intake with scoped ready consumption, finite pruning and exact HTTP refusal handling.
- c8332a2: Parse enclosed nested messages as bounded parent-owned trees, preserving each child's body, signatures, genus, and payload resources. Dispose complete trees at ownership boundaries and reject nested runtime processing, serialization, and annotation explicitly until those consumers support their evidence.
- 2da7cc5: Defer query response parsing until guarded cue handling completes, stream mailbox SSE with owned readers and consumer backpressure, and bound finite document and admin response collection.
- d485e44: Make CESR frame completion independent of network chunk boundaries. Open
  attachment sets now wait for a following body, a complete enclosure, or explicit
  flush. Terminal partial attachments report shortage without emitting an
  incomplete frame; flush drains all complete frames in either emission mode.

  Remove the frameBoundaryPolicy option, policy exports, and deferred-frame
  wrapper. Update complete-record runtime consumers to finish parsing explicitly
  and keep multisig attachment sets open while appending peer signatures.

- 5ed6b87: Emit stored transferable receipts as indexed signature groups during KEL replay so current KERIpy can consume complete OOBI responses. Validate and escrow grouped replay receipts without imposing a controller signing threshold or losing following endpoint replies.
- 5e18dfa: Reserve shared runtime credit before HTTP frame preparation and retain it through joined transport cleanup, including the first asynchronous diagnostic cancellation.
- 1a3d433: Admit outgoing source parsers and query uploads through the runtime policy, retaining source and frame ownership through response consumption and joined cleanup.
- 894529a: Admit query wire preparation and queued request ownership through the shared runtime policy before acquiring lazy message sources.
- 4ed2f6a: Reserve shared runtime credit for lazy HTTP replay and distinguish temporary capacity refusal from configured size limits.
- 935952f: Retain shared ordinary-tree admission credit across parser delivery, nested ownership, consumer disposal and joined cleanup.
- a393238: Share runtime admission with witness delivery and join TCP socket cleanup before releasing its stream and byte credit.
- c3ff9d3: Serve static DID artifacts under shared admission with demand-driven file reads and joined response cleanup.
  Terminate and report streamed HTTP body failures after headers have been sent.
- 9d33d98: Process witness TCP input progressively under bounded connection admission, preserving refusal provenance and joined shutdown ownership.
- d8f19fc: Keep one deferred TCP query reply on its accepted connection through joined output or deadline.
- f171389: Return correlated immediate receipts and query replies on accepted TCP connections.
- 1d238bd: Serve ordered legacy TSN replies through their independently authenticated receiver routes and retain bounded HTTP response-pair ownership through source cleanup.
- 29f8143: Resolve advertised host kernel and protocol handler exports from actual generated npm output.
- 53b75a3: Apply sender allow/deny policy and proof prerequisites before v2 non-event dispatch. Preserve query requester identity and prevent refused requests from opening HTTP mailbox responses.
- 547c566: Verify supplied ACDC v2 registry chains, issuer anchors, and blinded state bindings
  with typed missing/reject outcomes and microsecond historical cutoff selection.
  Nested IPEX workflow integration remains guarded.
- 8108a95: Transfer witness cues to the existing delivery batch and consume borrowed emissions outside Reactor through joined cleanup. Finite wrappers return caller-owned wire snapshots capped at a local 8 MiB aggregate and captured cue-count limit; drains require the runtime source deck.
- 2a23a53: Return witness KEL query results as captured lazy messages and serve them with shared response admission, preserving selector order and per-event native preflight.

## 0.10.6

### Patch Changes

- 33645fd: Enter response-owner cleanup immediately when an operating-system signal requests HTTP shutdown, before waiting for active responses to drain.

## 0.10.5

### Patch Changes

- b407ed2: Close runtime-owned mailbox response streams before the Tufa HTTP host waits for active responses to drain.

## 0.10.4

### Patch Changes

- ce87fb3: Consume the KERI runtime release that closes active mailbox streams before LMDB shutdown.

## 0.10.3

### Patch Changes

- ea53199: Expose granular runtime module subpaths so Deno consumers can preserve least-privilege imports without eagerly initializing unrelated native and host modules.

## 0.10.2

### Patch Changes

- 2a2fa28: Resolve KERI runtime CESR imports through the published `cesr-ts` dependency so consumers receive one compatible set of nominal CESR classes and types.

## 0.10.1

### Patch Changes

- 8b4adce: Authenticate mailbox queries against the recipient's current signing threshold before streaming private messages. Reject foreign requester identities, forged signature material, insufficient or duplicate signature indices, and old-key queries after rotation while preserving public KEL query behavior.

  Recheck each exact HTTP mailbox request before correlating stream cues, returning 403 for invalid or currently unverifiable requests so an older cue cannot authorize different attachments.

- 16dbf0b: Publish the KERI database and protocol runtime surfaces and Tufa host embedding APIs required by downstream services.
- b1424e6: Keep HTTP shutdown signal handlers installed until the listener has finished draining, and join that drain when the host operation is cancelled. Repeated termination signals during cleanup no longer restore the default abrupt-exit behavior before HTTP ownership ends.
- 6b75316: Expose signed witness key-state replies at GET /ksn. Require the selected witness destination and fully witnessed accepted state before serving the existing KERI reply encoding.
- fdde61b: Add a `tufa db dump --map-size` override for inspecting large KERIpy LMDB environments.
- 3011934: Normalize structured weighted thresholds loaded from Tufa multisig inception files and prove the public nested-group workflow.

## 0.10.0

### Minor Changes

- 1c31b6e: Use new lifecycle context helpers for managing Habery, Regery, Hab, Runtime, and other objects CLI commands depend on'
- 85d5a53: Clean up mailbox and witness CLI and workflow architectural layering.

### Patch Changes

- d1ebfb6: Refactored the CLI layer to use a unified dispatch function, registerDispatchedCommand, for consistency of approach and style.
- 1f14f5c: Fixed the build process to use explicit public package boundaries and upgraded libsodium-wrappers to 0.8.4

## 0.9.1

### Patch Changes

- 961ddd7: Align did:webs keri.cesr generation with the Python did-webs-resolver artifact shape so controller KEL replay is emitted once before endpoint and designated-alias material.

## 0.9.0

### Minor Changes

- Add `tufa dws bind`, `tufa dws generate`, `tufa dws resolve`,
  `tufa dws resolver`, `tufa dkr resolve`, static/dynamic did:webs artifact
  hosting, and Universal Resolver `/1.0/identifiers` routing.
- 888bd90: Rename IPEX and multisig runtime CLI controls to `--approval-timeout`, `--poll-turns`, and `--poll-budget-ms`, and validate those values before command runtime startup.
- 888bd90: Add public multisig lifecycle commands plus multisig-aware VC and IPEX workflows, including group registry inception, credential issuance, grant approval, and counter profile selection.

### Patch Changes

- Add documentation for IPEX and VC features.
- 888bd90: Remove OOBI URL-derived endpoint hint persistence and reject missing Tufa startup endpoint config instead of synthesizing `/loc/scheme` or `/end/role/add` state.
- 888bd90: Add explicit multisig mailbox authorization support through `tufa mailbox add --multisig-mode` and share the group endpoint-role proposal path with `tufa ends add` and `tufa multisig rpy`.

## 0.8.0

### Minor Changes

- 6286759: Release the ACDC/TEL/IPEX implementation as v0.8.0 across Tufa, CESR, and
  KERI packages, including the end-to-end issuer, holder, verifier, KERIpy
  interop, credential-chain, revocation, and saidification workflows.

### Patch Changes

- b7fb4e0: Add registry-backed VC and IPEX CLI operations for schema import, registry
  management, credential create/list/export/import/revoke, and single-sig
  grant/admit artifact workflows.
- 9bd9030: Fix ACDC credential presentation proof serialization for KLI-issued
  credentials, add a separate Sally-style `tufa hook demo` webhook target, and
  cover KLI issuer -> Tufa holder -> Tufa verifier interop through the public
  CLI workflow.
- b0db7b1: Add KLI-holder and mixed KLI/Tufa credential-chain interop support, including
  bounded `tufa ipex poll` mailbox processing, KERIpy-compatible forwarded ACDC
  support payload handling, bidirectional revocation propagation, and I2I/NI2I
  mixed-chain verifier gates with a KERIpy IPEX message-length preflight for the
  known local `serializeMessage` quadlet-alignment bug.
- 1f82a5d: Add KERIpy-shaped multisig EXN coordination for registry inception, issue,
  revoke, replies, and wrapped IPEX proposals, including runtime registration,
  lead election, and `ipex join --auto` approval support.
- b9abf12: Add the ACDC/VDR foundation: credential mailbox routing, IPEX route handlers,
  schema data OOBI resolution and hosting, parser VDR dispatch seams, and the
  KERIpy-shaped Reger storage owner.
- 580bf65: Add a Sally-like verifier agent with durable verifier cue storage, grant-driven
  presentation processing, revocation webhook handling, schema-validator config
  support, and the `tufa verifier run` command.
- 205a9e9: Persist verifier revocation acknowledgements separately from issuance
  acknowledgements and rescan saved TEL state so `tufa verifier run --once`
  emits revocation webhooks correctly after credential imports in prior CLI
  processes.
- 9bd9030: Add a KLI-compatible `tufa saidify` command for in-place JSON SAD
  saidification, including schema `$id` support and KLI output parity coverage.

## 0.7.0

### Minor Changes

- Align KERI and Tufa with the 0.7.0 release train after the CESR CLI break so generated npm artifacts depend on the 0.7.0 package line.

### Patch Changes

- 87940ec: Move Tufa npm build, host health wait, version generation, and smoke-test
  helpers into checked shared scripts.
- 87940ec: Normalize the Tufa npm `bin.tufa` entry to a bare relative path so npm publish
  does not rewrite package metadata.
- 87940ec: Harden Tufa npm packaging by deriving module and CLI bin paths from DNT output
  and validating those targets in tarball and install smoke tests.

## 0.6.0

### Minor Changes

- Complete delegation communication support for interop release readiness, including notification-backed delegation flows, mailbox/reply processing fixes, and npm artifact build validation needed for staged publication.
