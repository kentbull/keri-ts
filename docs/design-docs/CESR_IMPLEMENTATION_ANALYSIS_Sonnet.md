# CESR Implementation Analysis & Recommendations for KERI-TS
**Claude Sonnet 4.5 Analysis**
**Date:** November 10, 2025

## Executive Summary

This document provides a comprehensive analysis of all CESR (Composable Event Streaming Representation) implementations across the KERI ecosystem. After examining **9 different implementations** in **6 programming languages**, this analysis identifies the best architectural patterns, design decisions, and implementation strategies to create the world's best CESR parser in TypeScript.

**Key Finding:** The most successful implementations share three common traits:
1. **Separation of Concerns**: Clean separation between encoding/decoding logic, code tables, and primitive classes
2. **Table-Driven Architecture**: Extensive use of lookup tables for codes, sizes, and transformations
3. **Stream Processing**: First-class support for streaming and incremental parsing

---

## 1. CESR Fundamentals

### 1.1 Core Concept

CESR is a **dual text-binary encoding format** with unique **text-binary concatenation composability**. It enables:

- **Self-framing primitives**: Each primitive contains its type and size information
- **Domain duality**: Seamless conversion between Text (T), Binary (B), and Raw (R) domains
- **Composability**: Concatenated primitives maintain separability
- **24-bit alignment**: Efficient for both text and binary transmission

### 1.2 Three Domains

```
Text Domain (T) ←→ Binary Domain (B)
       ↕                    ↕
         Raw Domain (R) = (code, raw)
```

- **T Domain**: Base64 URL-safe text (no padding)
- **B Domain**: Binary representation
- **R Domain**: (text code, raw bytes) pair for cryptographic operations

### 1.3 Code Structure

Every CESR primitive has:
- **Hard Size (hs)**: Fixed part of the code (1, 2, or 4 chars)
- **Soft Size (ss)**: Variable part for size/index information
- **Full Size (fs)**: Total size in characters (null for variable-sized)
- **Lead Size (ls)**: Pre-padding bytes (0, 1, or 2)

---

## 2. Implementation Analysis

### 2.1 KERIpy (Python) - **Authoritative Reference** ⭐⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/wot/keripy/src/keri/core/`

#### Architecture

```python
# Core hierarchy:
Matter (base class)
├── Prefixer (identifiers)
├── Diger (digests)
├── Siger (signatures)
├── Seqner (sequence numbers)
├── Saider (SAIDs)
├── Cigar (non-indexed signatures)
├── Verfer (verification keys)
└── [many more specialized types]

# Serder family:
Serder (base serializer/deserializer)
└── SerderKERI (KERI events)

# Parser:
Parser (stream parser with Kevery, Revery, Exchanger integration)
```

#### Key Files
- `coring.py` (4,977 lines): Core primitives with exhaustive Matter base class
- `parsing.py`: Full streaming parser with cold-start sniffing
- `serdering.py`: Event serialization with SAID computation
- `mapping.py`: CESR native field map serialization

#### Strengths ✅

1. **Comprehensive Code Tables**
   ```python
   # Multiple version support built-in
   MtrDex_1_0  # CESR version 1.0 codes
   MtrDex_2_0  # CESR version 2.0 codes
   CtrDex_1_0  # Counter codes v1
   CtrDex_2_0  # Counter codes v2
   ```

2. **Flexible Initialization**
   ```python
   class Matter:
       def __init__(self, raw=None, code=None, qb64b=None, qb64=None, qb2=None, ...):
           # Can initialize from any domain
   ```

3. **Version-Aware Design**
   - Automatic version detection from streams
   - Dynamic code table selection based on version
   - Support for both CESR 1.0 and 2.0

4. **Cold-Start Sniffing**
   ```python
   # Parser.sniff() - Uses first 3 bits (tritet) to determine stream type
   # Binary: 0o1 (CtB64), 0o2 (OpB64), 0o3 (JSON), 0o4 (MGPK1), etc.
   ```

5. **Escrow System**
   - Handles out-of-order events
   - Partial signature support
   - Replay protection

6. **Rich Validation**
   - Code validation against tables
   - Size consistency checks
   - SAID verification
   - Cryptographic verification

#### Weaknesses ❌

1. **Monolithic Files**: `coring.py` is 4,977 lines
2. **Complex Inheritance**: Deep hierarchy can be hard to navigate
3. **Python-Specific Idioms**: Some patterns don't translate well to TypeScript
4. **Documentation**: Code is dense, requires deep reading

#### Best Ideas to Adopt 💡

1. **Sizage Named Tuple Pattern**
   ```python
   Sizage = namedtuple("Sizage", "hs ss xs fs ls")
   # Clean, immutable size parameters
   ```

2. **Domain Conversion Methods**
   ```python
   @property
   def qb64(self): return self._infil()
   @property
   def qb2(self): return self._binfil()
   # Lazy conversion with caching
   ```

3. **Code Table Versioning**
   ```python
   @property
   def codes(self):
       return CtrDex_2_0 if self.version.major >= 2 else CtrDex_1_0
   ```

4. **Strip Parameter for Streaming**
   ```python
   matter = Matter(qb64b=stream, strip=True)
   # Automatically removes parsed bytes from stream
   ```

---

### 2.2 cesr-ts - **First TypeScript Implementation** ⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/cesr-ts/src/`

#### Architecture

```typescript
Matter (base class)
├── CesrNumber
├── Prefixer
├── Seqner
├── Saider
├── Indexer
└── [limited set of specialized types]
```

#### Strengths ✅

1. **Clean TypeScript Patterns**
   ```typescript
   export class Matter {
       static Sizes = new Map<string, Sizage>([...]);
       static Hards = new Map<string, number>([...]);
   }
   ```

2. **Good Type Safety**: Interface-driven design
3. **Modular Structure**: Separate files per primitive type
4. **Base64 Utilities**: Clean implementation of URL-safe encoding

#### Weaknesses ❌

1. **Incomplete**: Missing many CESR primitive types
2. **No Parser**: No streaming parser implementation
3. **No Version Support**: Only supports one code table version
4. **Limited Counter Support**: Basic counter codes only
5. **No Validation**: Missing comprehensive validation logic
6. **Outdated Codex**: Some codes don't match CESR spec 2.0

#### Best Ideas to Adopt 💡

1. **Static Size Tables**
   ```typescript
   static Sizes = new Map<string, Sizage>([
       ['A', { hs: 1, ss: 0, xs: 0, fs: 44, ls: 0 }],
       // ...
   ]);
   ```

2. **Constructor Pattern**
   ```typescript
   constructor({ raw, code, qb64b, qb64, qb2 }: MatterArgs)
   ```

---

### 2.3 kerits - **Modern TypeScript with Bun** ⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/kerits/src/cesr/`

#### Architecture

```typescript
// Clean module structure:
cesr/
├── utils.ts       // Base64, bytes, conversion utilities
├── codex.ts       // All code tables (MatterCodex, Sizes, Hards)
├── matter.ts      // Base Matter class
├── diger.ts       // Digest class
├── signer.ts      // Signing keys
├── verfer.ts      // Verification keys
├── prefixer.ts    // Identifiers
├── seqner.ts      // Sequence numbers
└── [more specialized types]
```

#### Strengths ✅

1. **Modern TypeScript**
   - Uses `Uint8Array` consistently (not Buffer)
   - Proper type inference
   - Clean module exports

2. **Excellent Documentation**
   ```typescript
   /**
    * Sizage - Size parameters for a derivation code
    * @property hs - Hard size: number of chars in stable/hard part
    * @property ss - Soft size: number of chars in variable/soft part
    * ...
    */
   ```

3. **Comprehensive Codex**
   - All CESR 1.0 and 2.0 codes
   - Well-organized constant classes
   - Type-safe code access

4. **Clean Separation**
   - Utils completely separate from primitives
   - Codex doesn't depend on primitives
   - Each primitive in its own file

5. **Validation Built-In**
   ```typescript
   if (!sizage) {
       throw new Error(`Invalid code: ${this._code}`);
   }
   ```

6. **Noble Crypto Integration**
   - Uses `@noble/hashes` for cryptographic operations
   - Modern, well-audited crypto library
   - WebCrypto compatible

#### Weaknesses ❌

1. **No Streaming Parser Yet**: Core primitives done, parser in progress
2. **Incomplete Counter Support**: Basic counters only
3. **No Indexer**: Missing indexed signature support

#### Best Ideas to Adopt 💡

1. **File Organization**
   ```
   cesr/
   ├── utils.ts       ← All utilities in one place
   ├── codex.ts       ← All tables in one place
   ├── matter.ts      ← Base class
   └── [specific types separated]
   ```

2. **Uint8Array Everywhere**
   ```typescript
   // Modern, not Node Buffer
   protected _raw!: Uint8Array;
   ```

3. **Noble Crypto Pattern**
   ```typescript
   import { blake3 } from '@noble/hashes/blake3';
   const digest = blake3(data, { dkLen: 32 });
   ```

4. **Clean Constructor Logic**
   ```typescript
   constructor(params: MatterParams = {}) {
       if (params.qb64 !== undefined) {
           this._exfil(params.qb64);
       } else if (params.qb64b !== undefined) {
           this._exfil(bytesToText(params.qb64b));
       } else if (params.qb2 !== undefined) {
           this._bexfil(params.qb2);
       } else if (params.raw !== undefined) {
           // handle raw
       }
   }
   ```

---

### 2.4 libkeri (Rust) - **Production Rust** ⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/libkeri/src/cesr/`

#### Architecture

```rust
// Trait-based design:
pub trait Matter {
    fn code(&self) -> &str;
    fn raw(&self) -> Vec<u8>;
    fn qb64(&self) -> String;
    fn qb2(&self) -> Vec<u8>;
}

// Separate modules:
mod.rs          // Core traits and base types
counting/       // Counter codes
indexing/       // Indexed signatures
number.rs       // Number encoding
tholder.rs      // Threshold handling
```

#### Strengths ✅

1. **Type Safety via Traits**
   ```rust
   pub trait Parsable {
       fn from_qb64(qb64: &str) -> Result<Self, MatterError>;
       fn from_qb2(qb2: &[u8]) -> Result<Self, MatterError>;
   }
   ```

2. **Comprehensive Error Types**
   ```rust
   pub enum MatterError {
       InvalidCode(String),
       InvalidVarRawSize(String),
       ShortageError(String),
       // ... many specific error types
   }
   ```

3. **Version Support**
   ```rust
   let codes = if gvrsn.major == 1 {
       &ctr_dex_1_0::MAP
   } else {
       &ctr_dex_2_0::MAP
   };
   ```

4. **Extensive Code Tables**
   - Multiple code table versions as separate modules
   - Lazy static initialization for performance
   - Complete coverage of CESR spec

5. **Strong Validation**
   - Compile-time type checking
   - Runtime size validation
   - Comprehensive error messages

#### Weaknesses ❌

1. **Rust Complexity**: Borrow checker can be challenging
2. **Less Flexible**: Type system is strict (both pro and con)
3. **Verbose**: Rust requires more boilerplate

#### Best Ideas to Adopt 💡

1. **Error Type Hierarchy**
   ```typescript
   class MatterError extends Error {}
   class InvalidCodeError extends MatterError {}
   class InvalidSizeError extends MatterError {}
   // ... specific error types
   ```

2. **Result Type Pattern** (via fp-ts or custom)
   ```typescript
   type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
   ```

3. **Module Organization**
   ```
   cesr/
   ├── mod.ts           ← Main exports
   ├── matter/
   ├── counting/
   └── indexing/
   ```

---

### 2.5 cesride (Rust/WASM) - **WebAssembly Focus** ⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/cesride/src/core/`

#### Architecture

```rust
core/
├── matter/
│   └── mod.rs         // Base Matter implementation
├── bexter.rs          // Base64 text handling
├── indexer/           // Indexed signatures
├── cigar.rs           // Non-indexed signatures
├── diger.rs           // Digests
├── prefixer.rs        // Prefixes
└── common.rs          // Shared utilities

wasm/
└── primitives/        // WASM bindings for JS
```

#### Strengths ✅

1. **WASM-First Design**
   ```rust
   #[wasm_bindgen]
   pub struct Matter {
       code: String,
       raw: Vec<u8>,
   }

   #[wasm_bindgen]
   impl Matter {
       pub fn qb64(&self) -> String { ... }
   }
   ```

2. **Clean Validation**
   ```rust
   pub trait Bext: Matter {
       fn bext(&self) -> Result<String> {
           let szg = matter::sizage(&self.code())?;
           // ...
       }
   }
   ```

3. **Trait Composition**
   - Multiple traits for different capabilities
   - Clean separation of concerns

4. **Table Functions**
   ```rust
   pub mod tables {
       pub fn sizage(code: &str) -> Result<Sizage> { ... }
       pub fn has_code(code: &str) -> bool { ... }
   }
   ```

#### Weaknesses ❌

1. **WASM Overhead**: Some JS interop complexity
2. **Limited Adoption**: Not widely used yet

#### Best Ideas to Adopt 💡

1. **Validation Traits Pattern**
   ```typescript
   // Use mixins or interfaces for validation capabilities
   interface Validatable {
       validate(): boolean;
   }
   ```

2. **Table Function Pattern**
   ```typescript
   export namespace CodeTables {
       export function sizage(code: string): Sizage | null;
       export function hasCode(code: string): boolean;
   }
   ```

---

### 2.6 cesrixir (Elixir) - **Functional Approach** ⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/cesrixir/lib/`

#### Architecture

```elixir
lib/
├── cesr.ex                        # Main API
├── cesr_element.ex                # Element trait
├── CodeTable/
│   ├── keri_code_table_v1.ex      # CESR 1.0 tables
│   └── keri_code_table_v2.ex      # CESR 2.0 tables
├── CountCode/
│   ├── CntCodeGeneratorV1.ex
│   └── CntCodeGeneratorV2.ex
├── Primitive/
│   ├── OneCharFixedPrimitiveGenerator.ex
│   ├── TwoCharFixedPrimitiveGenerator.ex
│   ├── FourCharFixedPrimitiveGenerator.ex
│   ├── OneCharIndexedPrimitiveGenerator.ex
│   └── variable_length_primitive_generator.ex
└── VersionString/
    ├── version_string_1.ex
    └── version_string_2.ex
```

#### Strengths ✅

1. **Excellent API Design**
   ```elixir
   # Simple, composable API
   Cesr.consume_stream(stream, :keri_aaabaa)
   Cesr.produce_text_stream(elements)
   Cesr.produce_binary_stream(elements)
   Cesr.consume_primitive_T(primitive, version)
   ```

2. **Clear Stream Processing**
   ```elixir
   defp _consume_stream(stream, acc, current_byte, protocol_genus) do
       case consume_element(stream, protocol_genus) do
           {:ok, element, rest} ->
               _consume_stream(rest, [element | acc], ...)
           {:error, message} -> {:error, message}
       end
   end
   ```

3. **Protocol Genus Switching**
   ```elixir
   {:protocol_genus_switch, new_genus, rest} ->
       _consume_stream(rest, [new_genus | acc], ...)
   ```

4. **Cold-Start Sniffing**
   ```elixir
   << first_tritet::3, _::bitstring >> = stream
   case sniff_tritet(first_tritet) do
       :cesr_t_cnt_code -> process_T_cnt_code(...)
       :json_map -> process_json_map(...)
       :cbor_map -> process_cbor_map(...)
       # ...
   end
   ```

5. **Generator Pattern**
   - Macros generate primitive structs from tables
   - DRY principle applied excellently
   - Version-specific generators

6. **Comprehensive Documentation**
   - Excellent README with examples
   - Clear API documentation
   - Real-world examples from GLEIF

#### Weaknesses ❌

1. **Elixir-Specific**: Macro patterns don't translate to TypeScript
2. **OrdMap Dependency**: Ordered maps are a pain point (acknowledged)
3. **Performance**: BEAM VM overhead (though still very fast)

#### Best Ideas to Adopt 💡

1. **Streaming API Pattern**
   ```typescript
   class CesrParser {
       *parseStream(stream: Uint8Array): Generator<CesrElement> {
           while (stream.length > 0) {
               const { element, rest } = this.parseElement(stream);
               yield element;
               stream = rest;
           }
       }
   }
   ```

2. **Cold-Start Sniffing**
   ```typescript
   function sniffTritet(firstByte: number): StreamType {
       const tritet = firstByte >> 5;
       switch (tritet) {
           case 0b001: return 'CountCodeB64';
           case 0b011: return 'JSON';
           case 0b101: return 'CBOR';
           // ...
       }
   }
   ```

3. **Version Context Passing**
   ```typescript
   interface ParserContext {
       protocolGenus: 'keri_aaabaa' | 'keri_aaacaa';
       version: Versionage;
   }

   parseElement(stream: Uint8Array, context: ParserContext)
   ```

4. **Clean Error Handling**
   ```typescript
   type ParseResult<T> =
       | { ok: true; value: T; rest: Uint8Array }
       | { ok: false; error: string };
   ```

---

### 2.7 cesr-decoder - **Schema-Driven Parser** ⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/cesr-decoder/`

#### Architecture

```
cesr-schema/
├── codex.json          # Code name mappings
├── sizes.json          # Size parameters
├── counter.json        # Counter-specific rules
├── default_sizes.json  # Default size table
└── generate.py         # Code generation

docs/assets/
├── common/
│   └── modules/
│       ├── cesr-parser.js     # Core parser logic
│       └── cesr.js            # Protocol definitions
└── local/
    └── modules/
        └── cesr-decoder.js     # Decoder state machine
```

#### Strengths ✅

1. **Schema-Driven Design**
   ```json
   {
     "Matter": {
       "A": {"hs": 1, "ss": 0, "fs": 44, "ls": 0}
     },
     "Counter": {
       "-A": {"hs": 2, "ss": 2, "fs": 4, "count": "*1"}
     }
   }
   ```

2. **Excellent Parser Architecture**
   ```javascript
   export class CesrValue {
       constructor({header, value}) {
           this.header = header;  // Decoded header info
           this.value = value;    // Raw value bytes
       }
   }

   export function getCesrValue(protocol, input) {
       const selector = input.slice(0, 8);
       const selectorSize = protocol.getSelectorSize(selector);
       const table = protocol.getCodeTable(selector);
       const code = table.mapCodeHeader(selector);
       const total = table.getTotalLength(code);
       const value = input.slice(0, total);
       return new CesrValue({header: code, value});
   }
   ```

3. **State Machine Pattern**
   ```javascript
   export class DecoderState {
       constructor() {
           this.frames = [];
           this.start = 0;
       }

       pushFrame(position, frame) { ... }
       pushGroup(count, context, group) { ... }
       popGroup() { ... }
   }
   ```

4. **Generator Pattern for Streaming**
   ```javascript
   *values(state, input) {
       while (true) {
           const slice = this.nextSlice(state, input);
           const frameValue = getCesrFrame(...);

           if (protocol.isFrame(frameValue.header)) {
               // Process frame
           } else if (protocol.isGroup(frameValue.header)) {
               // Process group
           }

           yield result;
           state.start += length;
       }
   }
   ```

5. **Clean Protocol Abstraction**
   ```javascript
   export class CesrProtocol {
       getSelectorSize(selector) { ... }
       getCodeTable(selector) { ... }
       isFrame(header) { ... }
       isGroup(header) { ... }
       hasContext(header) { ... }
       getContext(header) { ... }
   }
   ```

6. **Real-World Testing**
   - Tested against actual GLEIF CESR streams
   - Comprehensive test vectors
   - Proven interoperability

#### Weaknesses ❌

1. **JSON Schema Overhead**: Manual schema maintenance
2. **Limited Counter Support**: Some counter types not implemented
3. **JavaScript Only**: Not TypeScript (but easily convertible)

#### Best Ideas to Adopt 💡

1. **Schema-Driven Code Tables** ⭐⭐⭐⭐⭐
   ```typescript
   // Generate types and tables from JSON schemas
   // This is EXCELLENT for:
   // - Keeping tables in sync with spec
   // - Generating test cases
   // - Documentation
   // - Version management

   interface Schema {
       Matter: Record<string, Sizage>;
       Counter: Record<string, CounterSpec>;
       Indexer: Record<string, IndexSpec>;
   }
   ```

2. **State Machine Parser**
   ```typescript
   class ParserState {
       private frameStack: Frame[] = [];
       private position: number = 0;

       pushFrame(frame: Frame): void { ... }
       popFrame(): Frame { ... }
       pushGroup(count: number, group: Group): void { ... }
   }
   ```

3. **Protocol Abstraction Layer**
   ```typescript
   interface ProtocolDefinition {
       getSelectorSize(selector: string): number;
       getCodeTable(selector: string): CodeTable;
       isFrame(header: Header): boolean;
       isGroup(header: Header): boolean;
   }
   ```

---

### 2.8 parside (Rust) - **Parser-Focused** ⭐⭐⭐⭐

**Location:** `/Users/kbull/code/keri/kentbull/parside/src/message/`

#### Architecture

```rust
message/
├── message.rs          // Top-level Message enum
├── cold_code.rs        // Cold start code handling
├── parsers.rs          // Primitive parsers
├── custom_payload.rs   // JSON/CBOR/MGPK payloads
└── groups/             // CESR group types
    ├── mod.rs
    ├── controller_idx_sigs.rs
    ├── witness_idx_sigs.rs
    ├── attached_material_quadlets.rs
    └── [more group types]
```

#### Strengths ✅

1. **Nom Parser Combinators**
   ```rust
   pub type ParserRet<'a, T> = fn(&'a [u8]) -> nom::IResult<&'a [u8], T>;

   impl Parsers {
       pub(crate) fn pather_parser<'a>(cold_code: &ColdCode)
           -> ParsideResult<ParserRet<'a, Pather>> {
           match cold_code {
               ColdCode::CtB64 | ColdCode::OpB64 =>
                   Ok(nomify!(Self::pather_from_qb64b)),
               ColdCode::CtOpB2 =>
                   Ok(nomify!(Self::pather_from_qb2)),
               _ => Err(...)
           }
       }
   }
   ```

2. **Clean Message Abstraction**
   ```rust
   pub enum Message {
       Custom { value: CustomPayload },
       Group { value: CesrGroup },
   }

   impl Message {
       pub fn from_stream_bytes(bytes: &[u8])
           -> ParsideResult<(&[u8], Message)> {
           let cold_code = ColdCode::try_from(bytes[0])?;
           match cold_code {
               ColdCode::CtB64 | ColdCode::CtOpB2 | ColdCode::OpB64 =>
                   CesrGroup::from_stream_bytes(bytes)
                       .map(|(rest, value)| (rest, Message::Group { value })),
               ColdCode::Json =>
                   CustomPayload::from_json_stream(bytes)
                       .map(|(rest, value)| (rest, Message::Custom { value })),
               // ...
           }
       }
   }
   ```

3. **Group Pattern**
   ```rust
   pub enum CesrGroup {
       ControllerIdxSigsVariant { value: ControllerIdxSigs },
       WitnessIdxSigsVariant { value: WitnessIdxSigs },
       NonTransReceiptCouplesVariant { value: NonTransReceiptCouples },
       // ... many more
   }
   ```

4. **Integration with cesride**
   - Reuses cesride primitives
   - Focuses on parsing logic
   - Clean dependency management

#### Weaknesses ❌

1. **Rust-Specific**: Nom combinators don't translate to TS
2. **Incomplete**: Still in development
3. **Limited Documentation**: Sparse comments

#### Best Ideas to Adopt 💡

1. **Message Envelope Pattern**
   ```typescript
   type Message =
       | { type: 'custom'; payload: CustomPayload }
       | { type: 'group'; value: CesrGroup };

   function parseMessage(bytes: Uint8Array): ParseResult<Message> {
       const coldCode = sniffColdCode(bytes[0]);
       switch (coldCode) {
           case 'CountCodeB64':
               return parseGroup(bytes);
           case 'JSON':
               return parseCustomPayload(bytes, 'json');
           // ...
       }
   }
   ```

2. **Parser Function Pattern**
   ```typescript
   type Parser<T> = (input: Uint8Array) => ParseResult<T>;

   function parserFor(coldCode: ColdCode): Parser<Matter> {
       switch (coldCode) {
           case 'CountCodeB64':
               return parseMatterFromQb64b;
           case 'CountOpB2':
               return parseMatterFromQb2;
           // ...
       }
   }
   ```

---

### 2.9 cesrox & keriox (Rust) - **Minimal CESR** ⭐⭐⭐

**Location:**
- `/Users/kbull/code/keri/kentbull/cesrox/src/`
- `/Users/kbull/code/keri/kentbull/keriox/src/`

#### Architecture

```rust
// cesrox: Focused on prefix handling
prefix/
├── mod.rs                # Prefix trait
├── basic.rs              # BasicPrefix
├── self_addressing.rs    # SelfAddressingPrefix
├── self_signing.rs       # SelfSigningPrefix
├── seed.rs               # SeedPrefix
└── attached_signature.rs # AttachedSignaturePrefix

derivation/
├── basic.rs
├── self_addressing.rs
└── self_signing.rs

// keriox: Full KERI with CESR
event/                    # KERI event types
event_message/            # Event message serialization
event_parsing/            # CESR parsing
database/                 # Storage
processor/                # Event processing
```

#### Strengths ✅

1. **Clean Prefix Trait**
   ```rust
   pub trait Prefix: FromStr<Err=Error> {
       fn derivative(&self) -> Vec<u8>;
       fn derivation_code(&self) -> String;

       fn to_str(&self) -> String {
           let dc = self.derivation_code();
           let ec = encode_config(self.derivative(),
                                  base64::URL_SAFE_NO_PAD);
           [dc, ec].join("")
       }
   }
   ```

2. **Enum Pattern for Prefixes**
   ```rust
   pub enum IdentifierPrefix {
       Basic(BasicPrefix),
       SelfAddressing(SelfAddressingPrefix),
       SelfSigning(SelfSigningPrefix),
   }

   impl Prefix for IdentifierPrefix {
       fn derivative(&self) -> Vec<u8> {
           match self {
               Self::Basic(bp) => bp.derivative(),
               Self::SelfAddressing(sap) => sap.derivative(),
               Self::SelfSigning(ssp) => ssp.derivative(),
           }
       }
   }
   ```

3. **FromStr Parsing**
   ```rust
   impl FromStr for IdentifierPrefix {
       fn from_str(s: &str) -> Result<Self> {
           match BasicPrefix::from_str(s) {
               Ok(bp) => Ok(Self::Basic(bp)),
               Err(_) => match SelfAddressingPrefix::from_str(s) {
                   Ok(sa) => Ok(Self::SelfAddressing(sa)),
                   Err(_) => Ok(Self::SelfSigning(...)),
               }
           }
       }
   }
   ```

4. **Focused Scope**
   - cesrox: Just CESR primitives (lean and mean)
   - keriox: Full KERI implementation using cesrox

#### Weaknesses ❌

1. **Limited CESR Types**: Only prefix-related types
2. **No Counter Support**: Missing count codes
3. **No Streaming**: Basic parsing only

#### Best Ideas to Adopt 💡

1. **Trait/Interface Pattern**
   ```typescript
   interface CesrPrimitive {
       derivative(): Uint8Array;
       derivationCode(): string;
       toQb64(): string;
       toQb2(): Uint8Array;
   }

   class Matter implements CesrPrimitive {
       derivative(): Uint8Array { return this._raw; }
       derivationCode(): string { return this._code; }
       // ...
   }
   ```

2. **Union Types for Prefixes**
   ```typescript
   type IdentifierPrefix =
       | { type: 'basic'; value: BasicPrefix }
       | { type: 'selfAddressing'; value: SelfAddressingPrefix }
       | { type: 'selfSigning'; value: SelfSigningPrefix };

   function parsePrefix(qb64: string): IdentifierPrefix {
       try {
           return { type: 'basic', value: BasicPrefix.parse(qb64) };
       } catch {
           try {
               return { type: 'selfAddressing',
                       value: SelfAddressingPrefix.parse(qb64) };
           } catch {
               return { type: 'selfSigning',
                       value: SelfSigningPrefix.parse(qb64) };
           }
       }
   }
   ```

---

## 3. Comparative Analysis

### 3.1 Comparison Matrix

| Feature | KERIpy | cesr-ts | kerits | libkeri | cesride | cesrixir | cesr-decoder | parside | cesrox/keriox |
|---------|--------|---------|---------|---------|---------|----------|--------------|---------|---------------|
| **Completeness** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Code Quality** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Documentation** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| **Parser** | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Streaming** | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Versioning** | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Type Safety** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Testing** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

### 3.2 Strengths by Category

#### Best Parsing: cesrixir & cesr-decoder
- Clean streaming API
- State machine approach
- Cold-start sniffing
- Generator patterns

#### Best Type Safety: libkeri, cesride, kerits
- Strong type systems
- Comprehensive error types
- Validation at compile/parse time

#### Best Documentation: kerits, cesrixir
- Excellent inline docs
- Clear examples
- Architecture explanations

#### Best Architecture: cesrixir, cesr-decoder, parside
- Clean separation of concerns
- Modular design
- Extensible patterns

#### Most Complete: KERIpy, cesrixir
- All CESR types
- All counter codes
- Both versions (1.0 and 2.0)
- Production-tested

---

## 4. Recommended Architecture for KERI-TS

### 4.1 Directory Structure

```
src/cesr/
├── index.ts                    # Main exports
├── types.ts                    # Shared types and interfaces
├── errors.ts                   # Error hierarchy
│
├── utils/
│   ├── base64.ts               # Base64 encoding/decoding
│   ├── bytes.ts                # Byte array utilities
│   ├── conversion.ts           # Domain conversions (T↔B↔R)
│   └── crypto.ts               # Cryptographic operations (@noble/hashes)
│
├── codex/
│   ├── index.ts                # All code table exports
│   ├── matter.ts               # Matter codes (MtrDex_1_0, MtrDex_2_0)
│   ├── counter.ts              # Counter codes (CtrDex_1_0, CtrDex_2_0)
│   ├── indexer.ts              # Indexer codes (IdxDex_1_0, IdxDex_2_0)
│   ├── sizes.ts                # Size tables (Sizes_1_0, Sizes_2_0)
│   ├── version.ts              # Version handling
│   └── schema.json             # Machine-readable schema (like cesr-decoder)
│
├── primitives/
│   ├── matter.ts               # Base Matter class
│   ├── prefixer.ts             # Prefixer (identifiers)
│   ├── diger.ts                # Diger (digests)
│   ├── signer.ts               # Signer (signing keys)
│   ├── verfer.ts               # Verfer (verification keys)
│   ├── seqner.ts               # Seqner (sequence numbers)
│   ├── saider.ts               # Saider (SAIDs)
│   ├── dater.ts                # Dater (datetimes)
│   ├── number.ts               # Number (integers)
│   ├── bexter.ts               # Bexter (base64 text)
│   ├── indexer.ts              # Indexer (indexed signatures)
│   ├── siger.ts                # Siger (indexed signatures)
│   ├── cigar.ts                # Cigar (non-indexed signatures)
│   ├── cipher.ts               # Cipher (encrypted data)
│   ├── counter.ts              # Counter (count codes)
│   ├── pather.ts               # Pather (JSON paths)
│   └── labeler.ts              # Labeler (field labels)
│
├── parser/
│   ├── index.ts                # Parser exports
│   ├── parser.ts               # Main Parser class
│   ├── state.ts                # ParserState (state machine)
│   ├── sniff.ts                # Cold-start sniffing
│   ├── stream.ts               # Streaming utilities
│   └── context.ts              # ParserContext (version, genus)
│
├── serder/
│   ├── serder.ts               # Base Serder class
│   ├── keri.ts                 # SerderKERI (KERI events)
│   ├── acdc.ts                 # SerderACDC (credentials)
│   └── mapper.ts               # Mapper (native CESR field maps)
│
└── __tests__/
    ├── primitives/             # Per-primitive tests
    ├── parser/                 # Parser tests
    ├── serder/                 # Serder tests
    ├── vectors/                # Test vectors from spec
    ├── interop/                # Interop tests with KERIpy
    └── gleif/                  # Real GLEIF streams
```

### 4.2 Core Interfaces

```typescript
// types.ts

/**
 * Size parameters for a CESR derivation code
 */
export interface Sizage {
  /** Hard size: chars in fixed part of code */
  hs: number;
  /** Soft size: chars in variable part of code */
  ss: number;
  /** Extra size: pre-pad chars in soft part */
  xs: number;
  /** Full size: total chars (null for variable-sized) */
  fs: number | null;
  /** Lead size: pre-pad bytes for raw (0, 1, or 2) */
  ls: number;
}

/**
 * Version information
 */
export interface Versionage {
  major: number;
  minor: number;
}

/**
 * Parser context for version-aware parsing
 */
export interface ParserContext {
  /** Protocol genus (keri_aaabaa, keri_aaacaa, acdc_aaabaa, etc.) */
  protocolGenus: string;
  /** Protocol version */
  protocolVersion: Versionage;
  /** CESR genus version */
  genusVersion: Versionage;
}

/**
 * Parse result with remaining bytes
 */
export type ParseResult<T> =
  | { ok: true; value: T; rest: Uint8Array }
  | { ok: false; error: CesrError };

/**
 * Base interface for all CESR primitives
 */
export interface CesrPrimitive {
  /** Derivation code (e.g., 'A', '0B', '1AAG') */
  readonly code: string;

  /** Soft part of code (for variable-sized) */
  readonly soft: string;

  /** Full code (code + soft) */
  readonly both: string;

  /** Raw cryptographic material (no code) */
  readonly raw: Uint8Array;

  /** Size in quadlets (null for fixed-size) */
  readonly size: number | null;

  /** Full size in characters */
  readonly fullSize: number;

  /** Text domain representation (qb64) */
  readonly qb64: string;

  /** Text domain as bytes (qb64b) */
  readonly qb64b: Uint8Array;

  /** Binary domain representation (qb2) */
  readonly qb2: Uint8Array;
}
```

### 4.3 Base Matter Class

```typescript
// primitives/matter.ts

export interface MatterParams {
  raw?: Uint8Array;
  code?: string;
  soft?: string;
  rize?: number;
  qb64?: string;
  qb64b?: Uint8Array;
  qb2?: Uint8Array;
}

/**
 * Base class for all CESR primitives
 *
 * Fully qualified cryptographic material with derivation code
 */
export class Matter implements CesrPrimitive {
  protected _code!: string;
  protected _soft: string = '';
  protected _raw!: Uint8Array;

  constructor(params: MatterParams = {}, context?: ParserContext) {
    const ctx = context ?? defaultContext();

    // Initialize from different domains
    if (params.qb64 !== undefined) {
      this._exfil(params.qb64, ctx);
    } else if (params.qb64b !== undefined) {
      this._exfil(bytesToText(params.qb64b), ctx);
    } else if (params.qb2 !== undefined) {
      this._bexfil(params.qb2, ctx);
    } else if (params.raw !== undefined) {
      this._infil(params.raw, params.code, params.soft, params.rize, ctx);
    } else {
      throw new EmptyMaterialError('Missing initialization parameter');
    }
  }

  // ... properties
  get code(): string { return this._code; }
  get soft(): string { return this._soft; }
  get both(): string { return this._code + this._soft; }
  get raw(): Uint8Array { return this._raw; }

  get qb64(): string {
    // Cache this
    return this._infil();
  }

  get qb64b(): Uint8Array {
    return textToBytes(this.qb64);
  }

  get qb2(): Uint8Array {
    // Cache this
    return this._binfil();
  }

  get size(): number | null {
    const sizage = getSizage(this._code);
    if (sizage.fs !== null) return null;
    return Math.floor((this._raw.length + sizage.ls) / 3);
  }

  get fullSize(): number {
    const sizage = getSizage(this._code);
    if (sizage.fs !== null) return sizage.fs;
    return sizage.hs + sizage.ss + (this.size! * 4);
  }

  /**
   * Encode raw bytes to qb64 (Text domain)
   */
  protected _infil(
    raw?: Uint8Array,
    code?: string,
    soft?: string,
    rize?: number,
    context?: ParserContext
  ): string {
    // Implementation similar to kerits/KERIpy
    // ...
  }

  /**
   * Encode raw bytes to qb2 (Binary domain)
   */
  protected _binfil(): Uint8Array {
    // Convert qb64 to qb2
    // ...
  }

  /**
   * Decode qb64 to extract code and raw
   */
  protected _exfil(qb64: string, context: ParserContext): void {
    // Parse qb64 string
    // Extract code
    // Extract soft (if variable)
    // Extract raw
    // Validate sizes
    // ...
  }

  /**
   * Decode qb2 to extract code and raw
   */
  protected _bexfil(qb2: Uint8Array, context: ParserContext): void {
    // Convert to qb64
    // Call _exfil
    // ...
  }

  /**
   * Validate this primitive
   */
  validate(): boolean {
    const sizage = getSizage(this._code);
    if (!sizage) return false;

    // Check size consistency
    // Check raw length
    // ...

    return true;
  }

  /**
   * Static factory method for parsing
   */
  static parse(input: string | Uint8Array, context?: ParserContext): Matter {
    return new Matter(
      typeof input === 'string' ? { qb64: input } : { qb2: input },
      context
    );
  }
}
```

### 4.4 Parser Architecture

```typescript
// parser/parser.ts

/**
 * Cold start code types
 */
export enum ColdCode {
  Free = 0b000,      // Not used
  CtB64 = 0b001,     // CountCode Base64
  OpB64 = 0b010,     // OpCode Base64
  JSON = 0b011,      // JSON Map
  MGPK1 = 0b100,     // MessagePack FixMap
  CBOR = 0b101,      // CBOR Map
  MGPK2 = 0b110,     // MessagePack Map16/32
  CtOpB2 = 0b111,    // CountCode/OpCode Binary
}

/**
 * Sniff first tritet (3 bits) to determine stream type
 */
export function sniffColdCode(firstByte: number): ColdCode {
  const tritet = firstByte >> 5;
  return tritet as ColdCode;
}

/**
 * Parsed CESR element
 */
export type CesrElement =
  | { type: 'primitive'; value: Matter }
  | { type: 'counter'; value: Counter }
  | { type: 'group'; value: CesrGroup }
  | { type: 'fieldmap'; value: FieldMap };

/**
 * Main CESR parser with streaming support
 */
export class Parser {
  private context: ParserContext;

  constructor(context?: Partial<ParserContext>) {
    this.context = {
      protocolGenus: context?.protocolGenus ?? 'keri_aaacaa',
      protocolVersion: context?.protocolVersion ?? { major: 1, minor: 0 },
      genusVersion: context?.genusVersion ?? { major: 2, minor: 1 },
    };
  }

  /**
   * Parse complete stream into array of elements
   */
  parseStream(stream: Uint8Array | string): CesrElement[] {
    const bytes = typeof stream === 'string'
      ? textToBytes(stream)
      : stream;

    const elements: CesrElement[] = [];

    for (const element of this.parseStreamGenerator(bytes)) {
      elements.push(element);
    }

    return elements;
  }

  /**
   * Parse stream incrementally using generator
   */
  *parseStreamGenerator(stream: Uint8Array): Generator<CesrElement> {
    let remaining = stream;

    while (remaining.length > 0) {
      const result = this.parseElement(remaining);

      if (!result.ok) {
        throw result.error;
      }

      yield result.value;
      remaining = result.rest;
    }
  }

  /**
   * Parse single element from stream
   */
  parseElement(stream: Uint8Array): ParseResult<CesrElement> {
    if (stream.length === 0) {
      return {
        ok: false,
        error: new ShortageError('Empty stream'),
      };
    }

    const coldCode = sniffColdCode(stream[0]);

    switch (coldCode) {
      case ColdCode.CtB64:
      case ColdCode.OpB64:
        return this.parseCountCode(stream, coldCode);

      case ColdCode.JSON:
        return this.parseJSON(stream);

      case ColdCode.CBOR:
        return this.parseCBOR(stream);

      case ColdCode.MGPK1:
      case ColdCode.MGPK2:
        return this.parseMGPK(stream);

      case ColdCode.CtOpB2:
        return this.parseCountCodeB2(stream);

      default:
        return {
          ok: false,
          error: new UnexpectedCodeError(`Unknown cold code: ${coldCode}`),
        };
    }
  }

  /**
   * Parse count code (text domain)
   */
  private parseCountCode(
    stream: Uint8Array,
    coldCode: ColdCode
  ): ParseResult<CesrElement> {
    // Parse counter
    const counterResult = Counter.parseFrom(stream, this.context);
    if (!counterResult.ok) return counterResult;

    const { value: counter, rest } = counterResult;

    // Parse group elements based on counter code
    const groupResult = this.parseGroup(rest, counter);
    if (!groupResult.ok) return groupResult;

    return {
      ok: true,
      value: { type: 'group', value: groupResult.value },
      rest: groupResult.rest,
    };
  }

  /**
   * Parse group of elements
   */
  private parseGroup(
    stream: Uint8Array,
    counter: Counter
  ): ParseResult<CesrGroup> {
    // Implementation depends on counter code
    // ...
  }

  /**
   * Parse JSON field map
   */
  private parseJSON(stream: Uint8Array): ParseResult<CesrElement> {
    // Find end of JSON
    // Parse JSON
    // Extract version string
    // Return field map element
    // ...
  }

  // ... similar methods for CBOR, MessagePack
}
```

### 4.5 Error Hierarchy

```typescript
// errors.ts

export class CesrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmptyMaterialError extends CesrError {}
export class RawMaterialError extends CesrError {}
export class InvalidCodeError extends CesrError {}
export class InvalidSizeError extends CesrError {}
export class InvalidVarSizeError extends CesrError {}
export class ShortageError extends CesrError {}
export class ConversionError extends CesrError {}
export class ValidationError extends CesrError {}
export class UnexpectedCodeError extends CesrError {}
export class DeserializeError extends CesrError {}
export class VersionError extends CesrError {}
```

### 4.6 Code Tables with Versioning

```typescript
// codex/matter.ts

export const MtrDex_1_0 = {
  Ed25519_Seed: 'A',
  Ed25519N: 'B',
  X25519: 'C',
  Ed25519: 'D',
  Blake3_256: 'E',
  // ... all v1.0 codes
} as const;

export const MtrDex_2_0 = {
  ...MtrDex_1_0,
  // Add v2.0 specific codes
  // ...
} as const;

export type MatterCode_1_0 = typeof MtrDex_1_0[keyof typeof MtrDex_1_0];
export type MatterCode_2_0 = typeof MtrDex_2_0[keyof typeof MtrDex_2_0];

// codex/sizes.ts

export const Sizes_1_0 = new Map<string, Sizage>([
  ['A', { hs: 1, ss: 0, xs: 0, fs: 44, ls: 0 }],
  ['B', { hs: 1, ss: 0, xs: 0, fs: 44, ls: 0 }],
  // ... all v1.0 sizes
]);

export const Sizes_2_0 = new Map<string, Sizage>([
  ...Sizes_1_0,
  // Add v2.0 specific sizes
  // ...
]);

// codex/index.ts

export function getSizage(code: string, version?: Versionage): Sizage {
  const v = version ?? { major: 2, minor: 1 };
  const sizes = v.major >= 2 ? Sizes_2_0 : Sizes_1_0;

  const sizage = sizes.get(code);
  if (!sizage) {
    throw new InvalidCodeError(`Unknown code: ${code}`);
  }

  return sizage;
}

export function getMatterCodes(version?: Versionage): typeof MtrDex_2_0 | typeof MtrDex_1_0 {
  const v = version ?? { major: 2, minor: 1 };
  return v.major >= 2 ? MtrDex_2_0 : MtrDex_1_0;
}
```

---

## 5. Implementation Recommendations

### 5.1 Phase 1: Foundation (Weeks 1-2)

**Priority:** Establish solid foundation

1. **Utils Module** (src/cesr/utils/)
   - Base64 encoding/decoding (URL-safe, no padding)
   - Byte array utilities
   - Integer ↔ Base64 conversion
   - Domain conversion helpers

2. **Codex Module** (src/cesr/codex/)
   - Complete code tables for CESR 1.0 and 2.0
   - Size tables
   - Version handling
   - Code lookup functions
   - Schema JSON (for tooling)

3. **Types & Errors** (src/cesr/)
   - Core type definitions
   - Complete error hierarchy
   - Shared interfaces

**Validation:** Unit tests for all utilities and lookups

---

### 5.2 Phase 2: Core Primitives (Weeks 3-4)

**Priority:** Build all CESR primitive types

1. **Base Matter Class**
   - Full domain conversion (T ↔ B ↔ R)
   - Variable and fixed-size support
   - Version-aware parsing
   - Validation

2. **Fixed-Size Primitives**
   - Prefixer (identifiers)
   - Diger (digests)
   - Verfer (verification keys)
   - Signer (signing keys)
   - Seqner (sequence numbers)
   - Saider (SAIDs)
   - Dater (datetimes)

3. **Variable-Size Primitives**
   - Bexter (base64 text)
   - Number (integers)
   - Cipher (encrypted data)

4. **Indexed Primitives**
   - Indexer (base)
   - Siger (indexed signatures)
   - Cigar (non-indexed signatures)

5. **Counter**
   - Base counter class
   - Count code support

**Validation:**
- Unit tests for each primitive
- Round-trip tests (R→T→R, R→B→R, T→B→T)
- Interop tests with KERIpy output

---

### 5.3 Phase 3: Parser (Weeks 5-6)

**Priority:** Streaming parser with full CESR support

1. **Cold-Start Sniffing**
   - Tritet detection
   - Stream type identification

2. **State Machine**
   - Parser state tracking
   - Frame/group stack management
   - Context propagation

3. **Element Parsing**
   - Primitive parsing
   - Counter parsing
   - Group parsing
   - Field map parsing (JSON, CBOR, MessagePack)

4. **Streaming Support**
   - Generator-based parsing
   - Incremental processing
   - Strip mode for in-place consumption

5. **Version Detection**
   - Automatic version detection from streams
   - Dynamic code table selection
   - Version string parsing

**Validation:**
- Parser tests with real KERI messages
- GLEIF stream tests
- KERIpy interop tests

---

### 5.4 Phase 4: Serder (Weeks 7-8)

**Priority:** Event serialization and SAID computation

1. **Base Serder Class**
   - Field map serialization
   - Version string handling
   - Size computation
   - SAID computation

2. **SerderKERI**
   - KERI event types (icp, rot, ixn, dip, drt)
   - Event validation
   - Attachment support
   - Reply messages (rpy)

3. **Mapper**
   - CESR native field maps
   - Label encoding
   - Value encoding

**Validation:**
- Event creation tests
- SAID computation tests
- KERIpy interop tests

---

### 5.5 Phase 5: Advanced Features (Weeks 9-10)

**Priority:** Production-ready features

1. **Escrow Support**
   - Out-of-order handling
   - Partial signature support
   - Replay protection

2. **Validation**
   - Schema validation
   - Cryptographic verification
   - Event validation

3. **Performance**
   - Caching strategies
   - Stream optimization
   - Memory efficiency

**Validation:**
- Performance benchmarks
- Memory profiling
- Stress tests

---

### 5.6 Phase 6: Testing & Documentation (Weeks 11-12)

**Priority:** Production readiness

1. **Comprehensive Testing**
   - 100% code coverage
   - All CESR spec test vectors
   - KERIpy interop suite
   - Real-world GLEIF streams
   - Property-based tests (fast-check)

2. **Documentation**
   - API documentation (TypeDoc)
   - Architecture guide
   - Usage examples
   - Migration guide from cesr-ts

3. **Tooling**
   - CLI tools for CESR debugging
   - Stream inspector
   - Code table browser

---

## 6. Best Practices & Patterns

### 6.1 From KERIpy ⭐⭐⭐⭐⭐

1. **Version-Aware Everything**
   - All functions accept optional `context: ParserContext`
   - Dynamic code table selection
   - Automatic version detection

2. **Strip Mode for Streaming**
   ```typescript
   const matter = Matter.parse(stream, { strip: true });
   // `stream` now has matter's bytes removed
   ```

3. **Lazy Property Computation**
   ```typescript
   private _qb64?: string;
   get qb64(): string {
     if (this._qb64 === undefined) {
       this._qb64 = this._infil();
     }
     return this._qb64;
   }
   ```

4. **Escrow Architecture**
   - Out-of-order event handling
   - Partial signature accumulation
   - Replay attack prevention

---

### 6.2 From kerits ⭐⭐⭐⭐⭐

1. **Modern TypeScript**
   - Use `Uint8Array` not Buffer
   - Full type inference
   - Clean module structure

2. **Documentation-First**
   - Every export has JSDoc
   - Examples in comments
   - Architecture docs

3. **Noble Crypto**
   ```typescript
   import { blake3 } from '@noble/hashes/blake3';
   import { sha256 } from '@noble/hashes/sha256';
   // Modern, audited, WebCrypto-compatible
   ```

4. **File Organization**
   ```
   cesr/
   ├── utils.ts      ← All utils in one place
   ├── codex.ts      ← All tables in one place
   ├── matter.ts     ← Base class
   └── [types]       ← One file per primitive type
   ```

---

### 6.3 From cesrixir ⭐⭐⭐⭐⭐

1. **Clean Streaming API**
   ```typescript
   // Simple, composable
   const elements = parser.parseStream(stream);
   const text = encoder.encodeText(elements);
   const binary = encoder.encodeBinary(elements);
   ```

2. **Generator Pattern**
   ```typescript
   *parseStreamGenerator(stream: Uint8Array): Generator<CesrElement> {
     // Incremental parsing with minimal memory
   }
   ```

3. **Context Switching**
   ```typescript
   // Support protocol genus switches mid-stream
   parseElement(stream, context)
   ```

4. **Cold-Start Sniffing**
   ```typescript
   const tritet = firstByte >> 5;
   switch (tritet) {
     case 0b001: return parseCountCode();
     case 0b011: return parseJSON();
     // ...
   }
   ```

---

### 6.4 From cesr-decoder ⭐⭐⭐⭐⭐

1. **Schema-Driven Tables**
   ```json
   {
     "Matter": {
       "A": {"hs": 1, "ss": 0, "fs": 44, "ls": 0}
     }
   }
   ```
   - Machine-readable
   - Version-controllable
   - Tool-friendly
   - Test-generatable

2. **State Machine Parser**
   ```typescript
   class ParserState {
     private frameStack: Frame[] = [];
     private groupStack: Group[] = [];

     pushFrame(frame: Frame): void { ... }
     pushGroup(count: number, group: Group): void { ... }
     popGroup(): Group { ... }
   }
   ```

3. **Protocol Abstraction**
   ```typescript
   interface ProtocolDefinition {
     getSelectorSize(selector: string): number;
     getCodeTable(selector: string): CodeTable;
     isFrame(header: Header): boolean;
     isGroup(header: Header): boolean;
   }
   ```

---

### 6.5 From libkeri & cesride ⭐⭐⭐⭐⭐

1. **Error Type Hierarchy**
   ```typescript
   class CesrError extends Error {}
   class InvalidCodeError extends CesrError {}
   class InvalidSizeError extends CesrError {}
   class ShortageError extends CesrError {}
   // ... specific error types
   ```

2. **Result Types** (optional but recommended)
   ```typescript
   type Result<T, E = Error> =
     | { ok: true; value: T }
     | { ok: false; error: E };

   function parse(input: string): Result<Matter, CesrError> {
     try {
       return { ok: true, value: new Matter({ qb64: input }) };
     } catch (error) {
       return { ok: false, error: error as CesrError };
     }
   }
   ```

3. **Trait/Interface Pattern**
   ```typescript
   interface CesrPrimitive {
     readonly code: string;
     readonly raw: Uint8Array;
     qb64(): string;
     qb2(): Uint8Array;
     validate(): boolean;
   }
   ```

---

### 6.6 From parside ⭐⭐⭐⭐

1. **Message Envelope**
   ```typescript
   type Message =
     | { type: 'custom'; payload: FieldMap }
     | { type: 'group'; value: CesrGroup }
     | { type: 'primitive'; value: Matter };
   ```

2. **Parser Factory Pattern**
   ```typescript
   type Parser<T> = (input: Uint8Array) => ParseResult<T>;

   function parserFor(coldCode: ColdCode): Parser<CesrElement> {
     switch (coldCode) {
       case ColdCode.CtB64: return parseCountCode;
       case ColdCode.JSON: return parseJSON;
       // ...
     }
   }
   ```

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Coverage Target:** 100%

```typescript
// Example: Matter primitive tests
describe('Matter', () => {
  describe('initialization', () => {
    it('should initialize from raw bytes', () => { ... });
    it('should initialize from qb64', () => { ... });
    it('should initialize from qb64b', () => { ... });
    it('should initialize from qb2', () => { ... });
    it('should throw on empty material', () => { ... });
  });

  describe('domain conversions', () => {
    it('should round-trip R→T→R', () => { ... });
    it('should round-trip R→B→R', () => { ... });
    it('should round-trip T→B→T', () => { ... });
  });

  describe('size validation', () => {
    it('should validate fixed-size codes', () => { ... });
    it('should validate variable-size codes', () => { ... });
    it('should reject invalid sizes', () => { ... });
  });
});
```

### 7.2 Integration Tests

**CESR Spec Test Vectors**
- Use official CESR specification test vectors
- Test all primitive types
- Test all counter codes
- Test all group types

**KERIpy Interop**
```typescript
describe('KERIpy interoperability', () => {
  it('should parse KERIpy-generated events', () => {
    const keriPyEvent = loadFixture('keripy-icp.cesr');
    const parsed = parser.parseStream(keriPyEvent);
    expect(parsed).toBeDefined();
  });

  it('should generate events parseable by KERIpy', () => {
    const event = createInceptionEvent({ ... });
    const serialized = event.raw;

    // Validate KERIpy can parse this
    const keriPyResult = exec(`kli parse`, { input: serialized });
    expect(keriPyResult.success).toBe(true);
  });
});
```

**GLEIF Streams**
```typescript
describe('GLEIF real-world streams', () => {
  it('should parse GLEIF credential stream', () => {
    const stream = loadFixture('gleif-credential.cesr');
    const elements = parser.parseStream(stream);

    expect(elements).toHaveLength(expectedLength);
    expect(elements[0].type).toBe('fieldmap');
  });
});
```

### 7.3 Property-Based Tests

Using `fast-check`:

```typescript
import fc from 'fast-check';

describe('Matter properties', () => {
  it('should preserve raw bytes through any domain conversion', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.constantFrom('A', 'D', 'E', 'H', 'I'), // codes
        (raw, code) => {
          const matter = new Matter({ raw, code });

          // T→R
          const viaText = Matter.parse(matter.qb64);
          expect(viaText.raw).toEqual(raw);

          // B→R
          const viaBinary = Matter.parse(matter.qb2);
          expect(viaBinary.raw).toEqual(raw);
        }
      )
    );
  });
});
```

### 7.4 Performance Tests

```typescript
describe('Parser performance', () => {
  it('should parse large streams efficiently', () => {
    const largeStream = generateStream(10000); // 10K elements

    const start = performance.now();
    const elements = parser.parseStream(largeStream);
    const duration = performance.now() - start;

    expect(elements.length).toBe(10000);
    expect(duration).toBeLessThan(1000); // < 1 second
  });

  it('should use bounded memory for streaming', () => {
    const hugeStream = generateStream(100000);

    const initialMemory = process.memoryUsage().heapUsed;

    let count = 0;
    for (const element of parser.parseStreamGenerator(hugeStream)) {
      count++;
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = finalMemory - initialMemory;

    // Memory growth should be O(1), not O(n)
    expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024); // < 10MB
  });
});
```

---

## 8. Key Differentiators for "Best CESR Parser"

### 8.1 What Makes a CESR Parser "Best"?

1. **Correctness** ⭐⭐⭐⭐⭐
   - 100% spec compliance
   - Passes all test vectors
   - KERIpy interop
   - No silent failures

2. **Completeness** ⭐⭐⭐⭐⭐
   - All CESR types supported
   - CESR 1.0 and 2.0
   - All counter codes
   - All group types

3. **Performance** ⭐⭐⭐⭐
   - Fast parsing (thousands of events/second)
   - Memory efficient (streaming)
   - Zero-copy where possible

4. **Type Safety** ⭐⭐⭐⭐⭐
   - Full TypeScript types
   - No `any` types
   - Type inference everywhere
   - Compile-time safety

5. **Developer Experience** ⭐⭐⭐⭐⭐
   - Intuitive API
   - Excellent documentation
   - Clear error messages
   - Good debugging tools

6. **Reliability** ⭐⭐⭐⭐⭐
   - Comprehensive tests
   - Production-proven
   - Error handling
   - Edge cases covered

7. **Maintainability** ⭐⭐⭐⭐
   - Clean architecture
   - Modular design
   - Well-documented code
   - Easy to extend

### 8.2 How KERI-TS Will Be Best

**Combining Best Ideas from All Implementations:**

1. **From KERIpy**: Authority, completeness, escrow system
2. **From kerits**: Modern TypeScript, documentation, structure
3. **From cesrixir**: API design, streaming, generators
4. **From cesr-decoder**: Schema-driven tables, state machine
5. **From libkeri**: Type safety, error handling
6. **From cesride**: Clean validation, trait composition
7. **From parside**: Parser patterns, message envelopes

**Plus Unique Advantages:**

1. **Schema-Driven + Version-Aware**
   - JSON schema for code tables
   - Automatic code generation
   - Runtime version detection
   - Future-proof design

2. **Best-in-Class TypeScript**
   - Full type inference
   - No runtime overhead
   - Modern language features
   - Excellent IDE support

3. **Superior Documentation**
   - TypeDoc for API
   - Architecture guides
   - Tutorial examples
   - Design decisions documented

4. **Developer Tools**
   - CLI for CESR debugging
   - Stream inspector
   - Code table browser
   - Interactive playground

5. **Production-Ready**
   - Comprehensive tests
   - Real-world validation
   - Performance benchmarks
   - Security audited

---

## 9. Migration Path from cesr-ts

### 9.1 Compatibility Layer

Provide compatibility layer for existing cesr-ts code:

```typescript
// cesr-ts compatibility layer
import * as CESR from '@keri-ts/cesr';

// Map old cesr-ts API to new KERI-TS API
export class Matter extends CESR.Matter {
  // Compatibility shims
  static get Codex() { return CESR.MtrDex; }
  static get Sizes() { return CESR.Sizes_2_0; }

  // Old constructor signature
  constructor(args: { raw?: Buffer; code?: string; qb64?: string; ... }) {
    super({
      raw: args.raw ? new Uint8Array(args.raw) : undefined,
      code: args.code,
      qb64: args.qb64,
      // ...
    });
  }
}
```

### 9.2 Migration Guide

```markdown
# Migrating from cesr-ts to KERI-TS

## Installation

```bash
bun remove cesr-ts
bun add @keri-ts/cesr
```

## Breaking Changes

### 1. Buffer → Uint8Array

**Before:**
```typescript
const raw = Buffer.from([...]);
const matter = new Matter({ raw });
```

**After:**
```typescript
const raw = new Uint8Array([...]);
const matter = new Matter({ raw });
```

### 2. Import Paths

**Before:**
```typescript
import { Matter } from 'cesr-ts/src/matter';
```

**After:**
```typescript
import { Matter } from '@keri-ts/cesr';
```

### 3. Code Tables

**Before:**
```typescript
import { MatterCodex } from 'cesr-ts';
const code = MatterCodex.Ed25519_Seed; // 'A'
```

**After:**
```typescript
import { MtrDex } from '@keri-ts/cesr';
const code = MtrDex.Ed25519_Seed; // 'A'
```

## New Features

- Full CESR 2.0 support
- Streaming parser
- Version-aware parsing
- Complete error types
- All counter codes
- All group types
```

---

## 10. Conclusion

### 10.1 Summary

After comprehensive analysis of 9 CESR implementations across 6 languages, the path to the **world's best CESR parser in TypeScript** is clear:

1. **Foundation from KERIpy**: Use its architecture, completeness, and battle-tested patterns
2. **Modern TypeScript from kerits**: Clean, well-documented, type-safe code
3. **API Design from cesrixir**: Simple, composable streaming API
4. **Schema-Driven from cesr-decoder**: Machine-readable tables, state machine parser
5. **Type Safety from Rust implementations**: Strong types, comprehensive error handling

### 10.2 Success Criteria

The KERI-TS CESR implementation will be the best when it achieves:

- ✅ **100% CESR spec compliance** (both v1.0 and v2.0)
- ✅ **100% KERIpy interoperability** (can parse all KERIpy output)
- ✅ **100% code coverage** (comprehensive test suite)
- ✅ **Complete documentation** (API, architecture, examples)
- ✅ **Production performance** (thousands of events/second)
- ✅ **Zero `any` types** (full TypeScript type safety)
- ✅ **Clean architecture** (modular, maintainable, extensible)

### 10.3 Timeline

**12-week implementation plan:**

- Weeks 1-2: Foundation (utils, codex, types)
- Weeks 3-4: Core primitives (all CESR types)
- Weeks 5-6: Parser (streaming, state machine)
- Weeks 7-8: Serder (event serialization)
- Weeks 9-10: Advanced features (escrow, validation)
- Weeks 11-12: Testing & documentation

### 10.4 Next Steps

1. **Review this analysis** with the team
2. **Set up project structure** following recommended architecture
3. **Start Phase 1**: Foundation implementation
4. **Establish testing infrastructure** early
5. **Document as we go** (don't defer documentation)
6. **Regular interop testing** with KERIpy
7. **Performance benchmarking** throughout development

---

**This will be the world's best CESR parser. Let's build it.** 🚀

---

## Appendix: Quick Reference

### A.1 Repository Locations

| Implementation | Language | Path |
|---------------|----------|------|
| KERIpy | Python | `/Users/kbull/code/keri/wot/keripy/` |
| cesr-ts | TypeScript | `/Users/kbull/code/keri/kentbull/cesr-ts/` |
| kerits | TypeScript | `/Users/kbull/code/keri/kentbull/kerits/` |
| libkeri | Rust | `/Users/kbull/code/keri/kentbull/libkeri/` |
| cesride | Rust | `/Users/kbull/code/keri/kentbull/cesride/` |
| cesrixir | Elixir | `/Users/kbull/code/keri/kentbull/cesrixir/` |
| cesr-decoder | JavaScript | `/Users/kbull/code/keri/kentbull/cesr-decoder/` |
| parside | Rust | `/Users/kbull/code/keri/kentbull/parside/` |
| cesrox | Rust | `/Users/kbull/code/keri/kentbull/cesrox/` |
| keriox | Rust | `/Users/kbull/code/keri/kentbull/keriox/` |
| Spec | Markdown | `/Users/kbull/code/keri/toip/tswg-cesr-specification/` |

### A.2 Key Concepts

- **CESR**: Composable Event Streaming Representation
- **T Domain**: Text (Base64 URL-safe, no padding)
- **B Domain**: Binary
- **R Domain**: Raw (code, bytes) pair
- **hs**: Hard size (fixed part of code)
- **ss**: Soft size (variable part of code)
- **fs**: Full size (total characters)
- **ls**: Lead size (pre-pad bytes)
- **Tritet**: First 3 bits for cold-start sniffing

### A.3 Essential Resources

- **CESR Spec**: https://trustoverip.github.io/tswg-cesr-specification/
- **KERI Spec**: https://trustoverip.github.io/kswg-keri-specification/
- **KERIpy**: https://github.com/WebOfTrust/keripy
- **Noble Crypto**: https://github.com/paulmillr/noble-hashes

---

**End of Analysis**

