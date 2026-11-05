# KERI-TS CLI Command Reference

This document provides a concise reference for all CLI commands available in the `keri-ts` workspace, including:

- **Tufa** — The primary KERI application and operator CLI (`tufa`).
- **Tephra** — The CESR tooling CLI provided by the `cesr` package (`tephra`).

Commands are invoked in the monorepo via Deno tasks (e.g. `deno task tufa ...` from `packages/keri` or the `packages/tufa` / `packages/cesr` directories) or via the published binaries after installation.

## Hosted witness backend

`tufa witness backend --name backend --url https://witness.example` runs a hosted-witness backend.
`--url` is the advertised HTTP(S) origin, without credentials, a path, query or fragment.
The public receipt listener defaults to `127.0.0.1:5632`; set `--listen-host` and `--http` for the public service deployment.
The private provisioning listener always binds loopback and defaults to port `5631`; `--boot-port` selects a distinct local port.
Use `--base`, `--head-dir` and `--passcode` for explicit store placement and encryption.

## Hosted watcher backend

`tufa watcher backend --name backend --url https://watcher.example` runs a hosted-watcher backend.
`--url` is the advertised HTTP(S) origin without credentials, a path, query or fragment.
The public observation listener defaults to `127.0.0.1:5642`; `--listen-host` and `--http` select its binding.
The private provisioning listener always binds loopback, with `--boot-port` defaulting to `5641`.
`--poll-interval` sets a positive number of seconds between key-state polls (default `30`).
Use `--base`, `--head-dir` and `--passcode` for explicit store placement and encryption.

## Registry services

`tufa registrar start -n service -a registrar --url https://registrar.example --tls-key key.pem --tls-cert cert.pem`
starts publication with an existing persisted service AID. Repeat `--observer AID` to select its static observer allowlist.
The public HTTPS listener defaults to `127.0.0.1:6632`; private loopback administration defaults to port `6631`.

`tufa observer start -n service -a observer --url https://observer.example --tls-key key.pem --tls-cert cert.pem --registrar https://registrar.example --registrar-ca ca.pem`
starts acquisition with an existing persisted service AID. Repeat `--registrar` for additional HTTPS origins.
`--registrar-ca` supplies explicit CA trust; `--registrar-cert-name` selects the certificate server name when connecting to an IP address.
The public HTTPS listener defaults to `127.0.0.1:6633`; private loopback administration defaults to port `6634`.
`--poll-interval`, `--timeout` and `--maximum-age` accept finite positive seconds, defaulting to `5`, `5` and `15`.

Both commands require an HTTPS origin without credentials, path, query or fragment, and load their TLS PEM files before startup.
Use `--http`, `--listen-host` and `--boot-port` to select distinct listener ports; administration always stays on loopback.
Repeat `--kel PATH` to load explicit public KEL evidence for peer service authentication.
Use `--base`, `--head-dir` and `--passcode` for existing store placement and encryption.

## KERI Foundation provider allocation

`tufa infra kf discover --url https://provider.example` reads advertised profiles without opening a local store.
Use `tufa infra kf start -n store -a onboarding --url https://provider.example --account Eaccount` to allocate a session.
The default profile is `3-of-4`; `--profile` selects another advertised profile. `--alias` selects an existing local onboarding signer; `--account` separately names the intended account AID.
Allocation does not activate the account or complete onboarding. Start, status and cancel report signed provider response facts.

Use the same store, signer and provider URL with `tufa infra kf status --session SESSION` or `--operation OPERATION` (exactly one),
and `tufa infra kf cancel --session SESSION [--reason TEXT]`.
These signed commands accept `--server-aid` to select the expected provider signing AID. All four commands accept `--timeout` in seconds, defaulting to `60`.
Without a pin, the first authenticated reply supplies the server AID for that invocation; retain its `sender` value to pin later commands.
Replies must pass v2 KRAM and exchange authentication. The command uses kf-boot's cache windows unless the store configures its own KRAM policy, and refuses an explicitly disabled policy.
Cancellation acknowledges the request; wait for session `resources_cleaned_at` before treating resource cleanup as complete.

## Tufa Commands (KERI / Application)

| Command                            | Description                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `tufa version`                     | Show tufa version.                                                                       |
| `tufa init`                        | Create a database and keystore.                                                          |
| `tufa incept`                      | Initialize a prefix (create a new local identifier).                                     |
| `tufa rotate`                      | Rotate keys for a local identifier.                                                      |
| `tufa interact`                    | Create and publish an interaction event.                                                 |
| `tufa agent`                       | Start the KERI agent server (long-lived host).                                           |
| `tufa delegate confirm`            | Approve delegated events anchored to one local delegator.                                |
| `tufa multisig incept`             | Initialize a group multisig prefix.                                                      |
| `tufa multisig interact`           | Create and publish a group multisig interaction event.                                   |
| `tufa multisig join`               | Join one pending group multisig proposal.                                                |
| `tufa multisig rotate`             | Rotate a group multisig prefix.                                                          |
| `tufa multisig rpy`                | Propose a group endpoint-role authorization reply.                                       |
| `tufa sign`                        | Sign an arbitrary string.                                                                |
| `tufa verify`                      | Verify signature(s) on arbitrary data.                                                   |
| `tufa query`                       | Request KEL (key event log) from a witness.                                              |
| `tufa export`                      | Export key events in CESR stream format.                                                 |
| `tufa list`                        | List existing local identifiers.                                                         |
| `tufa aid`                         | Print the AID (prefix) for a given alias.                                                |
| `tufa saidify`                     | Compute and print the SAID of a JSON file.                                               |
| `tufa annotate`                    | Annotate a CESR stream from file or stdin.                                               |
| `tufa challenge generate`          | Generate a cryptographically random challenge phrase.                                    |
| `tufa challenge respond`           | Respond to challenge words by signing and sending an exchange message.                   |
| `tufa challenge verify`            | Verify that a signer responded with the expected challenge words.                        |
| `tufa vc schema import`            | Import one or more ACDC JSON schemas.                                                    |
| `tufa vc registry incept`          | Create a local credential registry.                                                      |
| `tufa vc registry list`            | List local credential registries.                                                        |
| `tufa vc registry status`          | Show one credential registry state.                                                      |
| `tufa vc registry root newcomers`  | Prepare existing-root files for newly accepted group signers and explicit registries.    |
| `tufa vc registry root prepare`    | Write an encrypted existing-root reply and, for a group, its authenticated proposal.     |
| `tufa vc registry root contribute` | Sign the selected elected-member proposal without changing its ciphertext.               |
| `tufa vc registry root receive`    | Approve and ingest encrypted reply files against an exact accepted BUP and held opening. |
| `tufa vc create`                   | Create and issue a registry-backed credential.                                           |
| `tufa vc list`                     | List saved credentials.                                                                  |
| `tufa vc export`                   | Export one credential stream.                                                            |
| `tufa vc import`                   | Import a CESR credential stream.                                                         |
| `tufa vc revoke`                   | Revoke a local credential.                                                               |
| `tufa ipex apply`                  | Send an IPEX apply.                                                                      |
| `tufa ipex offer`                  | Send an IPEX offer.                                                                      |
| `tufa ipex agree`                  | Send an IPEX agree.                                                                      |
| `tufa ipex grant`                  | Send or write an IPEX credential grant.                                                  |
| `tufa ipex setup`                  | Explicit individual DH setup for one pending issuance Grant; does not Admit.             |
| `tufa ipex admit`                  | Send or write an IPEX admit.                                                             |
| `tufa ipex spurn`                  | Send an IPEX spurn.                                                                      |
| `tufa ipex list`                   | List stored IPEX EXNs.                                                                   |
| `tufa ipex poll`                   | Poll configured credential mailboxes once.                                               |
| `tufa ipex join`                   | Approve or validate a single-sig or multisig IPEX message.                               |
| `tufa verifier run`                | Process verifier grants, revocations, and webhook delivery.                              |
| `tufa hook demo`                   | Launch a sample verifier webhook target.                                                 |
| `tufa dws bind`                    | Bind a local AID to replacement designated-alias ACDC(s).                                |
| `tufa dws generate`                | Generate static `did:webs` artifacts (`did.json` + `keri.cesr`).                         |
| `tufa dws resolve`                 | Resolve and verify a `did:webs` identifier.                                              |
| `tufa dws resolver`                | Run a Universal Resolver compatible DID service.                                         |
| `tufa dkr resolve`                 | Resolve a `did:keri` identifier.                                                         |
| `tufa ends add`                    | Authorize an endpoint role for one AID.                                                  |
| `tufa loc add`                     | Add one local location scheme record through signed reply acceptance.                    |
| `tufa oobi generate`               | Generate OOBI URL(s) for one local identifier.                                           |
| `tufa oobi resolve`                | Resolve one remote OOBI URL.                                                             |
| `tufa oobi clean`                  | Preview or remove exact pending OOBI keys in an offline database.                        |
| `tufa oobi request`                | Send one peer OOBI request EXN to a remote recipient.                                    |
| `tufa exchange send`               | Send one signed EXN message to a resolved remote identifier.                             |
| `tufa exn send`                    | Alias for `exchange send`.                                                               |
| `tufa mailbox start`               | Provision and run one local mailbox host.                                                |
| `tufa mailbox add`                 | Authorize one remote mailbox provider for a local identifier.                            |
| `tufa mailbox remove`              | Revoke one remote mailbox provider for a local identifier.                               |
| `tufa mailbox list`                | List authorized mailboxes for one local identifier.                                      |
| `tufa mailbox update`              | Update one local mailbox topic cursor.                                                   |
| `tufa mailbox debug`               | Display mailbox cursor and remote mailbox topic state.                                   |
| `tufa registrar start`             | Run authenticated registry publication with an existing service AID.                     |
| `tufa observer start`              | Acquire and serve verified registry evidence using an existing service AID.              |
| `tufa witness start`               | Provision and run one combined witness+mailbox host.                                     |
| `tufa witness submit`              | Submit the current event to witnesses and converge receipts.                             |
| `tufa notifications list`          | List local controller notifications.                                                     |
| `tufa notifications mark-read`     | Mark one local notification as read.                                                     |
| `tufa notifications remove`        | Remove one local notification.                                                           |
| `tufa benchmark cesr`              | Benchmark CESR parser from file or stdin.                                                |
| `tufa db dump`                     | Dump database contents (targeted sub-database inspection).                               |

### Encrypted registry-root files

These ACDC v2 commands require an existing unlocked encrypted Keeper and explicit
registry and party AIDs. They do not create an issuance root or require wallet inventory.
The prepare, contribute and receive commands accept repeatable `--evidence` files containing public KEL/TEL or
endpoint support; the held opening is supplied separately for receipt.

```sh
tufa vc registry root prepare -n sender -a issuer --registry REGISTRY \
  --recipient RECIPIENT --target TARGET_MEMBER --output reply.cesr
tufa vc registry root receive -n receiver -a recipient --registry REGISTRY \
  --sender SOURCE --event ACCEPTED_BUP --opening held-opening.cesr --message reply.cesr
```

For an individual recipient, `--target` equals `--recipient`. For a group,
`--recipient` selects the group and `--target` its receiving member. Group senders
must select an accepted `--coordinator` event. Preparation additionally requires
`--proposal-output proposal.cesr`; only the existing elected member can prepare
the ciphertext. Other members run `root contribute` with the same registry,
recipient, target and coordinator, `--proposal proposal.cesr`, and a new `--output`
file. Receipt accepts repeated `--message` files contributing to the same exact
reply, and succeeds only after ordinary author threshold verification, decryption
and matching the approved opening. `--opening` contains exactly one counted BSQ
or BSS. Output files are created exclusively and contain encrypted replies or
signed proposals, never plaintext roots. These commands perform finite file work;
transport remains separate.

For newly accepted signing members, `root newcomers` prepares one encrypted reply
and authenticated proposal per selected registry and newcomer:

```sh
tufa vc registry root newcomers -n sender -a group --rotation ACCEPTED_ROTATION \
  --previous-member OLD_MEMBER_A --previous-member OLD_MEMBER_B \
  --registry REGISTRY --output-dir existing-directory
```

`--rotation` must be the current accepted group establishment. Supply the actual
preceding signing roster through repeated `--previous-member` options; it is not
persisted or inferred from next-key commitments. Next-key-only members are not
newcomers until a rotation installs them as current signers. Registry selections
are explicit and repeatable. The existing elected member must already hold each
root. Files use `<registry>.<member>.reply.cesr` and `.proposal.cesr` names and are
created exclusively. A later failure may leave earlier completed files; no files
are overwritten. Continue with ordinary `root contribute` and explicit
`root receive` approval; preparation never reports recipient acceptance.

## Tephra Commands (CESR Tools)

| Command           | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `tephra annotate` | Annotate a CESR stream (human-readable or structured output).     |
| `tephra bench`    | Benchmark CESR parser throughput and frame processing.            |
| `tephra validate` | Validate a CESR stream for structural and attachment correctness. |

## Notes

- Most `tufa` commands require a keystore name (`-n, --name`) and often an identifier alias (`-a, --alias`).
- Many commands support `--head-dir` for custom store locations, `--passcode` for encrypted keystores, `--compat` for KERIpy path layout compatibility, and witness authentication options (`--authenticate`, `--code`).
- Subcommands under `vc`, `ipex`, `multisig`, `mailbox`, `witness`, `dws`, `notifications`, `challenge`, `oobi`, etc. are shown in dotted form for clarity.
- `tephra` commands are the CESR-native tooling surface (separate from the KERI protocol surface provided by `tufa`).
- The standalone `cesr-ts` repository (`core/typescript/cesr-ts`) currently provides a minimal reference implementation and does not ship additional CLI commands in this workspace.
- For the most up-to-date flags and usage, run `tufa <command> --help` or `tephra <command> --help`.

This reference is generated from the live command registration sources in `packages/tufa/src/cli/command-definitions/` and `packages/cesr/src/cli/`. Update it when new top-level commands or subcommands are added.
