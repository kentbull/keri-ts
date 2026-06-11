# KERI-TS CLI Command Reference

This document provides a concise reference for all CLI commands available in the `keri-ts` workspace, including:

- **Tufa** — The primary KERI application and operator CLI (`tufa`).
- **Tephra** — The CESR tooling CLI provided by the `cesr` package (`tephra`).

Commands are invoked in the monorepo via Deno tasks (e.g. `deno task tufa ...` from `packages/keri` or the `packages/tufa` / `packages/cesr` directories) or via the published binaries after installation.

## Tufa Commands (KERI / Application)

| Command                        | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `tufa version`                 | Show tufa version.                                                     |
| `tufa init`                    | Create a database and keystore.                                        |
| `tufa incept`                  | Initialize a prefix (create a new local identifier).                   |
| `tufa rotate`                  | Rotate keys for a local identifier.                                    |
| `tufa interact`                | Create and publish an interaction event.                               |
| `tufa agent`                   | Start the KERI agent server (long-lived host).                         |
| `tufa delegate confirm`        | Approve delegated events anchored to one local delegator.              |
| `tufa multisig incept`         | Initialize a group multisig prefix.                                    |
| `tufa multisig interact`       | Create and publish a group multisig interaction event.                 |
| `tufa multisig join`           | Join one pending group multisig proposal.                              |
| `tufa multisig rotate`         | Rotate a group multisig prefix.                                        |
| `tufa multisig rpy`            | Propose a group endpoint-role authorization reply.                     |
| `tufa sign`                    | Sign an arbitrary string.                                              |
| `tufa verify`                  | Verify signature(s) on arbitrary data.                                 |
| `tufa query`                   | Request KEL (key event log) from a witness.                            |
| `tufa export`                  | Export key events in CESR stream format.                               |
| `tufa list`                    | List existing local identifiers.                                       |
| `tufa aid`                     | Print the AID (prefix) for a given alias.                              |
| `tufa saidify`                 | Compute and print the SAID of a JSON file.                             |
| `tufa annotate`                | Annotate a CESR stream from file or stdin.                             |
| `tufa challenge generate`      | Generate a cryptographically random challenge phrase.                  |
| `tufa challenge respond`       | Respond to challenge words by signing and sending an exchange message. |
| `tufa challenge verify`        | Verify that a signer responded with the expected challenge words.      |
| `tufa vc schema import`        | Import one or more ACDC JSON schemas.                                  |
| `tufa vc registry incept`      | Create a local credential registry.                                    |
| `tufa vc registry list`        | List local credential registries.                                      |
| `tufa vc registry status`      | Show one credential registry state.                                    |
| `tufa vc create`               | Create and issue a registry-backed credential.                         |
| `tufa vc list`                 | List saved credentials.                                                |
| `tufa vc export`               | Export one credential stream.                                          |
| `tufa vc import`               | Import a CESR credential stream.                                       |
| `tufa vc revoke`               | Revoke a local credential.                                             |
| `tufa ipex apply`              | Send an IPEX apply.                                                    |
| `tufa ipex offer`              | Send an IPEX offer.                                                    |
| `tufa ipex agree`              | Send an IPEX agree.                                                    |
| `tufa ipex grant`              | Send or write an IPEX credential grant.                                |
| `tufa ipex admit`              | Send or write an IPEX admit.                                           |
| `tufa ipex spurn`              | Send an IPEX spurn.                                                    |
| `tufa ipex list`               | List stored IPEX EXNs.                                                 |
| `tufa ipex poll`               | Poll configured credential mailboxes once.                             |
| `tufa ipex join`               | Approve or validate a single-sig or multisig IPEX message.             |
| `tufa verifier run`            | Process verifier grants, revocations, and webhook delivery.            |
| `tufa hook demo`               | Launch a sample verifier webhook target.                               |
| `tufa dws bind`                | Bind a local AID to replacement designated-alias ACDC(s).              |
| `tufa dws generate`            | Generate static `did:webs` artifacts (`did.json` + `keri.cesr`).       |
| `tufa dws resolve`             | Resolve and verify a `did:webs` identifier.                            |
| `tufa dws resolver`            | Run a Universal Resolver compatible DID service.                       |
| `tufa dkr resolve`             | Resolve a `did:keri` identifier.                                       |
| `tufa ends add`                | Authorize an endpoint role for one AID.                                |
| `tufa loc add`                 | Add one local location scheme record through signed reply acceptance.  |
| `tufa oobi generate`           | Generate OOBI URL(s) for one local identifier.                         |
| `tufa oobi resolve`            | Resolve one remote OOBI URL.                                           |
| `tufa oobi request`            | Send one peer OOBI request EXN to a remote recipient.                  |
| `tufa exchange send`           | Send one signed EXN message to a resolved remote identifier.           |
| `tufa exn send`                | Alias for `exchange send`.                                             |
| `tufa mailbox start`           | Provision and run one local mailbox host.                              |
| `tufa mailbox add`             | Authorize one remote mailbox provider for a local identifier.          |
| `tufa mailbox remove`          | Revoke one remote mailbox provider for a local identifier.             |
| `tufa mailbox list`            | List authorized mailboxes for one local identifier.                    |
| `tufa mailbox update`          | Update one local mailbox topic cursor.                                 |
| `tufa mailbox debug`           | Display mailbox cursor and remote mailbox topic state.                 |
| `tufa witness start`           | Provision and run one combined witness+mailbox host.                   |
| `tufa witness submit`          | Submit the current event to witnesses and converge receipts.           |
| `tufa notifications list`      | List local controller notifications.                                   |
| `tufa notifications mark-read` | Mark one local notification as read.                                   |
| `tufa notifications remove`    | Remove one local notification.                                         |
| `tufa benchmark cesr`          | Benchmark CESR parser from file or stdin.                              |
| `tufa db dump`                 | Dump database contents (targeted sub-database inspection).             |

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
