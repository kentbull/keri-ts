# Short names and cohesive workflow results

Status: adopted for release cut 13d in PR #611; execution authorized by Kent.
Date: 2026-10-20.
Source inspected: `de15d7c30d4e13793127db9643456ae9e2e2598d`, after the result
changes reviewed in PR #611 (`cff01e8aef9f34dad617c84f823dcbac9124eca7`).

## Decision

Keep explicit message identities and typed workflow results. Shorten redundant
names, remove internal helper records from the public package API, and replace
the credential base/derived result hierarchy with one public contract for each
operation. CLI presentation stays in Tufa. Signing and sending stay together in
the existing KERI application module.

This is one cohesive API/layering refactor, not new multisig lifecycle behavior.
No old-name aliases, compatibility wrappers, protocol changes, or new framework.
Follow the ten constraints and SOLID through small contracts, composition, and
information hiding; do not introduce abstractions solely to share a few fields.

## Naming options

| Meaning                               | Conservative shortening | Short domain names (recommended) | Module-qualified names       |
| ------------------------------------- | ----------------------- | -------------------------------- | ---------------------------- |
| Recipient and two message identifiers | `MultisigIdentity`      | `GroupMessageRef`                | `Group.MessageRef`           |
| Signed transport input                | `SignedMultisig`        | `SignedGroupMessage`             | `Group.SignedMessage`        |
| One completed send                    | `MultisigDelivery`      | `GroupDelivery`                  | `Group.Delivery`             |
| Aggregate transport report            | `MultisigSendResult`    | `GroupSendResult`                | `Group.SendResult`           |
| Registry inception result             | `RegistryInceptResult`  | `RegistryResult`                 | `Credentials.RegistryResult` |
| Credential authoring/issuance result  | `CredentialResult`      | `IssueResult`                    | `Credentials.IssueResult`    |

Choose the recommended column. These names remain intelligible when imported
from a broad package entrypoint. The last column illustrates ordinary module
import qualification, not a proposal for TypeScript namespaces or new package
entrypoints. Do not add namespace machinery to save characters.

`Ref` means an identity record, not a resource handle or lazy database lookup.
Keep `Send` in the transport result: calling it merely `GroupResult` or
`MultisigResult` would obscure the difference between delivery and acceptance.
Do not shorten `exnSaid` or `payloadSaid`; that distinction was the point of #611.

## Exact naming and visibility changes

| Current contract                                                                          | Target               | Visibility                                                                |
| ----------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `MultisigMessageIdentity`                                                                 | `GroupMessageRef`    | Public nested result record                                               |
| `SignedMultisigMessage`                                                                   | `SignedGroupMessage` | Internal to signing/sending module                                        |
| `MultisigMessageDelivery`                                                                 | `GroupDelivery`      | Internal source-module export where callers need it; no package re-export |
| `MultisigSendResult`                                                                      | `GroupSendResult`    | Public shared result                                                      |
| `CredentialRegistryInceptResult` and `GroupCredentialRegistryInceptResult`                | `RegistryResult`     | One public operation result                                               |
| `CredentialCreateResult`, `CredentialIssuanceResult`, and `GroupCredentialIssuanceResult` | `IssueResult`        | One public operation result                                               |
| `MultisigEventCommandResult`                                                              | `GroupEventResult`   | Existing CLI helper boundary only                                         |
| `GroupEndpointRoleProposalResult`                                                         | `GroupRoleResult`    | Public workflow result used by Tufa                                       |
| `EndsAddResult`                                                                           | `EndRoleResult`      | Existing CLI helper boundary only                                         |

`ApprovalResult` is already short and meaningful; leave it alone. Existing
`grouping.ts::MultisigMessage` is a serder/attachments tuple, not an identity
record; do not rename a new record to collide with it. Existing
`vdr/credentialing.ts::CredentialIssueResult` is the lower-level processor result
containing serders and full TEL/verifier decisions. Keep that separate contract
and its name; the proposed `IssueResult` is the application operation's result.
No collisions with the proposed names were found in the inspected KERI/Tufa source.

Delete the two helper-record re-exports from `runtime/index.ts`. A type may remain
exported between source modules without becoming supported package API. Do not
promote signing/sending helpers to public APIs merely to justify exporting their
argument types. Audit generated declarations for the intended public surface.

## One contract per credential operation

Use these concrete shapes, retaining current field meaning and nullability:

```ts
export interface RegistryResult {
  name: string;
  registry: string | null;
  issuer: string;
  group?: GroupSendResult & {
    route: typeof MULTISIG_VCP_ROUTE;
    status: TelProcessDecision["kind"];
    accepted: boolean;
  };
}

export interface IssueResult {
  creder: SerderACDC;
  recipient: string;
  tel: string | null;
  status: VerifierDecision["kind"];
  group?: GroupSendResult & {
    route: typeof MULTISIG_ISS_ROUTE;
    telStatus: TelProcessDecision["kind"];
    saved: boolean;
  };
}
```

`inceptCredentialRegistry` returns `Operation<RegistryResult>`.
`createCredential` returns `Operation<IssueResult>`.

The optional block expresses a real distinction: group coordination happened.
Its presence requires all of its facts, including a send result even when no
remote member was contacted. Absence means the ordinary single-identifier path.
Do not infer group participation from a nonempty deliveries array. Successful
transport still does not establish acceptance or saved credential state.

The inline block is not another exported result type. Remove the old `issuance`
wrapper and the single/group union. Private helpers may return the complete
operation result or a small inferred intermediate; do not replace the removed
hierarchy with a chain of `Pick`, `Omit`, conditional, or generic result aliases.
Keep existing `TelProcessDecision` and `VerifierDecision` kind types instead of
duplicating their status vocabulary.

This preserves existing observations; it does not harmonize status semantics,
invent completion flags, tighten nullable IDs, or alter when evidence is saved.
Any such behavior change needs its own justification and tests.

## Cohesive helper naming

Keep extraction, signing, sending, local admission, and result aggregation in
`app/multisig-messaging.ts`; do not create a file for every record or helper.
Use the following corresponding verb names where the result names appear:

- `remoteMultisigMembers` -> `remoteGroupMembers`
- `signMultisigMessage` -> `signGroupMessage`
- `sendMultisigMessage` -> `sendGroupMessage`
- `processAndSendMultisigMessage` -> `admitAndSendGroupMessage`
- `multisigSendResult` -> `groupSendResult`

`admit` must retain its documented meaning: process the exact signed local
message before a peer can respond. It does not claim the whole group approved.
Existing payload/embedded-section extraction names can remain unless a direct
caller collision or inconsistent contract makes a rename necessary. Avoid a
global `multisig` -> `group` search-and-replace.

## Tufa projection

Update the affected adapters in `cli/credentials.ts`, `cli/multisig.ts`,
`cli/endpoints.ts`, and mailbox reporting. Tufa explicitly projects identity and
group fields into its existing JSON/report format. In particular, registry JSON
can still expose `route`, `status`, `accepted`, `messages`, and `deliveries` at
the top level by projecting the group block. Credential JSON similarly projects
`creder` identity, `tel`, `status`, and optional group details.

Do not dump the new nested library object directly merely because serialization
is convenient. Preserve the current CLI field names and meaning; this work has
no reason to change them. Keep `exnSaid`, `payloadSaid`, `messages`, `deliveries`,
and `join --said` semantics intact. Do not serialize signed byte buffers or pass
formatting callbacks into KERI. Command results continue to be rendered after
owned resources close.

## Implementation and review sequence

Use one cohesive PR, with two reviewable commits if useful:

1. Shorten the records/helpers and remove unnecessary package exports. Update
   actual imports and declarations together. Preserve all data and behavior.
2. Consolidate credential operation results, update their KERI/CLI callers, and
   adjust Tufa projections and existing assertions together. Include the concise
   API migration note and major changeset for KERI/Tufa.

Main source areas: `multisig-messaging.ts`, `credential-workflows.ts`,
`multisig-workflows.ts`, `endpoint-roleing.ts`, affected `app/cli` helpers and
their index, `runtime/index.ts`, and the Tufa adapters. Inspect current HEAD
before execution; do not overwrite concurrent lifecycle or package work.

Preserve wire bytes, signatures, local-before-send ordering, routing, worker
ownership, error propagation, acceptance predicates, Multiplexor indexes, and
existing protocol/storage behavior. No source reorganization beyond these
cohesive modules, renderer framework, new queue, or extra lifecycle abstraction.

## Validation and completion

- Update existing grouping/endpoint/credential tests to consume the new records.
  Check both ordinary and group registry/issuance paths; keep the independent
  persisted-EXN, Multiplexor, and acceptance assertions.
- Run the affected KERI/Tufa CLI tests and the existing composed multisig test
  with its unchanged participant topology. Assert JSON semantics after Tufa
  projection, not just that a command exited successfully.
- Update the installed TypeScript consumer to use the new public results and
  narrow the optional group block. Run strict declaration/package checks and
  the existing installed registry/credential authoring smoke.
- Use source/declaration review to confirm removal of old exports; add no
  retired-name absence tests, compatibility tests, or tests that merely repeat
  interface declarations. No new interop matrix is warranted for this data/API
  refactor unless a failure exposes a behavioral concern.
- Run formatting, lint/type/library-boundary and changeset checks appropriate
  to the PR. Record only actual validation; no broad qualification claim.

Completion means two public credential operation contracts instead of five,
internal signed/delivery records absent from the public runtime entrypoint,
shorter consistent result names, unchanged CLI meaning, and unchanged protocol
behavior. Update only the affected migration/contract paragraphs; no execution
diary or exhaustive documentation rewrite.
