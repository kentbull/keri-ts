# KLI Init Implementation Plan

## Overview

This document outlines the implementation plan for `kli init` command in KERI
TS, tracing through KERIpy's implementation to identify all required components.

## Database Keys Required for `kli init`

### Baser (KEL Database) - Minimum Required for Init

**Core Event Storage:**

- `evts.` - Serialized key events (dgKey: prefix + digest)
- `kels.` - Key event log indices (snKey: prefix + sequence number,
  dupsort=True)
- `fels.` - First seen event logs (fnKey: prefix + first seen ordinal)
- `fons.` - Maps digest to first seen ordinal number (dgKey)
- `states.` (stts.) - Latest keystate for each prefix (read-through cache)

**Habitat Management:**

- `habs.` - Habitat records keyed by name (Komer: HabitatRecord)
- `names.` - Namespace + name to prefix mapping

**OOBI Support (for config file OOBIs):**

- `oobis.` - Config-loaded OOBIs to process (Komer: OobiRecord)
- `roobi.` - Resolved OOBIs (Komer: OobiRecord)
- `woobi.` - Well-known OOBIs for MFA (Komer: OobiRecord)
- `wkas.` - Authorized well-known OOBIs (IoSetKomer: WellKnownAuthN)

**Reply Messages:**

- `rpys.` - Reply messages (SerderSuber: reply 'rpy' messages)
- `rpes.` - Reply escrows (CesrIoSetSuber: route -> Saider)
- `eans.` - Endpoint authorization (CesrSuber: cid.role.eid -> Saider)
- `lans.` - Location authorization (CesrSuber: eid.scheme -> Saider)
- `ends.` - Endpoint records (Komer: EndpointRecord)
- `locs.` - Location records (Komer: LocationRecord)

**Note:** Escrow databases are REQUIRED for `kli init` when OOBI resolution is
enabled:

- **Reply Escrows**: `rpes.`, `rpys.`, `sdts.`, `ssgs.`, `scgs.` - Required for
  async reply processing
- **Key Event Escrows**: `ooes.`, `pses.`, `pwes.`, `ures.`, `vres.`, `dtss.`,
  `sigs.` - Required for processing KEL events from OOBI responses
- **OOBI Escrows**: `eoobi.`, `coobi.`, `moobi.` - Required for OOBI retry and
  client management These escrows allow OOBI resolution to work asynchronously,
  handling out-of-order events and incomplete signatures.

### Keeper (Keystore) - Required for Init

**Global Parameters:**

- `gbls.` - Global parameters (Suber):
  - `aeid` - Authentication/encryption identifier prefix (qb64)
  - `pidx` - Next prefix index (hex)
  - `algo` - Root algorithm (randy/salty)
  - `salt` - Root salt (qb64)
  - `tier` - Security tier

**Key Storage:**

- `pris.` - Private keys (CryptSignerSuber: public key -> private key)
- `prxs.` - Encrypted private keys (CesrSuber: prefix -> Cipher)
- `nxts.` - Next key digests (CesrSuber: prefix -> Cipher)
- `pres.` - Prefixes (CesrSuber: first public key -> Prefixer)
- `prms.` - Prefix parameters (Komer: PrePrm)
- `sits.` - Prefix situations (Komer: PreSit)
- `pubs.` - Public key sets (Komer: PubSet, keyed by prefix.ridx)
- `smids.` - Group member IDs (CatCesrIoSetSuber: (Prefixer, Seqner))
- `rmids.` - Remote member IDs (CatCesrIoSetSuber: (Prefixer, Seqner))

## Implementation Phases

### Path A: Bottom-Up (Database → High-Level)

**Phase 1: Database Layer & Configuration Files**

- **Baser**: Add remaining sub-databases (`habs.`, `names.`, `oobis.`, `roobi.`,
  `woobi.`, `wkas.`, `rpys.`, `rpes.`, `eans.`, `lans.`, `ends.`, `locs.`)
- **Keeper**: Implement all sub-databases (`gbls.`, `pris.`, `prxs.`, `nxts.`,
  `pres.`, `prms.`, `sits.`, `pubs.`, `smids.`, `rmids.`)
- **Configer**: Implement configuration file management
  (JSON/HJSON/MsgPack/CBOR)
- **Data Structures**: Implement `HabitatRecord`, `OobiRecord`,
  `WellKnownAuthN`, `PrePrm`, `PreSit`, `PubSet`, `PubLot`, `EndpointRecord`,
  `LocationRecord`

**Phase 2: Manager & Keystore Activities**

- **Manager**: Implement key pair creation, storage, retrieval, signing
- **Creatory**: Implement `RandyCreator`, `SaltyCreator` for key generation
- **Signatory**: Implement signing/verification at rest
- **Crypto Primitives**: Ensure `Salter`, `Signer`, `Encrypter`, `Decrypter` are
  complete

**Phase 3: Habery, Hab, and Related Classes**

- **Habery**: Implement shared environment (db, ks, cf, mgr, signator, psr, kvy,
  rvy)
- **Hab**: Implement basic habitat (not needed for init, but structure)
- **Router**: Basic routing infrastructure
- **Revery**: Reply message processing (REQUIRED for OOBI resolution)
- **Kevery**: Event validation and processing (REQUIRED for OOBI resolution)
- **Exchanger**: Message exchange structure

**Phase 4: CESR Parser & Event Processing (REQUIRED for OOBI)**

- **Parser**: Full CESR parser for KERI messages (REQUIRED for OOBI resolution)
- **Serder**: Event serialization/deserialization (SerderKERI)
- **CESR Primitives**: All CESR types (Prefixer, Seqner, Saider, Dater, Siger,
  Cigar, Verfer, etc.)
- **Kevery**: Event validation and processing
- **Revery**: Reply message processing (REQUIRED for OOBI)

**Phase 5: CLI Integration**

- **Init Command**: Implement `kli init` CLI handler
- **InitDoer**: Effection-based initialization flow
- **OOBI Processing**: Basic OOBI loading from config (optional for init)

**Phase 6: Testing & Validation**

- **Unit Tests**: Each component
- **Integration Tests**: End-to-end `kli init` flow
- **Compatibility Tests**: Verify database compatibility with KERIpy

### Path B: Top-Down (CLI → Database)

**Phase 1: CLI Structure & Configuration**

- **Init Command**: Implement CLI handler structure
- **Configer**: Implement configuration file management first
- **CLI Args**: Parse all `kli init` arguments

**Phase 2: Habery Structure**

- **Habery**: Create skeleton with dependencies
- **Manager**: Implement Manager with minimal functionality
- **Signatory**: Basic signing capability

**Phase 3: Database Layer (Incremental)**

- **Baser**: Add databases as needed (`habs.`, `names.`, `oobis.`, etc.)
- **Keeper**: Add databases as needed (`gbls.`, `pris.`, `pres.`, etc.)
- **Data Structures**: Implement as needed

**Phase 4: Manager & Keystore**

- **Manager**: Complete key pair creation, storage
- **Creatory**: Implement creators
- **Crypto**: Complete crypto primitives

**Phase 5: CESR & Parsing**

- **Parser**: Implement as needed for message handling
- **Serder**: Event serialization

**Phase 6: OOBI & Advanced Features**

- **OOBI Processing**: Implement OOBI loading/resolution
- **Reply Messages**: Implement reply infrastructure

**Phase 7: Testing & Validation**

- **Unit Tests**: Each component
- **Integration Tests**: End-to-end flow
- **Compatibility Tests**: Database compatibility

## Comparison: Path A vs Path B

### Path A: Bottom-Up (Database → High-Level)

**Pros:**

- ✅ **Solid Foundation**: Database layer is complete before building on top
- ✅ **Clear Dependencies**: Lower layers don't depend on higher layers
- ✅ **Testability**: Can test database operations independently
- ✅ **Incremental Validation**: Can verify database structure matches KERIpy
  early
- ✅ **Reusability**: Database layer can be used by other commands (`incept`,
  `rotate`, etc.)
- ✅ **Type Safety**: Can define all data structures upfront
- ✅ **Less Refactoring**: Database structure is stable, less likely to change

**Cons:**

- ❌ **Delayed Feedback**: Don't see working `kli init` until Phase 5
- ❌ **Over-Engineering Risk**: Might implement databases not needed for init
- ❌ **More Upfront Work**: Need to implement many databases before seeing
  results

### Path B: Top-Down (CLI → Database)

**Pros:**

- ✅ **Early Feedback**: See working CLI structure quickly
- ✅ **Just-In-Time**: Only implement what's needed for current phase
- ✅ **User-Centric**: Focus on user-facing functionality first
- ✅ **Faster Initial Progress**: Can demonstrate `kli init` skeleton early

**Cons:**

- ❌ **Refactoring Risk**: May need to refactor as we discover requirements
- ❌ **Dependency Issues**: Higher layers depend on lower layers that don't
  exist yet
- ❌ **Testing Challenges**: Harder to test components in isolation
- ❌ **Incomplete Foundation**: Database structure may be incomplete
- ❌ **Type Safety**: May need to change types as we discover requirements

## Recommendation: **Path A (Bottom-Up)**

**Rationale:**

1. **Database is Foundation**: KERI is fundamentally database-driven. Getting
   the database structure right is critical.
2. **Compatibility**: Need to ensure database compatibility with KERIpy early
3. **Reusability**: Database layer will be used by `incept`, `rotate`,
   `interact`, etc.
4. **Type Safety**: TypeScript benefits from defining types upfront
5. **Testing**: Can test database operations independently
6. **Stability**: Database structure is unlikely to change, reducing refactoring

**Mitigation for Cons:**

- **Incremental Validation**: After Phase 1, can verify database structure with
  `kli db dump`
- **Focused Implementation**: Only implement databases needed for `init` (not
  all escrows)
- **Early Integration Tests**: Can write integration tests that verify database
  structure matches KERIpy
- **OOBI Deferral**: Can defer OOBI resolution to Phase 6+ if needed,
  implementing basic `init` without OOBI resolution first

## Detailed Phase Breakdown (Path A - REVISED: CESR First)

### Phase 1: CESR Primitives & Parser (FOUNDATION)

**1.1 CESR Primitives (Foundation)**

- [ ] `Matter` - Base CESR matter type (qb64, qb64b, raw, code)
- [ ] `Prefixer` - Identifier prefix handling (qb64, qb64b)
- [ ] `Seqner` - Sequence number handling (qb64, qb64b, sn)
- [ ] `Saider` - Self-addressing identifier (SAID) (qb64, qb64b)
- [ ] `Dater` - Date/time handling (ISO-8601, qb64, qb64b)
- [ ] `Siger` - Indexed signature (qb64, qb64b, index, signature)
- [ ] `Cigar` - Non-indexed signature (qb64, qb64b, signature)
- [ ] `Verfer` - Public key/verifier (qb64, qb64b, code)
- [ ] `Diger` - Digest handling (qb64, qb64b, code)
- [ ] `Number` - Number handling (qb64, qb64b)
- [ ] `Cipher` - Encrypted data (qb64, qb64b, code)
- [ ] `Signer` - Signing key pair (qb64, qb64b, code, transferable)
- [ ] All other CESR types as needed

**1.2 Serder**

- [ ] `Serder` - Base serialization/deserialization
- [ ] `SerderKERI` - KERI event serialization
- [ ] Event serialization (raw bytes from KED)
- [ ] Event deserialization (from raw bytes to KED)
- [ ] KERI event format (icp, rot, ixn, dip, drt, rpy, etc.)
- [ ] Event validation (structure, SAID computation)
- [ ] Version handling:
  - [ ] **CESR v1.0**: Format `KERI10JSON00012b_` (17 chars, terminates with
        `_`)
  - [ ] **CESR v2.0**: Format `KERICAACAAJSON00012b.` (19 chars, terminates with
        `.`)
  - [ ] **KERI subprotocol**: Support both v1.0 and v2.0
  - [ ] **ACDC subprotocol**: Support both v1.0 and v2.0
  - [ ] Legacy v1.0 format support (for compatibility)

**1.3 Parser (Full Implementation)**

- [ ] `CesrStream` class - Pure CESR stream parser (Generator Pattern)
  - [ ] Transforms bytes -> `CesrFrame` (Serder + Attachments)
  - [ ] Handle cold start (sniffing)
  - [ ] Handle framed and unframed streams
- [ ] `CesrRouter` class - Message dispatcher
  - [ ] Consumes `CesrFrame` objects from `CesrStream`
  - [ ] Routes to Kevery (events), Revery (replies), Exchanger (exchanges)
- [ ] Parse CESR streams (framed/unframed)
- [ ] Parse KERI events with attachments
- [ ] Parse reply messages (rpy) - REQUIRED for OOBI
- [ ] Parse indexed signatures (-AAD section)
- [ ] Parse non-indexed signatures (-AAC section)
- [ ] Parse witness receipts
- [ ] Parse exchange messages (exn)
- [ ] Handle multiple message types in stream
- [ ] **Version Support**:
  - [ ] Parse CESR v1.0 format (`KERI10JSON..._`)
  - [ ] Parse CESR v2.0 format (`KERICAACAAJSON....`)
  - [ ] Parse ACDC v1.0 format (`ACDC10JSON..._`)
  - [ ] Parse ACDC v2.0 format (`ACDCCAACAAJSON....`)
  - [ ] Auto-detect version from version string

**1.4 Sub-Database Helpers (CESR Storage)**

- [ ] `CesrSuber` - Single CESR object storage (Prefixer, Seqner, Saider, Dater,
      etc.)
- [ ] `SerderSuber` - Serder storage (SerderKERI for rpys, states)
- [ ] `CatCesrSuber` - Concatenated CESR tuple storage ((Seqner, Saider),
      (Verfer, Cigar))
- [ ] `CesrIoSetSuber` - Indexed ordered set of CESR objects (Saider, Siger)
- [ ] `CatCesrIoSetSuber` - Indexed ordered set of CESR tuples ((Prefixer,
      Seqner))
- [ ] `CryptSignerSuber` - Encrypted signer storage (Signer with encryption)
- [ ] `Komer` - Key-value database with schema (HabitatRecord, OobiRecord, etc.)
- [ ] `IoSetKomer` - Indexed ordered set Komer (WellKnownAuthN)

**1.5 Testing CESR Layer**

- [ ] Unit tests for each CESR primitive
- [ ] Serialization/deserialization round-trip tests
- [ ] Compatibility tests with KERIpy CESR format
- [ ] Parser tests with sample KERI messages
- [ ] **Intermediary Testing Steps**:
  - [ ] **Test 1: CESR v1.0 Parsing** - Parse sample v1.0 KERI events (icp, rot,
        ixn)
  - [ ] **Test 2: CESR v2.0 Parsing** - Parse sample v2.0 KERI events (icp, rot,
        ixn)
  - [ ] **Test 3: ACDC v1.0 Parsing** - Parse sample v1.0 ACDC credentials
  - [ ] **Test 4: ACDC v2.0 Parsing** - Parse sample v2.0 ACDC credentials
  - [ ] **Test 5: Reply Message Parsing** - Parse rpy messages with routes
        `/end/role`, `/loc/scheme`, `/oobi/*`
  - [ ] **Test 6: Escrow Processing** - Test reply escrow storage and retrieval
  - [ ] **Test 7: Mixed Stream Parsing** - Parse streams containing both v1.0
        and v2.0 messages
  - [ ] **Test 8: OOBI Response Parsing** - Parse full OOBI HTTP responses (CESR
        streams)

### Phase 2: Database Layer & Configuration Files

**2.1 Baser Sub-Databases (All use CESR from Phase 1)**

- [ ] `habs.` - HabitatRecord Komer
- [ ] `names.` - Namespace/name mapping Suber (stores Prefixer via CesrSuber)
- [ ] `oobis.` - OobiRecord Komer
- [ ] `roobi.` - Resolved OOBIs Komer
- [ ] `woobi.` - Well-known OOBIs Komer
- [ ] `eoobi.` - OOBI retry escrow Komer (REQUIRED for OOBI resolution)
- [ ] `coobi.` - OOBI client escrow Komer (REQUIRED for OOBI resolution)
- [ ] `moobi.` - Multi-OOBI escrow Komer (REQUIRED for OOBI resolution)
- [ ] `wkas.` - Well-known authN IoSetKomer
- [ ] `rpys.` - Reply messages SerderSuber (stores SerderKERI) - REQUIRED for
      OOBI
- [ ] `rpes.` - Reply escrows CesrIoSetSuber (stores Saider) - REQUIRED for OOBI
- [ ] `eans.` - Endpoint authorization CesrSuber (stores Saider)
- [ ] `lans.` - Location authorization CesrSuber (stores Saider)
- [ ] `ends.` - Endpoint records Komer
- [ ] `locs.` - Location records Komer
- [ ] `fons.` - First seen ordinal CesrSuber (stores Number)
- [ ] `sdts.` - SAD datetime CesrSuber (stores Dater) - REQUIRED for reply
      escrows
- [ ] `ssgs.` - SAD indexed sigs CesrIoSetSuber (stores Siger) - REQUIRED for
      reply escrows
- [ ] `scgs.` - SAD non-indexed sigs CatCesrIoSetSuber (stores (Verfer,
      Cigar)) - REQUIRED for reply escrows
- [ ] `wits.` - Witnesses CesrIoSetSuber (stores Prefixer)
- [ ] `udes.` - Delegation seals CatCesrSuber (stores (Seqner, Saider))
- [ ] **Key Event Escrows (REQUIRED for processing KEL events from OOBI)**:
  - [ ] `ooes.` - Out-of-order event escrows (snKey, stores digests)
  - [ ] `pses.` - Partially signed event escrows (snKey, stores digests)
  - [ ] `pwes.` - Partially witnessed event escrows (snKey, stores digests)
  - [ ] `ures.` - Unverified receipt escrows (snKey, stores triples)
  - [ ] `vres.` - Unverified validator receipt escrows (dgKey, stores
        quadruples)
  - [ ] `dtss.` - Datetime stamps for escrowed events (dgKey, stores ISO-8601
        bytes)
  - [ ] `sigs.` - Event signatures (dgKey, stores Siger qb64b) - REQUIRED for
        escrowed events
  - [ ] `evts.` - Events themselves (dgKey, stores SerderKERI raw) - Already
        have

**2.2 Keeper Sub-Databases (All use CESR from Phase 1)**

- [ ] `gbls.` - Global parameters Suber (stores bytes, but references Prefixer
      for aeid)
- [ ] `pris.` - Private keys CryptSignerSuber (stores Signer)
- [ ] `prxs.` - Encrypted private keys CesrSuber (stores Cipher)
- [ ] `nxts.` - Next key digests CesrSuber (stores Cipher)
- [ ] `pres.` - Prefixes CesrSuber (stores Prefixer)
- [ ] `prms.` - Prefix parameters Komer
- [ ] `sits.` - Prefix situations Komer
- [ ] `pubs.` - Public key sets Komer
- [ ] `smids.` - Group member IDs CatCesrIoSetSuber (stores (Prefixer, Seqner))
- [ ] `rmids.` - Remote member IDs CatCesrIoSetSuber (stores (Prefixer, Seqner))

**2.3 Data Structures**

- [ ] `HabitatRecord` - Habitat application state (contains Prefixer)
- [ ] `OobiRecord` - OOBI record
- [ ] `WellKnownAuthN` - Well-known authentication
- [ ] `PrePrm` - Prefix parameters
- [ ] `PreSit` - Prefix situation
- [ ] `PubSet` - Public key set (contains qb64 public keys)
- [ ] `PubLot` - Public key lot (contains qb64 public keys)
- [ ] `EndpointRecord` - Endpoint authorization (contains Prefixer references)
- [ ] `LocationRecord` - Location details (contains Prefixer references)

**2.4 Configer**

- [ ] File management (create, read, write)
- [ ] JSON/HJSON support
- [ ] MsgPack support (optional)
- [ ] CBOR support (optional)
- [ ] Configuration structure (dt, iurls, durls, wurls, nel)

### Phase 3: Manager & Keystore Activities

**3.1 Creatory**

- [ ] `Creatory` - Factory for creators
- [ ] `RandyCreator` - Random key creation
- [ ] `SaltyCreator` - Salt-based key creation
- [ ] `Algos` - Algorithm enumeration

**3.2 Manager**

- [ ] Constructor with Keeper
- [ ] `setup()` - Initialize manager
- [ ] `aeid` property - Get/set authentication ID
- [ ] `pidx` property - Prefix index management
- [ ] `salt` property - Root salt management
- [ ] `tier` property - Security tier
- [ ] `algo` property - Algorithm selection
- [ ] Key pair creation methods
- [ ] Encryption/decryption setup
- [ ] Vacuous initialization (first-time setup)

**3.3 Signatory**

- [ ] `Signator` class
- [ ] Signing at rest
- [ ] Verification at rest
- [ ] Integration with Manager

**3.4 Crypto Primitives**

- [ ] `Salter` - Salt management
- [ ] `Signer` - Signing operations
- [ ] `Encrypter` - Encryption operations
- [ ] `Decrypter` - Decryption operations

### Phase 4: Habery, Hab, and Related Classes

**4.1 Habery**

- [ ] Constructor (name, base, temp, ks, db, cf)
- [ ] `setup()` - Initialize Habery
- [ ] `loadHabs()` - Load habitats from database
- [ ] `loadConfig()` - Load OOBIs from config file
- [ ] `close()` - Cleanup
- [ ] Properties: `kevers`, `prefixes`, `signator`

**4.2 Basic Infrastructure**

- [ ] `Router` - Routing infrastructure for reply messages
- [ ] `Revery` - Reply message processing (REQUIRED for OOBI)
  - [ ] `processReply()` - Process reply messages
  - [ ] `escrowReply()` - Escrow incomplete reply messages
  - [ ] `processEscrowReply()` - Process escrowed replies (REQUIRED for async
        OOBI)
- [ ] `Kevery` - Event validation and processing (REQUIRED for OOBI)
  - [ ] `processOne()` - Process single event
  - [ ] `processEscrows()` - Process all event escrows (REQUIRED for async OOBI)
  - [ ] `processEscrowOutOfOrders()` - Process out-of-order events
  - [ ] `processEscrowPartiallySigned()` - Process partially signed events
  - [ ] `processEscrowPartiallyWitnessed()` - Process partially witnessed events
- [ ] `Exchanger` - Message exchange structure

**4.3 Hab (Structure Only)**

- [ ] Basic Hab class structure
- [ ] Not fully implemented (not needed for init)

### Phase 5: CLI Integration

**5.1 Init Command**

- [ ] CLI handler structure
- [ ] Argument parsing (name, base, temp, salt, configDir, configFile,
      nopasscode, aeid, seed, bran)
- [ ] Passcode prompt (if not nopasscode)
- [ ] Create Habery instance
- [ ] Create Regery instance (optional, for credentials)
- [ ] Print success messages

**5.2 InitDoer**

- [ ] Effection-based initialization
- [ ] OOBI loading (if config file has OOBIs)
- [ ] OOBI resolution (REQUIRES full CESR parser)
- [ ] Well-known authentication (optional)
- [ ] HTTP client for OOBI fetching
- [ ] OOBI processing loop (async)

**5.3 Error Handling**

- [ ] Configuration errors
- [ ] Database errors
- [ ] Keystore errors

### Phase 6: Testing & Validation

**6.1 Unit Tests**

- [ ] Database operations
- [ ] Manager operations
- [ ] Configer operations
- [ ] Habery operations

**6.2 Integration Tests**

- [ ] End-to-end `kli init` flow
- [ ] Database compatibility with KERIpy
- [ ] Config file loading
- [ ] OOBI processing (if implemented)

**6.3 Compatibility Tests**

- [ ] Database structure matches KERIpy
- [ ] Database can be read by KERIpy
- [ ] Database can be read by KERI TS after KERIpy init

## Success Criteria

1. ✅ `kli init --name test --nopasscode` creates database and keystore
2. ✅ Database structure matches KERIpy (verified by `kli db dump`)
3. ✅ Database can be read by KERIpy
4. ✅ Config file is created and can be read
5. ✅ Manager is initialized with correct parameters
6. ✅ All required sub-databases are created
7. ✅ Integration tests pass
8. ✅ Compatibility tests pass

## Notes

- **Escrow Databases**: Many escrow databases are REQUIRED for OOBI resolution:
  - **Reply Escrows**: `rpes.`, `rpys.`, `sdts.`, `ssgs.`, `scgs.` - Required
    for async reply processing
  - **Key Event Escrows**: `ooes.`, `pses.`, `pwes.`, `ures.`, `vres.`, `dtss.`,
    `sigs.` - Required for processing KEL events from OOBI responses
  - **OOBI Escrows**: `eoobi.`, `coobi.`, `moobi.` - Required for OOBI retry and
    client management
  - These escrows allow OOBI resolution to work asynchronously, handling
    out-of-order events and incomplete signatures
- **CESR Primitives**: **REQUIRED FIRST** - ALL sub-databases store CESR
  objects. We cannot implement ANY database without CESR primitives:
  - Baser: CesrSuber stores Prefixer, Seqner, Saider, Dater, Siger, Cigar,
    Verfer, Number
  - Baser: SerderSuber stores SerderKERI (reply messages, keystate)
  - Baser: CatCesrSuber stores tuples like (Seqner, Saider), (Verfer, Cigar)
  - Keeper: CesrSuber stores Prefixer, Cipher
  - Keeper: CryptSignerSuber stores Signer
  - Keeper: CatCesrIoSetSuber stores (Prefixer, Seqner)
- **CESR Parser**: **REQUIRED** for OOBI resolution. OOBI resolution fetches
  HTTP responses containing CESR-formatted KERI messages that must be parsed:
  - Key event messages (icp, rot, ixn, dip, drt) - full KERI events
  - Reply messages (rpy) with routes `/end/role/add`, `/loc/scheme`,
    `/oobi/witness`, `/oobi/controller`
  - All message types must be parseable using full `Parser` implementation
  - `SerderKERI` for event deserialization
  - `Kevery` for event validation
  - `Revery` for reply message processing
- **OOBI Resolution**: While OOBI resolution is optional (only happens if config
  file has OOBIs), if we want to support it, we need the full CESR parser. For
  initial implementation, we can skip OOBI resolution and just load OOBIs into
  the database.
- **Credentials**: `Regery` (credential store) is created in `init` but not
  required for basic functionality.
- **CESR Protocol Versions**: Must support both CESR v1.0 and v2.0:
  - **v1.0 Format**: `KERI10JSON00012b_` (17 chars, terminates with `_`)
  - **v2.0 Format**: `KERICAACAAJSON00012b.` (19 chars, terminates with `.`)
  - Both KERI and ACDC subprotocols must be supported in both versions
  - Legacy v1.0 format support is required for compatibility with existing
    KERIpy databases
- **Intermediary Testing**: After Phase 1, we can test CESR parsing
  independently before implementing full `kli init`:
  - Test CESR v1.0 and v2.0 parsing for KERI events
  - Test CESR v1.0 and v2.0 parsing for ACDC credentials
  - Test reply message parsing
  - Test escrow processing
  - Test mixed-version stream parsing
  - Test OOBI response parsing
