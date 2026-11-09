# @keri-ts/wallet

## 2.0.1

### Patch Changes

- 1f23273: Depend on keri-ts 2.0.1, which rejects credentials whose body does not match their SAID. These packages pin keri-ts to an exact version, so they must be republished for the fix to reach their installs.

## 2.0.0

First npm release, coordinated with cesr-ts and keri-ts 2.0.0.

### Major Changes

- Remove plaintext registry-custody import/export and operator rewrap APIs and commands. Keep local encrypted derivation with registry/controller/discloser bindings and require exact retained event coordinates for disclosure, including after reopen. Remove the IPEX disclosure-only bound-event option used by coordinate guessing; authoring bound-event selection remains supported.
- Use one upstream-aligned ACDC chaining evaluator for IPEX and application use.
  Remove the private graph evaluator and its unsupported operator/schema profiles.
  Applications supply issued-state verdicts, including the origin, and retain unknown
  optional branches until AND/OR reduction; schema and graph-shape failures remain global.

### Minor Changes

- Compose ACDC v2 group registry authoring and exact IPEX member approvals with the existing threshold, registry, graph and wallet owners. Keep protocol acceptance distinct from current-use authorization and explicit holder consent, and preserve approved disclosure bytes across retries and reopen.

  Preserve same-state BUP advances, explicit HTTP attachment genus, and raw CESR opening files at the CLI boundary.

- Compose ACDC v2 wallet IPEX negotiation, explicit unblinding and exact-view presentation through the existing CLI family. Gather required source-anchor receipts before returning Grant/Admit wire, preserve separate presenter authorization and holder consent, and select witness attachment genus independently of message body version.

  Forward explicit operator KRAM configuration through finite and hosted operations, and preserve registry aliases across installed Node command invocations.

- Add wallet inventory with explicit consent to exact accepted Grant/Admit pairs, original issuance bytes, and retained disclosure reads across reopen. Export the existing protocol owners required by the separately installed wallet package.
- Add optional encrypted registry custody with protected Python-compatible operator handoff and exact event-specific opening derivation after reopen.

### Patch Changes

- Add body-only credential preparation and finite individual derived issuance through a fresh pending Grant, explicit recipient DH setup, actual anchored issued BUP, and verification of the original Grant. Preserve separate wallet Admit consent, exact far-node disclosure authorization, and the original deadline when retrying a fully signed auxiliary query after delayed receiver approval.
- Remove the issuer-endorsement file workflow (`tufa ipex endorse` and `WalletDiscloser.endorseGrant`), matching KERIpy and Locksmith. Exact-file `--prepare`, `--proposal` and `--resume` remain for collecting group sender signatures, and core issuer-designation verification is unchanged.
- Include root-first delegation ancestry in wallet disclosure support, preserving accepted KEL histories and exact proof attachments so independent receivers can verify delegated credential issuers.
- Forward transient hosted-witness authorization through ACDC v2 registry authoring and finite issuer DH issuance, including exact group anchor receipt collection and anchored IPEX Grant, Agree, Admit and presentation operations.
- Read live Grant deadlines from the original accepted KRAM transaction record instead of partial-escrow cleanup state. Keep group proposals without auxiliary authority until sender authentication completes, preserve microsecond expiry, and require KRAM-backed Grants for live DH and Unblind.
- Retain registry custody roots in the encrypted Keeper and preserve them across AEID rotation.
- Require the full registry/ordinal/TEL-SAID seal for v2 registry acceptance, discovery, source locators and author retry. Keep public stateless registry verification aligned with Python digest-commitment semantics, including bare SAIDs and nonbinding sequence hints, under the existing accepted-branch and witness checks.
- Compose v2 registry inception, issuance, BUP state advances and revocation through exact witnessed acceptance, with explicit public openings or protected derived custody and thin CLI operations.
- Prepare v2 wallet Admit signatures only after explicit consent and current authenticated root truth, with thin CLI admission and exact Grant-keyed inventory/read commands.
- Include the registry identifier in v2 registry inception and update anchor seals so Python peers can discover and verify the full registry/ordinal/TEL-SAID tuple. Receipt retries continue to reuse the same signed KEL event.
