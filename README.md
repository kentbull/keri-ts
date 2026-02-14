# keri-ts : KERI TypeScript Library

An aspiring full implementation of the KERI, ACDC, CESR, and PTEL specifications
in TypeScript.

### Usage

```bash
# Run the CLI
deno task tufa --help

# Initialize a keystore
deno task tufa init --name mykeystore

# Get help for specific commands
deno task tufa init --help

# Show CLI version
deno task tufa version
deno task tufa --version

# Annotate a CESR file
deno task tufa annotate --in samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr

# Annotate CESR from stdin
cat samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr | deno task tufa annotate
```

### Install CLI (`tufa`)

```bash
# npm (global)
npm install -g keri-ts
tufa --help

# Deno (global)
deno install --global --allow-all --unstable-ffi --name tufa mod.ts
tufa --help

# make sure to add the Deno bin path to your PATH var
export PATH="$HOME/.deno/bin:$PATH"
```

### Features

- TODO Fully integrates with KERIpy, KERIA, and SignifyTS, both CESR 1.0 and
  CESR 2.0
- TODO Creates and manages keystores
- TODO Parses and packs CESR streams
- ✅ Provides CLI for interaction with KERI keystores (basic implementation)
- TODO Provides a mailbox agent, controller agent, direct mode, and indirect
  mode agents.
- TODO Creates, Issues, and Verifies ACDC credentials.
- TODO Provides a JSON Schema server to host ACDC schemas.

### Importing library

TBD

### Build scripts (Deno)

```bash
# Run CLI commands
deno task tufa init --name test

# Start server (legacy)
deno task start
```

### Versioning and Releases

- `keri-ts` and `cesr-ts` are versioned independently with Changesets.
- Runtime CLI version strings are generated from package manifest versions.
- CI builds automatically append build metadata to CLI display versions.

```bash
# Add a patch/minor/major release intent file
deno task release:changeset

# Apply version bumps/changelog updates from pending changesets
deno task release:version

# Regenerate and verify runtime version modules
deno task version:generate
deno task version:check
```

### LMDB v1 Format Requirement

**KERIpy Compatibility**: This project requires LMDB data format v1 for
interoperability with KERIpy databases. The `lmdb-js` package defaults to LMDB
v2 format, using v0.9.90 of LMDB, which is incompatible with databases created
by KERIpy (which uses `py-lmdb` with LMDB 0.9.33).

**Rebuilding lmdb with v1 support**:

After installing dependencies, rebuild the `lmdb` package with v1 data format
support:

```bash
cd node_modules/lmdb
export LMDB_DATA_V1=true
npm run recompile
cd ../..
```

**When to rebuild**:

- After initial `npm install`
- After updating the `lmdb` package
- If you encounter `malloc` errors or database format incompatibility errors
  when opening KERIpy-created databases

The `malloc` error looks like the following:

```bash
node(42074,0x1f6bde0c0) malloc: *** error for object 0x3c7e805c00e0: pointer being freed was not allocated
node(42074,0x1f6bde0c0) malloc: *** set a breakpoint in malloc_error_break to debug
```

**Note**: The v1 format uses LMDB 0.9.29 (via `lmdb-data-v1`), which is
compatible with KERIpy's LMDB 0.9.33. Some newer LMDB features (encryption,
remapping) are not available with v1 format.

## Development Notes

### Deno install locally

`tufa` will show a few warnings locally unless you install it with the
`--allow-scripts` option like below:

```zsh
deno install --global \
  --config /Users/kbull/code/keri/kentbull/keri-ts/deno.json \
  --node-modules-dir=auto \
  --allow-scripts=npm:lmdb,npm:msgpackr-extract \
  --allow-all \
  --unstable-ffi \
  --name tufa \
  /Users/kbull/code/keri/kentbull/keri-ts/mod.ts
```

This is because of how Deno blocks build/install scripts for installed
dependencies unless explicitly allowed.

You may need to warm dependencies once with the following command:

```zsh
deno install --node-modules-dir=auto --allow-scripts=npm:lmdb,npm:msgpackr-extract
```
