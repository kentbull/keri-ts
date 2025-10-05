# keri-ts : KERI TypeScript Library

An aspiring full implementation of the KERI, ACDC, CESR, and PTEL specifications in TypeScript.

### Usage

```bash
# Run the CLI
deno task kli --help

# Initialize a keystore
deno task kli init --name mykeystore

# Get help for specific commands
deno task kli init --help
```

### Features

 - TODO Fully integrates with KERIpy, KERIA, and SignifyTS, both CESR 1.0 and CESR 2.0
 - TODO Creates and manages keystores
 - TODO Parses and packs CESR streams
 - ✅ Provides CLI for interaction with KERI keystores (basic implementation)
 - TODO Provides a mailbox agent, controller agent, direct mode, and indirect mode agents.
 - TODO Creates, Issues, and Verifies ACDC credentials.
 - TODO Provides a JSON Schema server to host ACDC schemas.
 
### Importing library

TBD


### Build scripts (Deno)

```bash
# Run CLI commands
deno task kli init --name test

# Start server (legacy)
deno task start
```

