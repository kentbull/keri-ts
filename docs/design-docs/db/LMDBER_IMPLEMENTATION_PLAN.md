# KERI TS LMDBer Implementation Plan

## Overview

This document provides a comprehensive checklist for implementing LMDBer and all
its subclasses in KERI TS, matching KERIpy's functionality. The plan is
organized by component with clear implementation priorities.

---

## Phase 1: Core Infrastructure

### 1.1 Key Utility Functions (`dbing.ts`)

**Purpose**: Functions for creating and parsing composite database keys

#### Key Construction Functions

- [ ] `dgKey(pre, dig)` - Create digest key: `prefix.digest`
  - Input: prefix (string/Uint8Array), digest (string/Uint8Array)
  - Output: Uint8Array key with separator `.`
  - Format: `pre + '.' + dig`

- [ ] `onKey(pre, sn, sep?)` - Create ordinal key: `prefix.ordinal`
  - Input: prefix (string/Uint8Array), ordinal (number), separator (default `.`)
  - Output: Uint8Array key with 32-char hex ordinal
  - Format: `pre + sep + '%032x'` (32-char hex, zero-padded)
  - Aliases: `snKey`, `fnKey` (same function, semantic naming)

- [ ] `riKey(pre, ri)` - Create rotation index key: `prefix.ridx`
  - Input: prefix (string/Uint8Array), rotation index (number)
  - Output: Uint8Array key with 32-char hex rotation index
  - Format: `pre + '.' + '%032x'` (32-char hex, zero-padded)

- [ ] `dtKey(pre, dts)` - Create datetime key: `prefix|datetime`
  - Input: prefix (string/Uint8Array), datetime string (ISO8601)
  - Output: Uint8Array key with separator `|`
  - Format: `pre + '|' + dts`

#### Key Parsing Functions

- [ ] `splitKey(key, sep?)` - Split key at separator
  - Input: key (Uint8Array/string), separator (default `.`)
  - Output: tuple of [prefix, suffix]
  - Throws: ValueError if key doesn't split into exactly 2 parts
  - Handles: memoryview/Uint8Array, bytes, string types

- [ ] `splitKeyON(key, sep?)` - Split ordinal key and parse ordinal
  - Input: key (Uint8Array/string), separator (default `.`)
  - Output: tuple of [prefix, ordinal_number]
  - Parses: suffix as hex integer
  - Aliases: `splitSnKey`, `splitFnKey`, `splitKeySN`, `splitKeyFN`

- [ ] `splitKeyDT(key)` - Split datetime key and parse datetime
  - Input: key (Uint8Array/string)
  - Output: tuple of [prefix, datetime_object]
  - Parses: suffix as ISO8601 datetime string → Date object

#### Ordinal Suffix Functions (for IoSet operations)

- [ ] `suffix(key, ion, sep?)` - Append insertion ordinal suffix
  - Input: key (Uint8Array/string), insertion ordinal (number), separator
    (default `.`)
  - Output: Uint8Array with suffix: `key + sep + '%032x'`
  - Purpose: Create hidden ordinal keys for insertion-ordered sets

- [ ] `unsuffix(iokey, sep?)` - Remove insertion ordinal suffix
  - Input: iokey (Uint8Array/string), separator (default `.`)
  - Output: tuple of [key, ordinal_number]
  - Purpose: Extract apparent key and ordinal from suffixed key

#### Constants

- [ ] `ProemSize = 32` - Size of proem prefix (hex chars, no separator)
- [ ] `MaxProem = 0xffff...ffff` (32 hex chars) - Maximum proem value
- [ ] `MaxON = 0xffff...ffff` (32 hex chars) - Maximum ordinal number
- [ ] `SuffixSize = 32` - Size of suffix (hex chars, no separator)
- [ ] `MaxSuffix = 0xffff...ffff` (32 hex chars) - Maximum suffix value

---

### 1.2 Base LMDBer Class (`dbing.ts`)

**Inheritance**: Extends `Filer` (file/directory management base class)

#### Class Constants

- [ ] `HeadDirPath = "/usr/local/var"` - Default head directory
- [ ] `TailDirPath = "keri/db"` - Default tail directory
- [ ] `CleanTailDirPath = "keri/clean/db"` - Clean variant tail
- [ ] `AltHeadDirPath = "~"` - Alternative head (fallback)
- [ ] `AltTailDirPath = ".keri/db"` - Alternative tail
- [ ] `AltCleanTailDirPath = ".keri/clean/db"` - Alternative clean tail
- [ ] `TempHeadDir = "/tmp"` - Temporary directory head
- [ ] `TempPrefix = "keri_lmdb_"` - Temporary prefix
- [ ] `TempSuffix = "_test"` - Temporary suffix
- [ ] `Perm = 0o1700` (960) - Default permissions (sticky + owner rwx)
- [ ] `MaxNamedDBs = 96` - Maximum named sub-databases

#### Constructor (`__init__`)

- [ ] Parameters:
  - `name` (string) - Directory path name differentiator
  - `base` (string, optional) - Optional path segment before name
  - `temp` (boolean) - Use temporary directory
  - `headDirPath` (string, optional) - Override head directory
  - `perm` (number, optional) - Override permissions
  - `reopen` (boolean) - Open database in constructor
  - `clear` (boolean) - Clear directory on close if reopen
  - `reuse` (boolean) - Reuse existing path
  - `clean` (boolean) - Use clean tail variant
  - `filed` (boolean) - Path is file, not directory
  - `mode` (string, optional) - File open mode if filed
  - `fext` (string, optional) - File extension if filed
  - `readonly` (boolean) - Open database readonly
- [ ] Initialize: `env = None`, `_version = None`, `readonly`
- [ ] Call super().**init**() with Filer parameters
- [ ] If `reopen=True`, call `self.reopen()`

#### Database Lifecycle Methods

- [ ] `reopen(**kwa)` - Open/reopen database
  - Parameters: `temp`, `headDirPath`, `perm`, `clear`, `reuse`, `clean`,
    `mode`, `fext`, `readonly`
  - Create directory path via Filer
  - Open LMDB environment:
    `lmdb.open(path, max_dbs=MaxNamedDBs, map_size=4GB, mode=perm, readonly=readonly)`
  - Set `opened = True` if successful
  - If new database and not readonly, set version
  - Return: boolean (opened status)

- [ ] `close(clear=False)` - Close database
  - Close LMDB environment
  - Set `env = None`
  - Call super().close(clear)
  - Return: result from super().close()

#### Version Management

- [ ] `getVer()` - Get database version
  - Read `__version__` key from main database
  - Return: string version or None
  - Cache in `_version` property

- [ ] `setVer(val)` - Set database version
  - Write `__version__` key to main database
  - Update `_version` property
  - Input: string version

- [ ] `version` property (getter/setter)
  - Getter: Returns cached `_version` or calls `getVer()`
  - Setter: Calls `setVer()`

#### Basic CRUD Operations (dupsort=False)

- [ ] `putVal(db, key, val)` - Put value (no overwrite)
  - Transaction: write=True, buffers=True
  - Use `txn.put(key, val, overwrite=False)`
  - Return: boolean (success)
  - Throws: KeyError if BadValsizeError

- [ ] `setVal(db, key, val)` - Set value (overwrite allowed)
  - Transaction: write=True, buffers=True
  - Use `txn.put(key, val)`
  - Return: boolean (success)
  - Throws: KeyError if BadValsizeError

- [ ] `getVal(db, key)` - Get value
  - Transaction: write=False, buffers=True
  - Use `txn.get(key)`
  - Return: Uint8Array (memoryview) or None
  - Throws: KeyError if BadValsizeError

- [ ] `delVal(db, key)` - Delete value
  - Transaction: write=True, buffers=True
  - Use `txn.delete(key)`
  - Return: boolean (existed)
  - Throws: KeyError if BadValsizeError

#### Duplicate-Sorted Database Operations (dupsort=True)

- [ ] `putVals(db, key, vals)` - Put multiple values at key
  - Transaction: write=True, buffers=True
  - Put each value (duplicates allowed)
  - Return: boolean (success)

- [ ] `getVals(db, key)` - Get all values at key
  - Transaction: write=False, buffers=True
  - Use cursor to get all duplicates
  - Return: list of Uint8Array values

- [ ] `delVals(db, key)` - Delete all values at key
  - Transaction: write=True, buffers=True
  - Delete all duplicates
  - Return: boolean (any existed)

- [ ] `getIoVal(db, key, val)` - Get specific value from duplicates
  - Transaction: write=False, buffers=True
  - Find specific value in duplicates
  - Return: Uint8Array or None

- [ ] `putIoVal(db, key, val)` - Put value if not duplicate
  - Transaction: write=True, buffers=True
  - Check if value exists, add if not
  - Return: boolean (added)

- [ ] `delIoVal(db, key, val)` - Delete specific value from duplicates
  - Transaction: write=True, buffers=True
  - Delete specific value from duplicates
  - Return: boolean (existed)

- [ ] `cnt(db)` - Count all values in database
  - Transaction: write=False, buffers=True
  - Iterate cursor, count entries
  - Return: number

#### Iteration Methods

- [ ] `getAllItemIter(db, key='', split=True, sep='.')` - Iterate all items
  - Transaction: write=False, buffers=True
  - Use cursor.set_range(key) to position
  - Iterate with cursor.iternext()
  - If split: split key at separator, append value
  - Yield: tuple of (key_parts..., value) or (key, value)
  - Return: Generator

- [ ] `getTopItemIter(db, key='')` - Iterate branch items
  - Transaction: write=False, buffers=True
  - Use cursor.set_range(key)
  - Iterate while key starts with prefix
  - Yield: (full_key, value)
  - Return: Generator

- [ ] `delTopVal(db, key='')` - Delete branch items
  - Transaction: write=True, buffers=True
  - Use cursor.set_range(key)
  - Delete while key starts with prefix
  - Use cursor.item() and cursor.delete() (not iternext)
  - Return: boolean (any deleted)

#### Ordinal-Based Operations

- [ ] `getOnItemIter(db, key='', on=0, sep='.')` - Iterate ordinal items
  - Transaction: write=False, buffers=True
  - Create onkey = onKey(key, on, sep)
  - Use cursor.set_range(onkey)
  - Iterate, split keys, filter by key prefix
  - Yield: (key, ordinal, value)
  - Return: Generator

- [ ] `getOnIoDupItemIter(db, key='', on=0, sep='.')` - Iterate ordinal items
      (strip proem)
  - Same as getOnItemIter but strip 33-byte proem from values
  - Yield: (key, ordinal, value_without_proem)
  - Return: Generator

- [ ] `getAllOrdItemPreIter(db, pre, on=0)` - Iterate all ordinals for prefix
  - Transaction: write=False, buffers=True
  - Iterate all ordinal keys with same prefix
  - Yield: (ordinal, digest)
  - Return: Generator

- [ ] `appendOrdValPre(db, pre, val)` - Append value with next ordinal
  - Transaction: write=True, buffers=True
  - Find last ordinal for prefix (walk backward from MaxON)
  - Create key = onKey(pre, last_on + 1)
  - Put value at key
  - Return: ordinal number

#### Insertion-Ordered Set Operations (IoSet)

- [ ] `putIoSetVal(db, key, val)` - Add value to insertion-ordered set
  - Transaction: write=True, buffers=True
  - Find last insertion ordinal for key
  - Create iokey = suffix(key, ion, sep)
  - Check if value already exists (iterate all ions)
  - If not exists, put at iokey
  - Return: boolean (added)

- [ ] `getIoSetVals(db, key)` - Get all values from insertion-ordered set
  - Transaction: write=False, buffers=True
  - Iterate all iokeys with prefix
  - Extract values (unsuffix to get apparent key)
  - Return: list of Uint8Array values

- [ ] `delIoSetVals(db, key)` - Delete all values from insertion-ordered set
  - Transaction: write=True, buffers=True
  - Find all iokeys with prefix
  - Delete all
  - Return: boolean (any deleted)

- [ ] `delIoSetIokey(db, iokey)` - Delete specific iokey
  - Transaction: write=True, buffers=True
  - Delete iokey directly
  - Return: boolean (existed)

- [ ] `getIoSetLastVal(db, key)` - Get last (most recent) value
  - Transaction: write=False, buffers=True
  - Find highest ordinal for key
  - Get value at that iokey
  - Return: Uint8Array or None

- [ ] `getIoSetItemIter(db, key='', on=0)` - Iterate insertion-ordered set items
  - Transaction: write=False, buffers=True
  - Iterate iokeys starting at on
  - Yield: (apparent_key, ordinal, value)
  - Return: Generator

#### Context Manager

- [ ] `openLMDB(cls?, name, temp, **kwa)` - Context manager factory
  - Create LMDBer instance
  - Yield instance
  - Close with clear=temp on exit

---

## Phase 2: Supporting Classes

### 2.1 Suber Base Classes (`subing.ts`)

**Purpose**: Wrapper classes for named sub-databases with various behaviors

#### SuberBase (Abstract Base)

- [ ] `Sep = '.'` - Default separator
- [ ] `__init__(db, subkey, dupsort, sep)` - Initialize
  - Store: `db` (LMDBer), `sdb` (named sub-db), `sep`
  - Open named sub-db: `db.env.open_db(key=subkey.encode(), dupsort=dupsort)`

- [ ] `_tokey(keys, top?)` - Convert keys to key bytes
  - Input: keys (string/bytes/Uint8Array/Iterable)
  - Output: Uint8Array key bytes
  - Join iterable with separator, encode to bytes
  - If top=True, append separator

- [ ] `_tokeys(key)` - Convert key bytes to keys tuple
  - Input: key (Uint8Array/bytes/string)
  - Output: tuple of strings
  - Decode bytes, split at separator

- [ ] `_ser(val)` - Serialize value to bytes
  - Handle: string, Uint8Array, memoryview
  - Return: Uint8Array

- [ ] `_des(val)` - Deserialize value from bytes
  - Handle: string, Uint8Array, memoryview
  - Return: string or Uint8Array

- [ ] `getItemIter(keys)` - Iterate items
  - Call `db.getTopItemIter(sdb, _tokey(keys))`
  - Yield: (_tokeys(key), _des(val))

- [ ] `trim(keys)` - Delete branch
  - Call `db.delTopVal(sdb, _tokey(keys))`
  - Return: boolean

- [ ] `cntAll()` - Count all items
  - Call `db.cnt(sdb)`
  - Return: number

#### Suber (Basic Sub-Database)

- [ ] `put(keys, val)` - Put value
  - Call `db.setVal(sdb, _tokey(keys), _ser(val))`
  - Return: boolean

- [ ] `pin(keys, val)` - Put value (no overwrite)
  - Call `db.putVal(sdb, _tokey(keys), _ser(val))`
  - Return: boolean

- [ ] `get(keys)` - Get value
  - Call `db.getVal(sdb, _tokey(keys))`
  - Return: _des(val) or None

- [ ] `rem(keys)` - Remove value
  - Call `db.delVal(sdb, _tokey(keys))`
  - Return: boolean

#### CesrSuber (CESR Serializable Values)

- [ ] `_ser(val)` - Serialize CESR object
  - Input: Matter subclass instance
  - Return: `val.qb64b` (Uint8Array)

- [ ] `_des(val)` - Deserialize to CESR object
  - Input: Uint8Array (qb64b)
  - Return: `self.klas(qb64b=val)` instance

- [ ] Inherits: Suber methods

#### CatCesrSuber (Concatenated CESR Values)

- [ ] `_ser(val)` - Serialize multiple CESR objects
  - Input: Iterable of Matter instances
  - Return: Concatenated qb64b values

- [ ] `_des(val)` - Deserialize concatenated CESR
  - Input: Uint8Array (concatenated qb64b)
  - Return: tuple of Matter instances

#### IoSetSuber (Insertion-Ordered Sets)

- [ ] `add(keys, val)` - Add value to set
  - Call `db.putIoSetVal(sdb, _tokey(keys), _ser(val))`
  - Return: boolean (added)

- [ ] `get(keys)` - Get all values from set
  - Call `db.getIoSetVals(sdb, _tokey(keys))`
  - Return: list of _des(val)

- [ ] `rem(keys, val?)` - Remove value(s) from set
  - If val provided: find and delete specific iokey
  - Else: delete all values
  - Return: boolean

- [ ] `getLast(keys)` - Get last value
  - Call `db.getIoSetLastVal(sdb, _tokey(keys))`
  - Return: _des(val) or None

- [ ] `getIter(keys, on?)` - Iterate set items
  - Call `db.getIoSetItemIter(sdb, _tokey(keys), on)`
  - Yield: (_tokeys(key), ordinal, _des(val))

- [ ] `cnt(keys)` - Count values in set
  - Iterate and count
  - Return: number

#### CatCesrIoSetSuber (Concatenated CESR in Ordered Sets)

- [ ] Combines: CatCesrSuber + IoSetSuber
- [ ] Values: Concatenated CESR objects in insertion order

#### DupSuber (Duplicate-Sorted Database)

- [ ] `put(keys, vals)` - Put multiple values
  - Call `db.putVals(sdb, _tokey(keys), vals.map(_ser))`
  - Return: boolean

- [ ] `get(keys)` - Get all values
  - Call `db.getVals(sdb, _tokey(keys))`
  - Return: list of _des(val)

- [ ] `rem(keys, val?)` - Remove value(s)
  - If val: `db.delIoVal(sdb, _tokey(keys), _ser(val))`
  - Else: `db.delVals(sdb, _tokey(keys))`
  - Return: boolean

#### CesrDupSuber (CESR in Duplicate-Sorted Database)

- [ ] Combines: CesrSuber + DupSuber
- [ ] Values: CESR objects with duplicates allowed

#### SignerSuber (Signer Storage)

- [ ] `_ser(val)` - Serialize Signer
  - Return: `val.qb64b` (private key)

- [ ] `_des(val)` - Deserialize Signer
  - Return: `self.klas(qb64b=val)` (Signer instance)

#### CryptSignerSuber (Encrypted Signer Storage)

- [ ] `_ser(val)` - Serialize encrypted Signer
  - Encrypt private key before storage
  - Return: encrypted bytes

- [ ] `_des(val)` - Deserialize encrypted Signer
  - Decrypt bytes
  - Return: Signer instance

- [ ] `get(keys, decrypter?)` - Get with optional decryption
  - If decrypter provided, decrypt value
  - Return: Signer instance

#### SerderSuber (Serder Storage)

- [ ] `_ser(val)` - Serialize Serder
  - Return: `val.raw` (serialized event)

- [ ] `_des(val)` - Deserialize Serder
  - Return: `self.klas(raw=val)` (Serder instance)

---

### 2.2 Komer Classes (`koming.ts`)

**Purpose**: Keyspace Object Mapper - maps dataclass instances to database
entries

#### KomerBase (Abstract Base)

- [ ] `Sep = '.'` - Default separator
- [ ] `__init__(db, subkey, schema, kind, dupsort, sep)` - Initialize
  - Store: `db`, `sdb`, `schema` (dataclass class), `kind` (serialization type)
  - Set serializer/deserializer based on `kind` (json, cbor, msgpack)
  - Open named sub-db

- [ ] `_tokey(keys)` - Convert keys to key bytes
  - Join with separator, encode

- [ ] `_tokeys(key)` - Convert key bytes to keys tuple
  - Decode, split

- [ ] `_ser(val)` - Serialize dataclass instance
  - Convert to dict, serialize based on `kind`
  - Return: Uint8Array

- [ ] `_des(val)` - Deserialize to dataclass instance
  - Deserialize bytes based on `kind`
  - Return: `schema(**dict)` instance

- [ ] `put(keys, val)` - Put dataclass instance
  - Serialize, store

- [ ] `get(keys)` - Get dataclass instance
  - Retrieve, deserialize

- [ ] `rem(keys)` - Remove instance
  - Delete from database

- [ ] `getItemIter(keys)` - Iterate instances
  - Yield: (keys_tuple, dataclass_instance)

#### Komer (Basic Object Mapper)

- [ ] Inherits: KomerBase
- [ ] Single value per key (dupsort=False)

#### DupKomer (Duplicate-Sorted Object Mapper)

- [ ] Inherits: KomerBase
- [ ] Multiple values per key (dupsort=True)
- [ ] `put(keys, vals)` - Put multiple instances
- [ ] `get(keys)` - Get all instances

#### IoSetKomer (Insertion-Ordered Set Object Mapper)

- [ ] Inherits: KomerBase
- [ ] Uses insertion-ordering suffix
- [ ] `add(keys, val)` - Add instance to set
- [ ] `get(keys)` - Get all instances
- [ ] `rem(keys, val?)` - Remove instance(s)
- [ ] `getIter(keys, on?)` - Iterate instances

---

## Phase 3: LMDBer Subclasses

### 3.1 Baser (`basing.ts`)

**Purpose**: Main KERI event log database

#### Class Constants

- [ ] `TailDirPath = "keri/db"`
- [ ] `AltTailDirPath = ".keri/db"`
- [ ] `TempPrefix = "keri_db_"`
- [ ] `MaxNamedDBs = 96`

#### Sub-Databases (in reopen())

- [ ] `.evts` - Events (dgKey) - SerderSuber
- [ ] `.fels` - First seen event log (fnKey) - Suber
- [ ] `.dtss` - Datetime stamps (dgKey) - Suber
- [ ] `.aess` - Authorizing event seals (dgKey) - Suber
- [ ] `.sigs` - Signatures (dgKey) - DupSuber
- [ ] `.wigs` - Witness signatures (dgKey) - DupSuber
- [ ] `.rcts` - Receipts (dgKey) - DupSuber
- [ ] `.ures` - Unverified receipts (snKey) - DupSuber
- [ ] `.vrcs` - Validator receipts (dgKey) - DupSuber
- [ ] `.vres` - Unverified validator receipts (dgKey) - DupSuber
- [ ] `.kels` - Key event log (snKey) - DupSuber
- [ ] `.pses` - Partially signed escrow (snKey) - DupSuber
- [ ] `.pdes` - Partially delegated escrow (dgKey) - Suber
- [ ] `.pwes` - Partially witnessed escrow (snKey) - DupSuber
- [ ] `.uwes` - Unverified witness escrow (snKey) - DupSuber
- [ ] `.ooes` - Out of order escrow (snKey) - DupSuber
- [ ] `.dels` - Duplicitous events (snKey) - DupSuber
- [ ] `.ldes` - Likely duplicitous escrow (snKey) - DupSuber
- [ ] `.fons` - First seen ordinals (dgKey) - CesrSuber (Matter)
- [ ] `.states` / `.stts` - Key states (prefix) - SerderSuber
- [ ] `.habs` - Habitats (name) - Komer (HabitatRecord)
- [ ] `.nmsp` - Namespaces (namespace + '\x00' + name) - Komer (HabitatRecord)
- [ ] `.sdts` - SAD datetimes (said) - CesrSuber (Dater)
- [ ] `.ssgs` - SAD signatures (saider + prefixer + seqner + diger) -
      CatCesrIoSetSuber
- [ ] `.tsgs` - Trans indexed sigs (saider + prefixer + seqner + diger) -
      CatCesrIoSetSuber
- [ ] `.wsgs` - Witness indexed sigs (saider + prefixer + seqner + diger) -
      CatCesrIoSetSuber
- [ ] `.cigs` - Non-indexed sigs (saider + prefixer + seqner + diger) -
      CatCesrIoSetSuber
- [ ] `.ancs` - Anchors (saider + prefixer + seqner + diger) - CatCesrIoSetSuber
- [ ] `.exns` - Exn messages (topic) - DupSuber
- [ ] `.chgs` - Challenges (saider) - DupSuber
- [ ] `.rcts` - Receipts (saider) - DupSuber
- [ ] `.rpes` - Reply messages (saider) - DupSuber
- [ ] `.mids` - Message IDs (saider) - CesrSuber (Matter)

#### Methods

- [ ] `reopen(**kwa)` - Open all sub-databases
- [ ] Event storage/retrieval methods (use sub-databases)
- [ ] Kever management methods
- [ ] State management methods

---

### 3.2 Keeper (`keeping.ts`)

**Purpose**: Key pair storage (keystore)

#### Class Constants

- [ ] `TailDirPath = "keri/ks"`
- [ ] `AltTailDirPath = ".keri/ks"`
- [ ] `TempPrefix = "keri_ks_"`
- [ ] `MaxNamedDBs = 10`

#### Sub-Databases (in reopen())

- [ ] `.gbls` - Global parameters - Suber
- [ ] `.pris` - Private keys (public key → private key) - CryptSignerSuber
- [ ] `.prxs` - Next private keys - CesrSuber (Cipher)
- [ ] `.nxts` - Next keys - CesrSuber (Cipher)
- [ ] `.smids` - Signing member IDs - CatCesrIoSetSuber (Prefixer, Seqner)
- [ ] `.rmids` - Receiving member IDs - CatCesrIoSetSuber (Prefixer, Seqner)
- [ ] `.pres` - Prefixes (public key → prefix) - CesrSuber (Prefixer)
- [ ] `.prms` - Prefix parameters - Komer (PrePrm)
- [ ] `.sits` - Prefix situations - Komer (PreSit)
- [ ] `.pubs` - Public key sets (prefix.ridx) - Komer (PubSet)

#### Methods

- [ ] `reopen(**kwa)` - Open all sub-databases
- [ ] Key pair generation methods
- [ ] Key storage/retrieval methods
- [ ] Signing methods

---

### 3.3 Mailboxer (`storing.ts`)

**Purpose**: Message mailbox storage

#### Class Constants

- [ ] `TailDirPath = "keri/mbx"`
- [ ] `AltTailDirPath = ".keri/mbx"`
- [ ] `TempPrefix = "keri_mbx_"`

#### Sub-Databases (in reopen())

- [ ] `.tpcs` - Topics (dupsort=True) - IoSetSuber
- [ ] `.msgs` - Messages - Suber

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] `appendToTopic(topic, val)` - Append message to topic
- [ ] `getTopicMsgs(topic, fn?)` - Get messages for topic
- [ ] `delTopic(key)` - Delete topic

---

### 3.4 Noter (`notifying.ts`)

**Purpose**: Notification storage

#### Class Constants

- [ ] `TailDirPath = "keri/ntf"`
- [ ] `AltTailDirPath = ".keri/ntf"`
- [ ] `TempPrefix = "keri_ntf_"`

#### Sub-Databases (in reopen())

- [ ] `.ntfs` - Notifications - Suber

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] Notification storage/retrieval methods

---

### 3.5 Reger (`viring.ts`)

**Purpose**: Verifiable Data Registry (VDR) - credential registry

#### Class Constants

- [ ] `TailDirPath = "keri/vdr"`
- [ ] `AltTailDirPath = ".keri/vdr"`
- [ ] `TempPrefix = "keri_vdr_"`

#### Sub-Databases (in reopen())

- [ ] `.tels` - Tel events - SerderSuber
- [ ] `.tdts` - Tel datetimes - Suber
- [ ] `.tsgs` - Tel signatures - DupSuber
- [ ] `.twgs` - Tel witness signatures - DupSuber
- [ ] `.trcs` - Tel receipts - DupSuber
- [ ] `.tres` - Tel unverified receipts - DupSuber
- [ ] `.tans` - Tel anchors - CatCesrIoSetSuber
- [ ] `.tels` - Tel key event log - DupSuber
- [ ] `.tibs` - Tel issuers - CesrSuber
- [ ] `.tobs` - Tel backers - CesrSuber
- [ ] `.tors` - Tel registries - CesrSuber
- [ ] `.teds` - Tel edges - CesrSuber
- [ ] `.sads` - SADs (Self-Addressing Data) - Suber
- [ ] `.sads` - SAD datetimes - CesrSuber
- [ ] `.sigs` - SAD signatures - CatCesrIoSetSuber
- [ ] `.schs` - Schemas - Suber
- [ ] `.cads` - Credential ADs - Suber
- [ ] `.creds` - Credentials - SerderSuber
- [ ] `.creds` - Credential datetimes - Suber
- [ ] `.csigs` - Credential signatures - CatCesrIoSetSuber
- [ ] `.revs` - Revocations - Suber
- [ ] `.revs` - Revocation datetimes - Suber
- [ ] `.rsigs` - Revocation signatures - CatCesrIoSetSuber

#### Methods

- [ ] `reopen(**kwa)` - Open all sub-databases
- [ ] Registry management methods
- [ ] Credential storage/retrieval methods
- [ ] Schema management methods

---

## Phase 4: KERIA-Specific Subclasses

### 4.1 AgencyBaser (`keria/db/basing.ts`)

**Purpose**: Agency database (Signify agent)

#### Class Constants

- [ ] `TailDirPath = "keri/agency"`
- [ ] `AltTailDirPath = ".keri/agency"`
- [ ] `TempPrefix = "keri_agency_"`

#### Sub-Databases (in reopen())

- [ ] `.agnt` - Agent AIDs (controller → agent) - CesrSuber (Prefixer)
- [ ] `.ctrl` - Controller AIDs (agent → controller) - CesrSuber (Prefixer)
- [ ] `.aids` - Managed AIDs (aid → controller) - CesrSuber (Prefixer)

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] Agency mapping methods

---

### 4.2 RemoteKeeper (`keria/core/keeping.ts`)

**Purpose**: Remote key storage (Salty/Randy edge keys)

#### Class Constants

- [ ] `TailDirPath = "keri/rks"`
- [ ] `AltTailDirPath = ".keri/rks"`
- [ ] `TempPrefix = "keri_rks_"`

#### Sub-Databases (in reopen())

- [ ] `.gbls` - Global parameters - Suber
- [ ] `.prxs` - Next private keys - CesrSuber (Cipher)
- [ ] `.nxts` - Next keys - CesrSuber (Cipher)
- [ ] `.mhabs` - Managed habitats - CesrSuber (Prefixer)
- [ ] `.pres` - Prefixes - Komer (Prefix)
- [ ] `.sprms` - Salty parameters - Komer (SaltyPrm)
- [ ] `.sits` - Prefix situations - Komer (PreSit)
- [ ] `.pubs` - Public key sets - Komer (PubSet)

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] Remote key management methods

---

### 4.3 Seeker (`keria/db/basing.ts`)

**Purpose**: Credential search/indexing database

#### Class Constants

- [ ] `TailDirPath = "keri/seekdb"`
- [ ] `AltTailDirPath = ".keri/seekdb"`
- [ ] `TempPrefix = "keri_seekdb_"`
- [ ] `MaxNamedDBs = 500`

#### Sub-Databases (in reopen())

- [ ] `.schIdx` - Schema indexes - Dynamic
- [ ] `.dynIdx` - Dynamic indexes - Dynamic

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] `createIndex(field)` - Create dynamic index
- [ ] Indexing methods
- [ ] Search methods

---

### 4.4 ExnSeeker (`keria/db/basing.ts`)

**Purpose**: EXN message search/indexing

#### Class Constants

- [ ] Similar to Seeker

#### Sub-Databases (in reopen())

- [ ] Route indexes
- [ ] Sender/recipient indexes
- [ ] Date indexes
- [ ] Schema indexes

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] `createIndex(field)` - Create index
- [ ] Search methods

---

### 4.5 Operator (`keria/core/longrunning.ts`)

**Purpose**: Long-running operation storage

#### Class Constants

- [ ] `TailDirPath = "keri/ops"`
- [ ] `AltTailDirPath = ".keri/ops"`
- [ ] `TempPrefix = "keri_ops_"`

#### Sub-Databases (in reopen())

- [ ] `.ops` - Operations - Komer (Op)

#### Methods

- [ ] `reopen(**kwa)` - Open sub-databases
- [ ] Operation storage/retrieval methods

---

## Phase 5: Implementation Notes

### 5.1 TypeScript Type Definitions

- [ ] Define `Operation<T>` type (Effection)
- [ ] Define `Filer` base class interface
- [ ] Define dataclass interfaces (PrePrm, PreSit, PubSet, etc.)
- [ ] Define Matter/CESR interfaces
- [ ] Define Serder interfaces

### 5.2 Effection Integration

- [ ] All methods return `Operation<T>`
- [ ] Use generator functions (`function*`)
- [ ] Wrap LMDB transactions in Effection operations
- [ ] Handle errors through Effection error propagation

### 5.3 Memory Management

- [ ] Use `Uint8Array` for binary data (zero-copy equivalent to memoryview)
- [ ] Handle string/Uint8Array conversions
- [ ] Implement proper cleanup in close() methods

### 5.4 Testing Strategy

- [ ] Unit tests for key utility functions
- [ ] Unit tests for LMDBer base methods
- [ ] Integration tests for subclasses
- [ ] Test with temporary databases
- [ ] Test transaction rollback scenarios
- [ ] Test duplicate-sorted operations
- [ ] Test insertion-ordered set operations

### 5.5 Performance Considerations

- [ ] Use sync transactions by default (matches KERIpy)
- [ ] Support async transactions for special cases
- [ ] Optimize cursor iteration
- [ ] Minimize memory copies (use Uint8Array views)

---

## Implementation Priority

1. **Phase 1.1**: Key utility functions (foundation)
2. **Phase 1.2**: Base LMDBer class (core functionality)
3. **Phase 2.1**: SuberBase and basic Suber classes
4. **Phase 2.2**: KomerBase and basic Komer classes
5. **Phase 3.1**: Baser (most critical subclass)
6. **Phase 3.2**: Keeper (keystore)
7. **Phase 3.3-3.5**: Other KERIpy subclasses
8. **Phase 4**: KERIA-specific subclasses

---

## Dependencies

- `lmdb` npm package (already in project)
- `effection` npm package (already in project)
- Filer base class (file/directory management)
- CESR/Matter classes (for serialization)
- Serder classes (for event serialization)
- Dataclass support (TypeScript interfaces/types)

---

## Key Patterns to Maintain

1. **Transaction Pattern**: Always use `buffers=True` equivalent (Uint8Array by
   default)
2. **Key Pattern**: Composite keys with separators (`.`, `|`)
3. **Ordinal Pattern**: 32-char hex ordinals for ordering
4. **Sub-Database Pattern**: Named sub-dbs with trailing `.` to avoid Base64
   collisions
5. **Iterator Pattern**: Generator functions for iteration
6. **Error Pattern**: Convert LMDB errors to KeyError/ValueError equivalents
