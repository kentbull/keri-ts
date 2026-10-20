# Usage

The [CLI reference](docs/CLI_REFERENCE.md) owns the supported command inventory;
[Tufa's README](packages/tufa/README.md) owns installation and command examples.
Use those maintained guides instead of the retired source/target OOBI scratch
recipe that previously lived here.

From the repository root, inspect the current command flags with:

```sh
deno task tufa --help
deno task tufa agent --help
deno task tufa loc add --help
deno task tufa oobi --help
```

Location records can be added explicitly with `tufa loc add`; endpoint-role
permissions use `tufa ends add`. Running an agent is not a substitute for configuring
the intended hosted identifiers and verifying their accepted endpoint records.
The [endpoint contract](docs/design-docs/kel/DELEGATION_AND_ENDPOINTS.md) explains
role authorization; [test ownership](packages/keri/test/README.md) identifies the
maintained OOBI/mailbox integration scenarios and their reference environments.

To remove specific pending OOBIs, stop and back up the service, put their exact
keys in a JSON array, then preview with
`tufa oobi clean --name NAME --head-dir DIR --key-file keys.json`.
Add `--compat` for KERIpy layout and `--apply` to remove only those `oobis.` rows.
